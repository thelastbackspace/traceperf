/**
 * Allocation profiling with V8's sampling heap profiler (Node.js only).
 *
 * The heap delta shown in trees is "heap after - heap before", which GC and
 * concurrent work distort. This measures what a piece of code actually
 * allocated, including objects that were collected again, and where.
 */
import { loadNodeBuiltin } from './env';

export interface AllocationSite {
  functionName: string;
  url: string;
  line: number;
  column: number;
  /** Estimated bytes allocated at this site */
  bytes: number;
}

export interface AllocationProfile<T> {
  result: T;
  /** Estimated total bytes allocated while fn ran */
  allocatedBytes: number;
  /** Top allocation sites, largest first */
  sites: AllocationSite[];
  /**
   * Whether allocations that were garbage-collected before the profile
   * ended are included (V8 >= 11, i.e. Node.js 20+). When false, only
   * allocations still alive at the end are counted.
   */
  countsCollected: boolean;
}

const v8Major = (): number => {
  const proc: any = typeof process !== 'undefined' ? process : undefined;
  return proc && proc.versions && proc.versions.v8 ? parseInt(proc.versions.v8, 10) : 0;
};

export interface ProfileAllocationsOptions {
  /** Average bytes between samples; smaller = more precise, more overhead (default 16384) */
  samplingInterval?: number;
  /** Number of sites to return (default 10) */
  top?: number;
}

let active = false;

/**
 * Profile the allocations of `fn` (sync or async).
 *
 *   const { result, allocatedBytes, sites } = await profileAllocations(() => buildReport(data));
 *
 * Needs Node.js 20+ to include allocations that were collected again
 * (see `countsCollected`). Only one profile can run at a time per process. Estimates are
 * statistical: expect accuracy within a few percent for allocations well
 * above the sampling interval.
 */
export async function profileAllocations<T>(
  fn: () => T | Promise<T>,
  options: ProfileAllocationsOptions = {}
): Promise<AllocationProfile<Awaited<T>>> {
  const inspector = loadNodeBuiltin('inspector');
  if (!inspector || typeof inspector.Session !== 'function') {
    throw new Error('profileAllocations requires Node.js (node:inspector)');
  }
  if (active) throw new Error('profileAllocations: another profile is already running');
  active = true;
  const session = new inspector.Session();
  const post = (method: string, params?: object): Promise<any> =>
    new Promise((resolve, reject) => session.post(method, params, (err: Error | null, res: any) => (err ? reject(err) : resolve(res))));
  session.connect();
  try {
    await post('HeapProfiler.enable');
    await post('HeapProfiler.startSampling', {
      samplingInterval: Math.max(1, options.samplingInterval ?? 16384),
      // Count objects that were collected again too (V8 >= 11; ignored by older versions)
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    let result: Awaited<T>;
    let stopped: any;
    try {
      result = await fn();
    } finally {
      stopped = await post('HeapProfiler.stopSampling');
      await post('HeapProfiler.disable');
    }
    const bySite = new Map<string, AllocationSite>();
    let total = 0;
    const visit = (node: any) => {
      if (node.selfSize > 0) {
        const cf = node.callFrame;
        const key = `${cf.functionName}|${cf.url}|${cf.lineNumber}|${cf.columnNumber}`;
        const site = bySite.get(key) ?? {
          functionName: cf.functionName || '(anonymous)',
          url: cf.url,
          line: cf.lineNumber + 1,
          column: cf.columnNumber + 1,
          bytes: 0,
        };
        site.bytes += node.selfSize;
        bySite.set(key, site);
        total += node.selfSize;
      }
      (node.children || []).forEach(visit);
    };
    visit(stopped.profile.head);
    const sites = [...bySite.values()].sort((a, b) => b.bytes - a.bytes).slice(0, Math.max(0, options.top ?? 10));
    return { result, allocatedBytes: total, sites, countsCollected: v8Major() >= 11 };
  } finally {
    session.disconnect();
    active = false;
  }
}

/**
 * Line-level detail for slow calls: runs the V8 sampling profiler (Node.js
 * inspector) and, for every top-level call slower than `threshold`, reports
 * the functions that were on the CPU during it - including code that is not
 * tracked at all.
 *
 *   tp.use(profileSlowCalls({
 *     threshold: 200,
 *     onProfile: (call, p) => console.log(call.label, p.hotspots),
 *   }));
 *
 * The profiler runs in windows (default 2 s); results arrive when the window
 * containing the call closes. Samples are process-wide, so concurrent work
 * shows up too. Sampling every 1 ms costs a few percent CPU: enable it while
 * investigating, or on a fraction of instances.
 */
import type { ExecutionRecord, TracePerfPlugin } from './records';
import { loadNodeBuiltin } from './env';

export interface Hotspot {
  /** Function name ("(anonymous)" when unnamed) */
  functionName: string;
  /** Script URL or path ("" for native code) */
  url: string;
  /** 1-based line and column */
  line: number;
  column: number;
  /** CPU time sampled in this function itself, in ms */
  selfMs: number;
}

export interface SlowCallProfile {
  /** Functions with the most self time during the call, largest first */
  hotspots: Hotspot[];
  /** Time the thread was idle (waiting for I/O or timers) during the call, ms */
  idleMs: number;
  /** Time in garbage collection during the call, ms */
  gcMs: number;
  /** Time on the CPU during the call, ms (hotspots are the top of this) */
  cpuMs: number;
  /** Number of samples that fell within the call */
  samples: number;
}

export interface ProfileSlowCallsOptions {
  /** Profile top-level calls at least this slow (ms, default 100) */
  threshold?: number;
  /** Called once per slow call with its profile */
  onProfile: (call: ExecutionRecord, profile: SlowCallProfile) => void;
  /** Profiler window length in ms (default 2000) */
  window?: number;
  /** Sampling interval in microseconds (default 1000) */
  samplingIntervalUs?: number;
  /** Number of hotspots to report (default 5) */
  top?: number;
  /** Skip functions from these paths, e.g. /node_modules/ (default: none) */
  exclude?: RegExp;
}

export interface SlowCallProfiler extends TracePerfPlugin {
  /** Whether the inspector was available (false in browsers and edge runtimes) */
  readonly available: boolean;
  /** Close the current window now and deliver pending profiles */
  flush(): Promise<void>;
  /** Stop profiling (pending profiles are delivered first) */
  stop(): Promise<void>;
}

interface CpuProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
}
interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  samples: number[];
  timeDeltas: number[];
}

/** Summarise the samples of a profile that fall within [start, end] (ms, profile clock) */
export function summariseProfile(profile: CpuProfile, start: number, end: number, top = 5, exclude?: RegExp): SlowCallProfile {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map<string, Hotspot>();
  let idleMs = 0;
  let gcMs = 0;
  let cpuMs = 0;
  let samples = 0;
  let t = profile.startTime / 1000;
  for (let i = 0; i < profile.samples.length; i++) {
    t += (profile.timeDeltas[i] || 0) / 1000;
    // Each sample stands for the interval up to the next one
    const next = i + 1 < profile.timeDeltas.length ? (profile.timeDeltas[i + 1] || 0) / 1000 : 0;
    if (t < start || t > end) continue;
    samples++;
    const node = nodes.get(profile.samples[i]);
    if (!node) continue;
    const { functionName, url, lineNumber, columnNumber } = node.callFrame;
    if (functionName === '(idle)') {
      idleMs += next;
      continue;
    }
    if (functionName === '(garbage collector)') {
      gcMs += next;
      continue;
    }
    if (functionName === '(program)' || functionName === '(root)') {
      cpuMs += next;
      continue;
    }
    cpuMs += next;
    if (exclude && exclude.test(url)) continue;
    const key = `${functionName}|${url}|${lineNumber}|${columnNumber}`;
    const entry = self.get(key) ?? {
      functionName: functionName || '(anonymous)', url, line: lineNumber + 1, column: columnNumber + 1, selfMs: 0,
    };
    entry.selfMs += next;
    self.set(key, entry);
  }
  const hotspots = [...self.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, top);
  return { hotspots, idleMs, gcMs, cpuMs, samples };
}

function mergeProfiles(a: SlowCallProfile, b: SlowCallProfile, top: number): SlowCallProfile {
  const all = new Map<string, Hotspot>();
  for (const h of [...a.hotspots, ...b.hotspots]) {
    const key = `${h.functionName}|${h.url}|${h.line}|${h.column}`;
    const e = all.get(key);
    if (e) e.selfMs += h.selfMs;
    else all.set(key, { ...h });
  }
  return {
    hotspots: [...all.values()].sort((x, y) => y.selfMs - x.selfMs).slice(0, top),
    idleMs: a.idleMs + b.idleMs,
    gcMs: a.gcMs + b.gcMs,
    cpuMs: a.cpuMs + b.cpuMs,
    samples: a.samples + b.samples,
  };
}

/** Text rendering: "  42.0 ms  parseRow  /app/csv.js:18" */
export function formatHotspots(profile: SlowCallProfile): string {
  const lines = profile.hotspots.map(h => `  ${h.selfMs.toFixed(1).padStart(7)} ms  ${h.functionName}  ${h.url ? `${h.url.replace(/^file:\/\//, '')}:${h.line}` : '(native)'}`);
  lines.push(`  cpu ${profile.cpuMs.toFixed(1)} ms, idle ${profile.idleMs.toFixed(1)} ms, gc ${profile.gcMs.toFixed(1)} ms`);
  return lines.join('\n');
}

/** Same clock as ExecutionRecord.startTime */
const nowMs = (): number => {
  const perf: any = (globalThis as any).performance || (loadNodeBuiltin('perf_hooks') || {}).performance;
  return perf ? perf.now() : Date.now();
};

export function profileSlowCalls(options: ProfileSlowCallsOptions): SlowCallProfiler {
  const threshold = options.threshold ?? 100;
  const windowMs = options.window ?? 2000;
  const interval = options.samplingIntervalUs ?? 1000;
  const top = options.top ?? 5;
  const inspector = loadNodeBuiltin('inspector');
  const available = !!(inspector && inspector.Session);
  let session: any;
  let pending: ExecutionRecord[] = [];
  /** performance.now() at the profile's start, and the profile's own start (ms) */
  let windowStartNow = 0;
  let stopped = false;
  let timer: any;
  let busy: Promise<void> = Promise.resolve();
  /** The previous window, for calls that started before the current one */
  let previous: { profile: CpuProfile; offset: number; startNow: number } | undefined;

  const post = (method: string, params?: object): Promise<any> => new Promise((resolve, reject) => {
    session.post(method, params || {}, (err: unknown, result: unknown) => (err ? reject(err) : resolve(result)));
  });

  const startWindow = async () => {
    windowStartNow = nowMs();
    await post('Profiler.start');
  };

  const rotate = (restart: boolean): Promise<void> => {
    busy = busy.then(async () => {
      if (!session) return;
      const calls = pending;
      pending = [];
      const startNow = windowStartNow;
      const { profile } = await post('Profiler.stop');
      if (restart && !stopped) await startWindow();
      // Map the call's times (performance.now clock) onto the profile clock
      const offset = profile.startTime / 1000 - startNow;
      for (const call of calls) {
        let result = summariseProfile(profile, call.startTime + offset, call.endTime + offset, top, options.exclude);
        if (previous && call.startTime < startNow) {
          const earlier = summariseProfile(previous.profile, call.startTime + previous.offset, call.endTime + previous.offset, top, options.exclude);
          result = mergeProfiles(earlier, result, top);
        }
        try {
          options.onProfile(call, result);
        } catch {
          // a failing callback must not stop profiling
        }
      }
      previous = { profile, offset, startNow };
    }).catch(() => undefined);
    return busy;
  };

  if (available) {
    try {
      session = new inspector.Session();
      session.connect();
      busy = post('Profiler.enable')
        .then(() => post('Profiler.setSamplingInterval', { interval }))
        .then(startWindow)
        .catch(() => { session = undefined; });
      timer = setInterval(() => rotate(true), windowMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    } catch {
      session = undefined;
    }
  }

  return {
    name: 'profile-slow-calls',
    available,
    onComplete(root) {
      if (!session || stopped || root.duration < threshold) return;
      // Calls reaching back further than the previous window are skipped
      if (root.startTime >= (previous ? previous.startNow : windowStartNow)) pending.push(root);
    },
    flush: () => rotate(true),
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      await rotate(false);
      await busy;
      if (session) {
        try { await post('Profiler.disable'); } catch { /* ignore */ }
        session.disconnect();
        session = undefined;
      }
    },
  };
}

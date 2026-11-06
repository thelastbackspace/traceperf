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
  /** The line in it with the most samples, when the profile has line ticks */
  hotLine?: number;
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
  /**
   * Attribute a function's own samples to the callee seen running under it
   * the most, recovering code V8 inlined into its caller (default false)
   */
  mergeInlined?: boolean;
  /**
   * Choose what to profile in each finished tree: calls and time ranges
   * (performance.now ms). Default: the top-level call, when at least
   * `threshold` ms. Use it to profile, say, only the synchronous part of
   * calls that blocked the event loop.
   */
  select?: (root: ExecutionRecord) => Array<{ call: ExecutionRecord; start: number; end: number }>;
}

export interface SlowCallProfiler extends TracePerfPlugin {
  /** Whether the inspector was available (false in browsers and edge runtimes) */
  readonly available: boolean;
  /** Close the current window now and deliver pending profiles */
  flush(): Promise<void>;
  /** Stop profiling (pending profiles are delivered first) */
  stop(): Promise<void>;
}

/** A node in a V8 CPU profile */
export interface CpuProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  /** Samples per source line (1-based), for the whole profile */
  positionTicks?: Array<{ line: number; ticks: number }>;
}
/** A V8 CPU profile (inspector Profiler.stop result) */
export interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  samples: number[];
  timeDeltas: number[];
}

/**
 * What the profiler learned about which functions call which, kept across
 * profile windows. V8 attributes code it inlined to the caller (at the
 * call-site line), and once code is optimized a window may contain only the
 * inlined form; earlier windows still show the real callee.
 */
export interface InlineHints {
  callees: Map<string, Map<string, number>>;
  frames: Map<string, { name: string; url: string; line: number; column: number; hotLine?: number; hits: number }>;
}

export function createInlineHints(): InlineHints {
  return { callees: new Map(), frames: new Map() };
}

const isUserFrame = (n: CpuProfileNode | undefined, exclude?: RegExp): boolean =>
  !!n && !!n.callFrame.url && !n.callFrame.url.startsWith('node:') && !(exclude && exclude.test(n.callFrame.url));
const fnKey = (n: CpuProfileNode): string =>
  `${n.callFrame.functionName}|${n.callFrame.url}|${n.callFrame.lineNumber}|${n.callFrame.columnNumber}`;
const hottestLine = (n: CpuProfileNode): number | undefined =>
  n.positionTicks && n.positionTicks.length ? n.positionTicks.reduce((a, b) => (b.ticks > a.ticks ? b : a)).line : undefined;

/** Add a profile's caller -> callee sample counts (by function) to the hints */
export function learnInlineHints(profile: CpuProfile, hints: InlineHints, exclude?: RegExp): void {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const hits = new Map<number, number>();
  for (const id of profile.samples) hits.set(id, (hits.get(id) || 0) + 1);
  const subtree = new Map<number, number>();
  const total = (id: number): number => {
    const cached = subtree.get(id);
    if (cached !== undefined) return cached;
    subtree.set(id, 0); // guards against cycles in malformed input
    const sum = (hits.get(id) || 0) + ((nodes.get(id) as any)?.children || []).reduce((acc: number, c: number) => acc + total(c), 0);
    subtree.set(id, sum);
    return sum;
  };
  for (const n of profile.nodes) {
    if (!isUserFrame(n, exclude)) continue;
    const key = fnKey(n);
    const own = hits.get(n.id) || 0;
    const frame = hints.frames.get(key);
    // Remember where the function itself is hot, from its non-inlined samples
    if (!frame || own > frame.hits) {
      hints.frames.set(key, {
        name: n.callFrame.functionName || '(anonymous)', url: n.callFrame.url,
        line: n.callFrame.lineNumber + 1, column: n.callFrame.columnNumber + 1, hotLine: hottestLine(n), hits: own,
      });
    }
    for (const c of (n as any).children || []) {
      const child = nodes.get(c);
      if (!isUserFrame(child, exclude) || total(c) === 0) continue;
      const ck = fnKey(child as CpuProfileNode);
      if (ck === key) continue;
      const m = hints.callees.get(key) ?? new Map<string, number>();
      m.set(ck, (m.get(ck) || 0) + total(c));
      hints.callees.set(key, m);
    }
  }
}

/**
 * Summarise the samples of a profile that fall within [start, end] (ms,
 * profile clock). With `mergeInlined` (true, or hints kept across profiles),
 * a function's own samples move to the callee seen running under it the most
 * (recursively): most likely the code V8 inlined there.
 */
export function summariseProfile(profile: CpuProfile, start: number, end: number, top = 5, exclude?: RegExp, options: { mergeInlined?: boolean | InlineHints } = {}): SlowCallProfile {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  let hints: InlineHints | undefined;
  if (options.mergeInlined) {
    hints = options.mergeInlined === true ? createInlineHints() : options.mergeInlined;
    if (options.mergeInlined === true) learnInlineHints(profile, hints, exclude);
  }
  const self = new Map<string, Hotspot>();
  // Function start lines per script, to recover functions V8 inlined into a caller
  const starts = new Map<string, Array<{ line: number; column: number; name: string }>>();
  for (const n of profile.nodes) {
    const f = n.callFrame;
    if (!f.url || !f.functionName) continue;
    const list = starts.get(f.url) ?? [];
    if (!list.some(x => x.line === f.lineNumber + 1 && x.name === f.functionName)) list.push({ line: f.lineNumber + 1, column: f.columnNumber + 1, name: f.functionName });
    starts.set(f.url, list);
  }
  type Frame = { name: string; url: string; line: number; column: number; hotLine?: number };
  const resolved = new Map<number, Frame>();
  const parent = new Map<number, number>();
  if (hints) for (const n of profile.nodes) for (const c of (n as any).children || []) parent.set(c, n.id);
  const SPECIAL = /^\((idle|garbage collector|program|root)\)$/;
  /** The function a sample is really in, and its hottest line */
  const locate = (node: CpuProfileNode): Frame => {
    const cached = resolved.get(node.id);
    if (cached) return cached;
    const { functionName, url, lineNumber, columnNumber } = node.callFrame;
    let frame: Frame = { name: functionName || '(anonymous)', url, line: lineNumber + 1, column: columnNumber + 1 };
    const hotLine = hottestLine(node);
    if (hotLine !== undefined) frame.hotLine = hotLine;
    // Native code and Node internals: name the nearest calling function of
    // the app, and the Node API in between ("hashPassword → pbkdf2Sync")
    if (hints && !isUserFrame(node, exclude) && !SPECIAL.test(functionName)) {
      let api = '';
      let id = parent.get(node.id);
      for (let depth = 0; id !== undefined && depth < 64; depth++, id = parent.get(id)) {
        const up = nodes.get(id);
        if (!up) break;
        if (isUserFrame(up, exclude)) {
          const inner = api || functionName || '(native)';
          frame = {
            name: `${up.callFrame.functionName || '(anonymous)'} → ${inner}`,
            url: up.callFrame.url, line: up.callFrame.lineNumber + 1, column: up.callFrame.columnNumber + 1,
          };
          const callLine = hottestLine(up);
          if (callLine !== undefined) frame.hotLine = callLine;
          break;
        }
        // The outermost Node API frame below the app's code
        if (up.callFrame.functionName && up.callFrame.url.startsWith('node:')) api = up.callFrame.functionName;
      }
    } else if (hints && isUserFrame(node, exclude)) {
      let key = fnKey(node);
      const seen = new Set<string>([key]);
      for (let depth = 0; depth < 64; depth++) {
        const m = hints.callees.get(key);
        if (!m || m.size === 0) break;
        const next = [...m.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
        if (seen.has(next)) break;
        seen.add(next);
        key = next;
      }
      const f = key !== fnKey(node) ? hints.frames.get(key) : undefined;
      if (f) frame = { name: f.name, url: f.url, line: f.line, column: f.column, ...(f.hotLine !== undefined ? { hotLine: f.hotLine } : {}) };
    } else if (hotLine !== undefined && hotLine < frame.line) {
      // A hot line before the function even starts belongs to an inlined
      // callee: the function defined nearest above that line in the script
      const candidates = (starts.get(url) || []).filter(x => x.line <= hotLine);
      if (candidates.length) {
        const fn = candidates.reduce((a, b) => (b.line > a.line ? b : a));
        frame = { name: fn.name, url, line: fn.line, column: fn.column, hotLine };
      }
    }
    resolved.set(node.id, frame);
    return frame;
  };
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
    const { functionName, url } = node.callFrame;
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
    const at = locate(node);
    const key = `${at.name}|${at.url}|${at.line}|${at.column}|${at.hotLine}`;
    const entry = self.get(key) ?? {
      functionName: at.name, url: at.url, line: at.line, column: at.column, selfMs: 0,
      ...(at.hotLine !== undefined ? { hotLine: at.hotLine } : {}),
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
    const key = `${h.functionName}|${h.url}|${h.line}|${h.column}|${h.hotLine}`;
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

/** One profiled blocking call, as written by traceperf/auto (TRACEPERF_PROFILE_OUTPUT) */
export interface BlockingProfileEntry {
  label: string;
  hotspots: Hotspot[];
}

/**
 * Sum hotspots per call label across many blocking calls, largest first.
 * Locations become "path:line", relative to `cwd` when inside it.
 */
export function blockingHotspots(entries: BlockingProfileEntry[], options: { cwd?: string; top?: number } = {}): Record<string, Array<{ functionName: string; location: string; ms: number }>> {
  const byLabel = new Map<string, Map<string, { functionName: string; location: string; ms: number; lines: Map<string, number> }>>();
  const cwd = options.cwd ? options.cwd.replace(/\\/g, '/').replace(/\/?$/, '/') : undefined;
  for (const entry of entries) {
    const spots = byLabel.get(entry.label) ?? new Map();
    byLabel.set(entry.label, spots);
    for (const h of entry.hotspots) {
      let file = h.url.replace(/^file:\/\//, '');
      try {
        file = decodeURIComponent(file);
      } catch {
        // keep as is
      }
      if (cwd && file.startsWith(cwd)) file = file.slice(cwd.length);
      const location = file ? `${file}:${h.hotLine ?? h.line}` : '';
      // One entry per function; it shows the line with the most time
      const key = `${h.functionName}|${file}`;
      const spot = spots.get(key) ?? { functionName: h.functionName || '(anonymous)', location, ms: 0, lines: new Map<string, number>() };
      spot.ms += h.selfMs;
      spot.lines.set(location, (spot.lines.get(location) || 0) + h.selfMs);
      spots.set(key, spot);
    }
  }
  const out: Record<string, Array<{ functionName: string; location: string; ms: number }>> = {};
  byLabel.forEach((spots, label) => {
    out[label] = [...spots.values()]
      .map(({ lines, ...spot }) => ({ ...spot, location: [...lines.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0] }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, options.top ?? 5);
  });
  return out;
}

export function profileSlowCalls(options: ProfileSlowCallsOptions): SlowCallProfiler {
  const threshold = options.threshold ?? 100;
  const windowMs = options.window ?? 2000;
  const interval = options.samplingIntervalUs ?? 1000;
  const top = options.top ?? 5;
  const inspector = loadNodeBuiltin('inspector');
  const available = !!(inspector && inspector.Session);
  let session: any;
  let pending: Array<{ call: ExecutionRecord; start: number; end: number }> = [];
  /** performance.now() at the profile's start, and the profile's own start (ms) */
  let windowStartNow = 0;
  let stopped = false;
  let timer: any;
  let busy: Promise<void> = Promise.resolve();
  /** The previous window, for calls that started before the current one */
  let previous: { profile: CpuProfile; offset: number; startNow: number } | undefined;
  const hints = options.mergeInlined ? createInlineHints() : undefined;

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
      if (hints) learnInlineHints(profile, hints, options.exclude);
      // Map the call's times (performance.now clock) onto the profile clock
      const offset = profile.startTime / 1000 - startNow;
      for (const { call, start, end } of calls) {
        let result = summariseProfile(profile, start + offset, end + offset, top, options.exclude, { mergeInlined: hints });
        if (previous && start < startNow) {
          const earlier = summariseProfile(previous.profile, start + previous.offset, end + previous.offset, top, options.exclude, { mergeInlined: hints });
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
      if (!session || stopped) return;
      const ranges = options.select
        ? options.select(root)
        : root.duration >= threshold ? [{ call: root, start: root.startTime, end: root.endTime }] : [];
      // Ranges reaching back further than the previous window are skipped
      const earliest = previous ? previous.startNow : windowStartNow;
      for (const range of ranges) if (range.start >= earliest) pending.push(range);
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

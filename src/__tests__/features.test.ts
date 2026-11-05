/**
 * Results API, statistics, exporters and ergonomics.
 */
import {
  createTracePerf,
  ExecutionRecord,
  formatTree,
  jsonLinesExporter,
  monitorEventLoop,
  openTelemetryExporter,
  toChromeTrace,
  TrackingMode,
  StatsCollector,
  OtelApiLike,
} from '../index';
import { busyWait, captureLogs } from './helpers/console';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('results API', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  test('onComplete receives each finished tree, even when silent', () => {
    const roots: ExecutionRecord[] = [];
    const tp = createTracePerf({ silent: true, onComplete: r => roots.push(r) });
    const child = tp.createTrackable(() => 1, { label: 'child' });
    tp.track(() => child() + child(), { label: 'parent' });
    expect(logs.lines()).toEqual([]);
    expect(roots).toHaveLength(1);
    expect(roots[0].label).toBe('parent');
    expect(roots[0].children.map(c => c.label)).toEqual(['child', 'child']);
    expect(roots[0].children[0].parentId).toBe(roots[0].id);
  });

  test('onComplete unsubscribe stops delivery', () => {
    const tp = createTracePerf({ silent: true });
    const seen: string[] = [];
    const off = tp.onComplete(r => seen.push(r.label));
    tp.track(() => 1, { label: 'a' });
    off();
    tp.track(() => 1, { label: 'b' });
    expect(seen).toEqual(['a']);
  });

  test('PERFORMANCE mode is no longer a black box: stats and hooks still work', () => {
    const roots: ExecutionRecord[] = [];
    const tp = createTracePerf({ trackingMode: TrackingMode.PERFORMANCE, onComplete: r => roots.push(r) });
    tp.track(() => 1, { label: 'perf' });
    expect(logs.lines()).toEqual([]);
    expect(roots).toHaveLength(1);
    expect(tp.getStats('perf')!.count).toBe(1);
  });

  test('a throwing plugin never breaks tracked code and warns once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    try {
      const tp = createTracePerf({ silent: true });
      tp.use({ name: 'broken', onStart() { throw new Error('start'); }, onComplete() { throw new Error('done'); } });
      expect(tp.track(() => 1)).toBe(1);
      expect(tp.track(() => 2)).toBe(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('broken');
    } finally {
      warn.mockRestore();
    }
  });

  test('custom reporter replaces console output and gets the record', () => {
    const reported: string[] = [];
    const tp = createTracePerf({ reporter: r => reported.push(formatTree(r)) });
    tp.track(() => 1, { label: 'custom' });
    expect(logs.lines()).toEqual([]);
    expect(reported[0]).toMatch(/^└─ custom: /);
  });
});

describe('timing detail', () => {
  test('selfDuration excludes children, also when children overlap', async () => {
    const roots: ExecutionRecord[] = [];
    const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
    const wait = (label: string, ms: number) => tp.track(() => sleep(ms), { label });
    await tp.track(async () => {
      busyWait(15);
      await Promise.all([wait('a', 40), wait('b', 40)]);
    }, { label: 'root' });
    const root = roots[0];
    expect(root.duration).toBeGreaterThanOrEqual(50);
    // naive "duration - sum(children)" would go negative here
    expect(root.selfDuration).toBeGreaterThanOrEqual(10);
    expect(root.selfDuration).toBeLessThan(root.duration - 30);
  });

  test('async calls report the synchronous part separately', async () => {
    const roots: ExecutionRecord[] = [];
    const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
    await tp.track(async () => {
      busyWait(20);
      await sleep(30);
    }, { label: 'mixed' });
    tp.track(() => busyWait(5), { label: 'sync' });
    const [mixed, sync] = roots;
    expect(mixed.async).toBe(true);
    expect(mixed.syncDuration).toBeGreaterThanOrEqual(18);
    expect(mixed.syncDuration).toBeLessThan(mixed.duration - 20);
    expect(sync.async).toBe(false);
    expect(sync.syncDuration).toBe(sync.duration);
  });

  test('detailed output shows self/sync time and flags event-loop blocking', async () => {
    const logs = captureLogs();
    try {
      const tp = createTracePerf({ trackingMode: TrackingMode.DETAILED, trackMemory: false, blockingThreshold: 20 });
      const child = tp.createTrackable(() => busyWait(25), { label: 'child' });
      await tp.track(async () => { child(); await sleep(5); }, { label: 'parent' });
      const text = logs.text();
      expect(text).toMatch(/└─ parent: [\d.]+ ms \(self [\d.]+ ms, sync [\d.]+ ms\) ⚠ blocked event loop/);
      expect(text).toMatch(/└─ child: [\d.]+ ms ⚠ blocked event loop/);
    } finally {
      logs.restore();
    }
  });

  test('balanced output is unchanged (no self/sync noise)', () => {
    const logs = captureLogs();
    try {
      const tp = createTracePerf({ trackMemory: false });
      tp.track(() => tp.track(() => 1, { label: 'c' }), { label: 'p' });
      expect(logs.lines()[0]).toMatch(/^└─ p: [\d.]+ ms\n {2}└─ c: [\d.]+ ms$/);
    } finally {
      logs.restore();
    }
  });

  test('negative heap deltas are labelled as GC', () => {
    const record = {
      id: '1', label: 'x', parentId: null, startTime: 0, endTime: 1, startEpochMs: 0, duration: 1,
      selfDuration: 1, syncDuration: 1, async: false, children: [], threshold: 0, trackingMode: 'balanced',
      silent: false, memoryDelta: -2048,
    } as ExecutionRecord;
    expect(formatTree(record)).toBe('└─ x: 1.000 ms 📊 -2.00 KB (gc)');
  });
});

describe('statistics', () => {
  test('percentiles, min/max/mean are computed correctly', () => {
    // Deterministic: feed known durations straight into the collector
    const collector = new StatsCollector({ reservoirSize: 1000 });
    const record = (duration: number, error?: unknown) => ({
      id: 'x', label: 'op', parentId: null, startTime: 0, endTime: duration, startEpochMs: 0, duration,
      selfDuration: duration / 2, syncDuration: duration, async: false, children: [], threshold: 0,
      trackingMode: 'balanced', silent: true, ...(error ? { error } : {}),
    }) as ExecutionRecord;
    for (let i = 1; i <= 100; i++) collector.add(record(i, i === 100 ? new Error('x') : undefined));
    expect(collector.get('op')).toEqual({
      count: 100, errors: 1, total: 5050, mean: 50.5, min: 1, max: 100,
      p50: 50, p95: 95, p99: 99, selfMean: 25.25,
    });
  });

  test('tracked calls feed stats: counts and errors are exact', () => {
    const tp = createTracePerf({ silent: true });
    const f = tp.createTrackable((ms: number) => { busyWait(ms); if (ms > 20) throw new Error('slow'); }, { label: 'work' });
    for (const ms of [0, 0, 0, 0, 30]) {
      try { f(ms); } catch { /* expected */ }
    }
    const s = tp.getStats('work')!;
    expect(s.count).toBe(5);
    expect(s.errors).toBe(1);
    expect(s.max).toBeGreaterThanOrEqual(29);
    expect(s.p50).toBeLessThan(s.max);
    expect(s.min).toBeLessThanOrEqual(s.p50);
    expect(s.mean).toBeCloseTo(s.total / 5, 6);
  });

  test('memory stays bounded with many calls and many labels', () => {
    const tp = createTracePerf({ silent: true, trackMemory: false, stats: { reservoirSize: 16, maxLabels: 10 } });
    for (let i = 0; i < 5000; i++) tp.track(() => i, { label: `label-${i % 50}` });
    const stats = tp.getStats();
    expect(Object.keys(stats)).toHaveLength(10);
    expect(stats['(other)'].count).toBe(5000 - 9 * 100);
    const internal = (tp as any).executionTracker.stats.labels.get('label-0');
    expect(internal.samples.length).toBe(16);
  });

  test('formatStats renders a table; stats: false disables collection', () => {
    const tp = createTracePerf({ silent: true });
    tp.track(() => 1, { label: 'tabled' });
    expect(tp.formatStats()).toMatch(/label\s+calls[\s\S]*tabled\s+1/);
    const off = createTracePerf({ silent: true, stats: false });
    off.track(() => 1, { label: 'x' });
    expect(off.getStats()).toEqual({});
    expect(off.formatStats()).toBe('traceperf: no calls recorded');
  });

  test('reset() and resetStats() clear statistics', () => {
    const tp = createTracePerf({ silent: true });
    tp.track(() => 1, { label: 'a' });
    tp.resetStats();
    expect(tp.getStats()).toEqual({});
    tp.track(() => 1, { label: 'a' });
    tp.reset();
    expect(tp.getStats()).toEqual({});
  });
});

describe('exporters', () => {
  test('startTrace() produces a valid, properly nested Chrome trace', async () => {
    const tp = createTracePerf({ silent: true, trackMemory: false });
    const recording = tp.startTrace();
    const leaf = (label: string, ms: number) => tp.track(() => sleep(ms), { label });
    await tp.track(async () => {
      await Promise.all([leaf('a', 20), leaf('b', 20)]);
    }, { label: 'root' });
    const trace = recording.stop();
    tp.track(() => 1, { label: 'after-stop' });
    const events = trace.traceEvents.filter(e => e.ph === 'X');
    expect(events.map(e => e.name).sort()).toEqual(['a', 'b', 'root']);
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
    // Within one tid, complete events must nest strictly
    const byTid = new Map<number, typeof events>();
    events.forEach(e => byTid.set(e.tid, [...(byTid.get(e.tid) || []), e]));
    byTid.forEach(list => {
      const sorted = list.slice().sort((x, y) => x.ts - y.ts);
      const stack: number[] = [];
      for (const e of sorted) {
        while (stack.length && stack[stack.length - 1] <= e.ts) stack.pop();
        if (stack.length) expect(e.ts + e.dur!).toBeLessThanOrEqual(stack[stack.length - 1]);
        stack.push(e.ts + e.dur!);
      }
    });
    // a and b overlap, so they cannot share a lane
    const a = events.find(e => e.name === 'a')!;
    const b = events.find(e => e.name === 'b')!;
    expect(a.tid).not.toBe(b.tid);
    expect(recording.roots).toHaveLength(1);
  });

  test('toChromeTrace keeps sequential children on the parent lane', () => {
    const tp = createTracePerf({ silent: true });
    const roots: ExecutionRecord[] = [];
    tp.onComplete(r => roots.push(r));
    const c = tp.createTrackable(() => busyWait(1), { label: 'c' });
    tp.track(() => { c(); c(); }, { label: 'p' });
    const tids = new Set(toChromeTrace(roots).traceEvents.filter(e => e.ph === 'X').map(e => e.tid));
    expect(tids.size).toBe(1);
  });

  test('openTelemetryExporter emits spans with times, parents and errors', () => {
    const spans: any[] = [];
    const contexts: any[] = [];
    const api: OtelApiLike = {
      context: { active: () => 'request-context' },
      trace: {
        setSpan: (ctx, span) => ({ ctx, span }),
        getTracer: () => ({
          startSpan(name, options, ctx) {
            const span: any = { name, options, ctx, attributes: {}, status: undefined, exceptions: [] as unknown[] };
            span.setAttribute = (k: string, v: unknown) => { span.attributes[k] = v; };
            span.recordException = (e: unknown) => span.exceptions.push(e);
            span.setStatus = (s: unknown) => { span.status = s; };
            span.end = (t: number) => { span.endTime = t; };
            spans.push(span);
            contexts.push(ctx);
            return span;
          },
        }),
      },
    };
    const tp = createTracePerf({ silent: true, plugins: [openTelemetryExporter(api)] });
    const failing = tp.createTrackable(() => { throw new Error('db down'); }, { label: 'query' });
    expect(() => tp.track(() => failing(), { label: 'handler' })).toThrow('db down');
    const [handler, query] = spans;
    expect(handler.name).toBe('handler');
    expect(handler.ctx).toBe('request-context');
    expect(query.ctx).toEqual({ ctx: 'request-context', span: handler });
    expect(query.status).toEqual({ code: 2, message: 'db down' });
    expect(query.exceptions[0]).toBeInstanceOf(Error);
    expect(handler.options.startTime).toBeGreaterThan(Date.now() - 60000);
    expect(handler.endTime).toBeGreaterThanOrEqual(handler.options.startTime);
  });

  test('jsonLinesExporter writes one JSON document per tree', () => {
    const lines: string[] = [];
    const tp = createTracePerf({ silent: true, plugins: [jsonLinesExporter(l => lines.push(l))] });
    tp.track(() => tp.track(() => 1, { label: 'inner' }), { label: 'outer' });
    expect(lines).toHaveLength(1);
    const doc = JSON.parse(lines[0]);
    expect(doc.label).toBe('outer');
    expect(doc.children[0].label).toBe('inner');
    expect(typeof doc.durationMs).toBe('number');
    expect(new Date(doc.start).getTime()).toBeGreaterThan(0);
  });
});

describe('ergonomics', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  test('start() spans: run() nests tracked calls, end() records once', async () => {
    const roots: ExecutionRecord[] = [];
    const tp = createTracePerf({ silent: true, onComplete: r => roots.push(r) });
    const span = tp.start('GET /users');
    await span.run(async () => {
      await sleep(5);
      tp.track(() => 1, { label: 'db.query' });
    });
    span.setLabel('GET /users/:id');
    span.end();
    span.end();
    expect(roots).toHaveLength(1);
    expect(roots[0].label).toBe('GET /users/:id');
    expect(roots[0].children.map(c => c.label)).toEqual(['db.query']);
    // run() returned a promise right away: the span's sync part is tiny
    expect(roots[0].async).toBe(true);
    expect(roots[0].syncDuration).toBeLessThan(roots[0].duration);
  });

  test('start() is a no-op span when disabled', () => {
    const tp = createTracePerf({ enabled: false });
    const span = tp.start('x');
    expect(span.id).toBe('');
    expect(span.run(() => 5)).toBe(5);
    span.end();
    expect(logs.lines()).toEqual([]);
  });

  test('disable()/enable() turn tracking off and on for existing wrappers', () => {
    const tp = createTracePerf({ silent: true });
    const f = tp.createTrackable(() => 1, { label: 'f' });
    tp.disable();
    expect(tp.isEnabled()).toBe(false);
    expect(f()).toBe(1);
    expect(tp.getStats('f')).toBeUndefined();
    tp.enable();
    f();
    expect(tp.getStats('f')!.count).toBe(1);
  });

  test('@traced works as a TS 5 standard decorator', async () => {
    const tp = createTracePerf({ silent: true });
    class UserService {
      private prefix = 'user';
      @tp.traced()
      async getUser(id: number) {
        await sleep(1);
        return `${this.prefix}:${id}`;
      }
      @tp.traced({ label: 'custom.label' })
      static version() {
        return 2;
      }
    }
    expect(await new UserService().getUser(7)).toBe('user:7');
    expect(UserService.version()).toBe(2);
    expect(tp.getStats('UserService.getUser')!.count).toBe(1);
    expect(tp.getStats('custom.label')!.count).toBe(1);
    expect(UserService.prototype.getUser.name).toBe('getUser');
  });

  test('@traced works as a legacy (experimentalDecorators) decorator', () => {
    const tp = createTracePerf({ silent: true });
    class Repo {
      find() { return 'found'; }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Repo.prototype, 'find')!;
    const result = tp.traced()(Repo.prototype, 'find', descriptor);
    Object.defineProperty(Repo.prototype, 'find', result);
    expect(new Repo().find()).toBe('found');
    expect(tp.getStats('Repo.find')!.count).toBe(1);
    expect(() => tp.traced()({}, { kind: 'field', name: 'x' })).toThrow(TypeError);
  });

  test('trackObject tracks prototype methods and keeps state on the original', () => {
    class Counter {
      #count = 0;
      increment() { this.#count++; return this.total(); }
      total() { return this.#count; }
    }
    const tp = createTracePerf({ silent: true });
    const original = new Counter();
    const tracked = tp.trackObject(original);
    expect(tracked.increment()).toBe(1);
    expect(tracked.increment()).toBe(2);
    expect(original.total()).toBe(2);
    expect(tp.getStats('Counter.increment')!.count).toBe(2);
    expect(tracked.increment).toBe(tracked.increment);
    expect(tracked instanceof Counter).toBe(true);
  });

  test('trackObject on plain objects uses an optional prefix', () => {
    const tp = createTracePerf({ silent: true });
    const svc = tp.trackObject({ name: 'svc', hello() { return `hi ${this.name}`; } }, { prefix: 'svc.' });
    expect(svc.hello()).toBe('hi svc');
    svc.name = 'renamed';
    expect(svc.hello()).toBe('hi renamed');
    expect(tp.getStats('svc.hello')!.count).toBe(2);
  });

  test('options are strictly typed (typos fail to compile)', () => {
    const tp = createTracePerf({ silent: true });
    // @ts-expect-error misspelled option
    tp.track(() => 1, { treshold: 5 });
    // @ts-expect-error unknown tracking mode
    createTracePerf({ trackingMode: 'fast' });
    expect(true).toBe(true);
  });
});

describe('event loop monitor', () => {
  test('reports event-loop delay caused by blocking work', async () => {
    const loop = monitorEventLoop({ resolution: 1 });
    expect(loop.supported).toBe(true);
    await sleep(20);
    setTimeout(() => busyWait(60), 1);
    await sleep(100);
    const stats = loop.stats()!;
    loop.stop();
    expect(stats.max).toBeGreaterThanOrEqual(40);
    expect(stats.p50).toBeGreaterThanOrEqual(0);
  });
});

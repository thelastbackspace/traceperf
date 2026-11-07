/**
 * Regression tests for the browser entry (traceperf/browser) as used in the
 * README: createTracePerf({...}).track / createTrackable.
 */
import { createTracePerf, BrowserLogger, TrackingMode } from '../browser';
import { busyWait, captureLogs, withVirtualClock } from './helpers/console';

describe('browser tracking', () => {
  let logs: ReturnType<typeof captureLogs>;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    logs = captureLogs();
    warn = jest.spyOn(console, 'warn').mockImplementation();
  });
  afterEach(() => {
    logs.restore();
    warn.mockRestore();
  });

  const durationOf = (text: string, label: string): number => {
    const m = text.match(new RegExp(`${label} \\(([0-9.]+)ms\\)`));
    if (!m) throw new Error(`no line for ${label} in:\n${text}`);
    return parseFloat(m[1]);
  };

  test('README config options are accepted (silent, trackMemory, threshold)', () => {
    const tracker = createTracePerf({ trackingMode: TrackingMode.BALANCED, trackMemory: true, threshold: 0, silent: false });
    expect(tracker.track(() => 1, { label: 'cfg' })).toBe(1);
    expect(logs.text()).toContain('cfg');
  });

  test('async functions are timed until they settle and printed after', async () => {
    const tracker = createTracePerf();
    const pending = tracker.track(async () => {
      await new Promise(r => setTimeout(r, 30));
      return 'done';
    }, { label: 'fetchData' });
    expect(logs.lines()).toEqual([]);
    expect(await pending).toBe('done');
    expect(durationOf(logs.text(), 'fetchData')).toBeGreaterThanOrEqual(25);
  });

  test('async rejections are rethrown and still reported', async () => {
    const tracker = createTracePerf();
    const err = new Error('nope');
    await expect(tracker.track(async () => { throw err; }, { label: 'failing' })).rejects.toBe(err);
    expect(logs.text()).toContain('failing');
  });

  test('each call prints only its own tree, and history is not retained', () => {
    const tracker = createTracePerf();
    tracker.track(() => 1, { label: 'first' });
    tracker.track(() => 2, { label: 'second' });
    expect(logs.lines()).toHaveLength(2);
    expect(logs.lines()[1]).not.toContain('first');
    for (let i = 0; i < 500; i++) tracker.track(() => i, { silent: true });
    const core = (tracker as any).executionTracker;
    expect(core.executionTree.size).toBe(0);
    expect(core.activeExecutions.size).toBe(0);
  });

  test('nested createTrackable calls print once, as one tree', () => {
    const tracker = createTracePerf();
    const child = tracker.createTrackable((x: number) => x * 2, { label: 'child' });
    const parent = tracker.createTrackable((x: number) => child(x) + 1, { label: 'parent' });
    expect(parent(2)).toBe(5);
    expect(logs.lines()).toHaveLength(1);
    expect(logs.lines()[0]).toMatch(/→ parent \(.*\n {2}→ child \(/);
  });

  test('instance and per-call silent are honoured', () => {
    createTracePerf({ silent: true }).track(() => 1, { label: 'a' });
    createTracePerf().track(() => 1, { label: 'b', silent: true });
    expect(logs.lines()).toEqual([]);
  });

  test('threshold hides fast calls', withVirtualClock(() => {
    const tracker = createTracePerf({ threshold: 60 });
    tracker.track(() => 1, { label: 'fastOperation' });
    tracker.track(() => busyWait(70), { label: 'slowOperation' });
    createTracePerf().track(() => 1, { label: 'perCallFast', threshold: 60 });
    expect(logs.text()).not.toContain('fastOperation');
    expect(logs.text()).not.toContain('perCallFast');
    expect(logs.text()).toContain('slowOperation');
  }));

  test('createTracePerf({ logger }) uses the given BrowserLogger', () => {
    const logger = new BrowserLogger({ silent: true });
    const tracker = createTracePerf({ logger });
    expect(tracker).toBe(logger);
    tracker.track(() => 1, { label: 'viaLogger' });
    expect(logs.lines()).toEqual([]);
  });

  test('no console.warn noise where performance.memory/window are missing (SSR, workers)', () => {
    createTracePerf({ trackMemory: true }).track(() => 1, { label: 'ssr' });
    expect(warn).not.toHaveBeenCalled();
  });

  test('createTrackable preserves name, length and this', () => {
    const tracker = createTracePerf({ silent: true });
    function add(this: { base: number }, a: number, b: number) { return this.base + a + b; }
    const tracked = tracker.createTrackable(add);
    expect(tracked.name).toBe('add');
    expect(tracked.length).toBe(2);
    expect(tracked.call({ base: 1 }, 2, 3)).toBe(6);
  });
});

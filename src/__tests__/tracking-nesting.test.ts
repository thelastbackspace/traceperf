/**
 * Regression: nested tracked calls must form one execution tree that is
 * printed once when the outermost call finishes, and finished executions
 * must not be retained forever.
 */
import { createTracePerf, OptimizedPerformanceMonitor } from '../index';
import { busyWait, captureLogs } from './helpers/console';

function internals(tp: OptimizedPerformanceMonitor): { tree: Record<string, unknown>; active: Map<string, unknown> } {
  const tracker = (tp as any).executionTracker;
  return { tree: tracker.executionTree, active: tracker.activeExecutions };
}

function durationOf(text: string, label: string): number {
  const m = text.match(new RegExp(`${label}: ([0-9.]+) ms`));
  if (!m) throw new Error(`no line for ${label} in:\n${text}`);
  return parseFloat(m[1]);
}

describe('nested tracking', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  test('createTrackable children print inside the parent tree, once', () => {
    const tp = createTracePerf({ enableNestedTracking: true, trackMemory: false });
    const transform = tp.createTrackable((d: number[]) => d.map(x => x * 2), { label: 'transformData' });
    const processData = tp.createTrackable((d: number[]) => transform(d), { label: 'processData' });
    const out = tp.track(() => processData([1, 2, 3]), { label: 'mainOperation' });

    expect(out).toEqual([2, 4, 6]);
    expect(logs.lines()).toHaveLength(1);
    const lines = logs.lines()[0].split('\n');
    expect(lines[0]).toMatch(/^└─ mainOperation: /);
    expect(lines[1]).toMatch(/^ {2}└─ processData: /);
    expect(lines[2]).toMatch(/^ {4}└─ transformData: /);
  });

  test('children awaited after an await are attached to the right parent', async () => {
    const tp = createTracePerf({ enableNestedTracking: true, trackMemory: false });
    const fetchData = () => tp.track(async () => {
      await new Promise(r => setTimeout(r, 5));
      return [1];
    }, { label: 'fetchData' });
    const transformData = (d: number[]) => tp.track(() => d.length, { label: 'transformData' });

    const result = await tp.track(async () => {
      await new Promise(r => setTimeout(r, 1));
      const data = await fetchData();
      return transformData(data);
    }, { label: 'processData' });

    expect(result).toBe(1);
    expect(logs.lines()).toHaveLength(1);
    const text = logs.text();
    expect(text).toMatch(/^└─ processData: .*\n {2}├─ fetchData: .*\n {2}└─ transformData: /);
    expect(durationOf(text, 'processData')).toBeGreaterThanOrEqual(durationOf(text, 'fetchData'));
  });

  test('concurrent async roots do not adopt each other\'s children', async () => {
    const tp = createTracePerf({ enableNestedTracking: true, trackMemory: false });
    const job = (name: string, ms: number) => tp.track(async () => {
      await new Promise(r => setTimeout(r, ms));
      tp.track(() => busyWait(0), { label: `${name}-child` });
    }, { label: name });
    await Promise.all([job('A', 10), job('B', 5)]);
    const [first, second] = logs.lines();
    expect(first).toMatch(/B: [\s\S]*B-child/);
    expect(first).not.toContain('A-child');
    expect(second).toMatch(/A: [\s\S]*A-child/);
  });

  test('enableNestedTracking: false prints each call on its own', () => {
    const tp = createTracePerf({ enableNestedTracking: false, trackMemory: false });
    tp.track(() => tp.track(() => 1, { label: 'inner' }), { label: 'outer' });
    expect(logs.lines()).toHaveLength(2);
  });

  test('finished executions are released (no unbounded growth)', async () => {
    const tp = createTracePerf({ silent: true });
    const leaf = tp.createTrackable(() => new Array(1000).fill(0));
    const parent = tp.createTrackable(() => leaf().length + leaf().length);
    for (let i = 0; i < 2000; i++) parent();
    for (let i = 0; i < 50; i++) await tp.track(async () => leaf());
    const { tree, active } = internals(tp);
    expect(Object.keys(tree)).toHaveLength(0);
    expect(active.size).toBe(0);
  });
});

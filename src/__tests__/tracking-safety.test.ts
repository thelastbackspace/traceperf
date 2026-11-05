/**
 * Regression: tracking must never change program behaviour or crash
 * on unusual values (thenables, odd arguments, non-Error throws).
 */
import { createTracePerf, TrackingMode } from '../index';
import { captureLogs } from './helpers/console';

describe('tracking safety', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  test('captureArgs with a null-prototype object does not throw', () => {
    const tp = createTracePerf();
    const f = tp.createTrackable((o: object) => Object.keys(o).length, { captureArgs: true });
    expect(f(Object.create(null))).toBe(0);
  });

  test('captureArgs handles circular and very large arguments', () => {
    const tp = createTracePerf();
    const circular: any = { a: 1 };
    circular.self = circular;
    const big = 'x'.repeat(1_000_000);
    const f = tp.createTrackable((..._args: unknown[]) => 'ok', { captureArgs: true, label: 'argsFn' });
    expect(f(circular, big, [1, 2, 3], () => 0, Symbol('s'))).toBe('ok');
    const line = logs.text();
    expect(line).toContain('argsFn(');
    expect(line.length).toBeLessThan(500);
  });

  test('captureArgs shows the arguments in the output (issue #1)', () => {
    const tp = createTracePerf({ trackMemory: false });
    const getUser = tp.createTrackable((id: number, opts: object) => ({ id, opts }), { label: 'getUser', captureArgs: true });
    getUser(123, { cache: true });
    expect(logs.text()).toMatch(/getUser\(123, \{"cache":true\}\): /);
  });

  test('a non-promise thenable is returned untouched and does not crash', () => {
    const tp = createTracePerf({ silent: true });
    const thenable = { then: (res: (v: number) => void) => res(5) };
    expect(tp.track(() => thenable)).toBe(thenable);
  });

  test('throwing a non-Error value rethrows it unchanged', () => {
    const tp = createTracePerf({ trackingMode: TrackingMode.DETAILED });
    let caught: unknown;
    try { tp.track(() => { throw 'plain string'; }); } catch (e) { caught = e; }
    expect(caught).toBe('plain string');
  });

  test('async rejections keep the original error object', async () => {
    const tp = createTracePerf({ silent: true });
    const err = new Error('x');
    await expect(tp.track(async () => { throw err; })).rejects.toBe(err);
  });
});

/**
 * Regression: per-call options (silent, trackMemory, trackingMode) and
 * later configuration changes must actually take effect.
 */
import { createTracePerf, TrackingMode } from '../index';
import { captureLogs } from './helpers/console';

describe('per-call and live options', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  test('track(fn, { silent: true }) prints nothing', () => {
    createTracePerf().track(() => 1, { label: 'quiet', silent: true });
    expect(logs.lines()).toEqual([]);
  });

  test('registerModule(mod, { silent: true }) prints nothing', () => {
    const mod = createTracePerf().registerModule({ f: () => 1 }, { silent: true });
    mod.f();
    expect(logs.lines()).toEqual([]);
  });

  test('track(fn, { trackMemory: false }) omits memory', () => {
    createTracePerf({ trackMemory: true }).track(() => 1, { label: 'noMem', trackMemory: false });
    expect(logs.text()).toContain('noMem');
    expect(logs.text()).not.toContain('📊');
  });

  test('track(fn, { trackMemory: true }) adds memory when the instance has it off', () => {
    createTracePerf({ trackMemory: false }).track(() => 1, { label: 'withMem', trackMemory: true });
    expect(logs.text()).toContain('📊');
  });

  test('per-call trackingMode is honoured', () => {
    const tp = createTracePerf({ trackingMode: TrackingMode.BALANCED });
    expect(() => tp.track(() => { throw new Error('boom'); }, { label: 'f', trackingMode: TrackingMode.DETAILED })).toThrow('boom');
    expect(logs.text()).toContain('✖ boom');
  });

  test('enableSilentMode() applies to functions created earlier', () => {
    const tp = createTracePerf();
    const f = tp.createTrackable(() => 1, { label: 'early' });
    tp.enableSilentMode();
    f();
    expect(logs.lines()).toEqual([]);
  });

  test('setSampleRate(0) applies to functions created earlier', () => {
    const tp = createTracePerf();
    const f = tp.createTrackable(() => 1, { label: 'early' });
    tp.setSampleRate(0);
    expect(f()).toBe(1);
    expect(logs.lines()).toEqual([]);
  });
});

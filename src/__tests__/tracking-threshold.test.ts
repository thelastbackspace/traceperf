/**
 * Regression: `threshold` (milliseconds) must filter what gets reported.
 */
import { createTracePerf } from '../index';
import { busyWait, captureLogs, withVirtualClock } from './helpers/console';

describe('threshold', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => { logs = captureLogs(); });
  afterEach(() => logs.restore());

  test('instance threshold hides fast calls and reports slow ones', withVirtualClock(() => {
    const tp = createTracePerf({ threshold: 60 });
    tp.track(() => 1, { label: 'fast' });
    tp.track(() => busyWait(70), { label: 'slow' });
    expect(logs.text()).not.toContain('fast');
    expect(logs.text()).toContain('slow');
  }));

  test('per-call threshold hides fast calls', withVirtualClock(() => {
    createTracePerf().track(() => 1, { label: 'fastPerCall', threshold: 60 });
    expect(logs.lines()).toEqual([]);
  }));

  test('threshold applies to async functions using their full duration', async () => {
    const tp = createTracePerf({ threshold: 30 });
    await tp.track(() => new Promise(r => setTimeout(r, 45)), { label: 'slowAsync' });
    expect(logs.text()).toContain('slowAsync');
  });

  test('threshold: 0 is kept (not replaced by a default)', () => {
    expect(createTracePerf({ threshold: 0 }).setConfig({}).threshold).toBe(0);
  });

  test('without a threshold every call is reported', () => {
    createTracePerf().track(() => 1, { label: 'everything' });
    expect(logs.text()).toContain('everything');
  });
});

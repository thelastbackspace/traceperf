/**
 * Regression: memory tracking must not use process.memoryUsage(), which
 * also measures RSS and costs ~20µs per call (twice per tracked call).
 */
import { createTracePerf, getMemoryUsage } from '../index';

describe('memory tracking overhead', () => {
  test('tracked calls do not call process.memoryUsage()', () => {
    const spy = jest.spyOn(process, 'memoryUsage');
    try {
      const f = createTracePerf({ silent: true, trackMemory: true }).createTrackable((a: number) => a + 1);
      for (let i = 0; i < 10; i++) f(i);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('getMemoryUsage still reports the V8 heap in use', () => {
    const heap = getMemoryUsage();
    expect(heap).toBeGreaterThan(0);
    expect(Math.abs(heap - process.memoryUsage().heapUsed)).toBeLessThan(64 * 1024 * 1024);
  });
});

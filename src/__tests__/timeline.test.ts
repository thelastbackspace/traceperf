import { PerformanceObserver, performance } from 'perf_hooks';
import { createTracePerf, performanceTimeline } from '../index';

test('performanceTimeline emits User Timing measures with DevTools track data', async () => {
  const seen: any[] = [];
  const observer = new PerformanceObserver(list => seen.push(...list.getEntries()));
  observer.observe({ entryTypes: ['measure'] });
  const tp = createTracePerf({ silent: true, plugins: [performanceTimeline()] });
  const child = tp.createTrackable(() => { throw new Error('nope'); }, { label: 'tl.child' });
  tp.track(() => { try { child(); } catch { /* handled by the parent */ } }, { label: 'tl.parent' });
  await new Promise(r => setTimeout(r, 20));
  observer.disconnect();
  const parent = seen.find(e => e.name === 'tl.parent');
  const failed = seen.find(e => e.name === 'tl.child');
  expect(parent.duration).toBeGreaterThanOrEqual(failed.duration);
  expect(parent.detail.devtools).toMatchObject({ dataType: 'track-entry', track: 'traceperf', color: 'primary' });
  expect(failed.detail.devtools.color).toBe('error');
  expect(failed.detail.devtools.properties).toContainEqual(['error', 'nope']);
  // not kept by default (no unbounded growth)
  expect(performance.getEntriesByName('tl.parent')).toHaveLength(0);
});

test('keep: true leaves the entries in the timeline', () => {
  const tp = createTracePerf({ silent: true, plugins: [performanceTimeline({ keep: true })] });
  tp.track(() => 1, { label: 'tl.kept' });
  expect(performance.getEntriesByName('tl.kept')).toHaveLength(1);
  performance.clearMeasures('tl.kept');
});

/**
 * Show tracked calls in the browser DevTools Performance panel (and in any
 * User Timing consumer) via performance.measure().
 */
import { ExecutionRecord, TracePerfPlugin, walkRecords } from './records';

export interface PerformanceTimelineOptions {
  /** DevTools track name (default "traceperf") */
  track?: string;
  /** Optional DevTools track group */
  trackGroup?: string;
  /**
   * Keep the entries in the performance timeline (default false). DevTools
   * recordings and PerformanceObservers see every entry either way; keeping
   * them makes performance.getEntriesByType('measure') return them but grows
   * memory in long-running pages.
   */
  keep?: boolean;
}

/**
 * Emit a performance.measure() for every finished tracked call.
 *
 *   tp.use(performanceTimeline());
 *
 * In Chrome 129+ the entries appear on a custom "traceperf" track in the
 * Performance panel (errors in red, details in the tooltip); elsewhere they
 * appear in the Timings track / User Timing API.
 */
export function performanceTimeline(options: PerformanceTimelineOptions = {}): TracePerfPlugin {
  const perf: any = typeof performance !== 'undefined' ? performance : undefined;
  const supported = !!perf && typeof perf.measure === 'function';
  const track = options.track ?? 'traceperf';
  return {
    name: 'performance-timeline',
    onComplete(root: ExecutionRecord) {
      if (!supported) return;
      walkRecords(root, record => {
        const failed = record.error !== undefined && record.error !== null;
        const properties: Array<[string, string]> = [
          ['duration', `${record.duration.toFixed(3)} ms`],
          ['self', `${record.selfDuration.toFixed(3)} ms`],
        ];
        if (record.async) properties.push(['sync', `${record.syncDuration.toFixed(3)} ms`]);
        if (record.memoryDelta !== undefined) properties.push(['heap Δ', `${(record.memoryDelta / 1024).toFixed(2)} KB`]);
        if (failed) properties.push(['error', record.error instanceof Error ? record.error.message : String(record.error)]);
        try {
          perf.measure(record.label, {
            start: record.startTime,
            duration: record.duration,
            detail: {
              devtools: {
                dataType: 'track-entry',
                track,
                ...(options.trackGroup ? { trackGroup: options.trackGroup } : {}),
                color: failed ? 'error' : 'primary',
                properties,
                tooltipText: `${record.label}: ${record.duration.toFixed(2)} ms`,
              },
            },
          });
          if (!options.keep && typeof perf.clearMeasures === 'function') perf.clearMeasures(record.label);
        } catch {
          // Older engines without measure(name, options): skip silently
        }
      });
    },
  };
}

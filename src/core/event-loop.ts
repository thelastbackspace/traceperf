/**
 * Event-loop delay monitoring (Node.js only).
 *
 * A tracked call tells you how long *it* took; event-loop delay tells you
 * whether something blocked everything else. Node's monitorEventLoopDelay
 * samples the delay with negligible overhead.
 */
import { loadNodeBuiltin } from './env';

/** Event-loop delay distribution in milliseconds */
export interface EventLoopStats {
  min: number;
  max: number;
  mean: number;
  stddev: number;
  p50: number;
  p90: number;
  p99: number;
}

export interface EventLoopMonitor {
  /** False outside Node.js (or Node < 11.10); stats() then returns null */
  readonly supported: boolean;
  /** Delay distribution since start (or the last reset) */
  stats(): EventLoopStats | null;
  /** Start a new measurement window */
  reset(): void;
  /** Stop sampling */
  stop(): void;
}

/**
 * Start sampling event-loop delay.
 *
 *   const loop = monitorEventLoop();
 *   // ... later
 *   console.log(loop.stats()); // { p99: 12.3, max: 48.1, ... } (ms)
 */
export function monitorEventLoop(options: { resolution?: number } = {}): EventLoopMonitor {
  const perfHooks = loadNodeBuiltin('perf_hooks');
  if (!perfHooks || typeof perfHooks.monitorEventLoopDelay !== 'function') {
    return { supported: false, stats: () => null, reset: () => undefined, stop: () => undefined };
  }
  const histogram = perfHooks.monitorEventLoopDelay({ resolution: Math.max(1, options.resolution ?? 10) });
  histogram.enable();
  const ms = (ns: number) => (Number.isFinite(ns) ? ns / 1e6 : 0);
  return {
    supported: true,
    stats: () => ({
      min: ms(histogram.min),
      max: ms(histogram.max),
      mean: ms(histogram.mean),
      stddev: ms(histogram.stddev),
      p50: ms(histogram.percentile(50)),
      p90: ms(histogram.percentile(90)),
      p99: ms(histogram.percentile(99)),
    }),
    reset: () => histogram.reset(),
    stop: () => histogram.disable(),
  };
}

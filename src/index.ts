// Import optimized performance monitor from core
import { OptimizedPerformanceMonitor, TrackingModes } from './core/optimized-performance-monitor';
import { ITracePerfConfig, TrackOptions } from './types';

// Create singleton instance
const tracePerf = new OptimizedPerformanceMonitor();

// Export the singleton instance as the default export
export default tracePerf;

// Export a function to create a new tracePerf instance
export function createTracePerf(config: ITracePerfConfig = {}): OptimizedPerformanceMonitor {
  return new OptimizedPerformanceMonitor(config);
}

/**
 * Method decorator bound to the default instance, see `OptimizedPerformanceMonitor.traced`.
 */
export function traced(options: TrackOptions = {}) {
  // Call the prototype method: in CommonJS this function is also installed
  // as tracePerf.traced, so tracePerf.traced(...) would recurse.
  return OptimizedPerformanceMonitor.prototype.traced.call(tracePerf, options);
}

// Export types and classes for advanced usage
export * from './types';
export * from './core';
export * from './integrations';
export * from './instrument';
export { OptimizedPerformanceMonitor };
export { TrackingModes as TrackingMode };

// <cjs-compat>
// CommonJS compatibility: make `require('traceperf')` return the singleton
// itself (so `require('traceperf').track()` works) while still exposing every
// named export declared in the type definitions. Stripped from the ESM build.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(tracePerf, module.exports, {
    default: tracePerf,
    createTracePerf,
    traced,
    OptimizedPerformanceMonitor,
    TrackingMode: TrackingModes,
  });
}
// </cjs-compat>

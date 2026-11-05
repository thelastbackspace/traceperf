// Import optimized performance monitor from core
import { OptimizedPerformanceMonitor, TrackingModes } from './core/optimized-performance-monitor';
import { ITracePerfConfig } from './types';

// Create singleton instance
const tracePerf = new OptimizedPerformanceMonitor();

// Export the singleton instance as the default export
export default tracePerf;

// Export a function to create a new tracePerf instance
export function createTracePerf(config: Partial<ITracePerfConfig> = {}): OptimizedPerformanceMonitor {
  return new OptimizedPerformanceMonitor(config);
}

// Export types and classes for advanced usage
export * from './types';
export * from './core';
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
    OptimizedPerformanceMonitor,
    TrackingMode: TrackingModes,
  });
}
// </cjs-compat>

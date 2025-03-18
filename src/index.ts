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

// Add CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(tracePerf, {
    default: tracePerf,
    createTracePerf,
    OptimizedPerformanceMonitor,
    TrackingMode: TrackingModes,
    // Re-export types
    ...require('./types')
  });
} 
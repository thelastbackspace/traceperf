/**
 * Browser-compatible version of TracePerf
 * 
 * This file provides a browser-compatible version of TracePerf that can be used
 * in React, Next.js, or other frontend applications.
 */

import type { TracePerfConfig, TrackOptions } from './types/options';
import { OptimizedPerformanceMonitor, TrackingModes } from './core/optimized-performance-monitor';
import type { ExecutionRecord } from './core/records';

// Define tracking mode constants to avoid circular dependencies
export const TrackingMode = TrackingModes;

/**
 * Configuration accepted by the browser createTracePerf()/BrowserLogger
 */
/** Log levels for BrowserLogger's console methods */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * BrowserLogger console-method filtering:
 * - dev: everything
 * - staging: warn and error
 * - prod: error only
 */
export type LogMode = 'dev' | 'staging' | 'prod';

/**
 * Configuration accepted by the browser createTracePerf()/BrowserLogger
 */
export interface IBrowserTracePerfConfig extends TracePerfConfig {
  /** Filtering for info/warn/error/debug (default "dev") */
  mode?: LogMode;
  /** Calls slower than this (ms) are marked [SLOW] when no threshold is set (default 100) */
  performanceThreshold?: number;
  /** Use an existing logger instead of creating a new one */
  logger?: BrowserLogger;
}

const preserveSignature = (wrapper: Function, fn: Function): void => {
  Object.defineProperty(wrapper, 'name', { value: fn.name, configurable: true });
  Object.defineProperty(wrapper, 'length', { value: fn.length, configurable: true });
};

/**
 * Browser-compatible TracePerf instance.
 *
 * Shares the core tracker with the Node.js entry (same nesting, statistics,
 * hooks, exporters and options) and adds console-style logging methods.
 * Output uses the browser format:
 *
 *   Execution Flow:
 *   → parent (12.34ms)
 *     → child (10.01ms)
 */
class BrowserLogger extends OptimizedPerformanceMonitor {
  private _mode: LogMode = 'dev';
  private _indentLevel: number = 0;
  private _slowThreshold: number;

  constructor(config: IBrowserTracePerfConfig = {}) {
    super({
      trackingMode: config.trackingMode,
      silent: config.silent,
      trackMemory: config.trackMemory,
      enableNestedTracking: config.enableNestedTracking,
      threshold: config.threshold,
      sampleRate: config.sampleRate,
      enabled: config.enabled,
      blockingThreshold: config.blockingThreshold,
      stats: config.stats,
      plugins: config.plugins,
      onComplete: config.onComplete,
      reporter: config.reporter,
      asyncLocalStorage: config.asyncLocalStorage
    });
    this._mode = config.mode || 'dev';
    this._slowThreshold = config.performanceThreshold || 100;
    if (!config.reporter) {
      this.setConfig({ reporter: root => console.log(this.formatFlow(root)) });
    }
  }

  /**
   * Render an execution tree in the browser output format
   */
  public formatFlow(root: ExecutionRecord): string {
    const lines = ['Execution Flow:'];
    const visit = (record: ExecutionRecord, level: number) => {
      const indent = '  '.repeat(level);
      const slowThreshold = record.threshold > 0 ? record.threshold : this._slowThreshold;
      const isSlow = record.duration > slowThreshold;
      const memory = record.memoryDelta !== undefined && record.memoryDelta > 0
        ? ` [${formatMemorySize(record.memoryDelta)}]` : '';
      lines.push(`${indent}→ ${record.label} (${record.duration.toFixed(2)}ms)${isSlow ? ' [SLOW]' : ''}${memory}`);
      const suggestion = isSlow ? slowSuggestion(record.label, record.duration) : '';
      if (suggestion) {
        lines.push(`${indent}  ⚠️ ${suggestion}`);
      }
      record.children
        .filter(child => child.duration >= child.threshold)
        .forEach(child => visit(child, level + 1));
    };
    visit(root, 0);
    return lines.join('\n');
  }

  public info(message: string | object, ...args: any[]): void {
    this.log('info', message, args);
  }

  public warn(message: string | object, ...args: any[]): void {
    this.log('warn', message, args);
  }

  public error(message: string | object, ...args: any[]): void {
    this.log('error', message, args);
  }

  public debug(message: string | object, ...args: any[]): void {
    if (this._mode === 'prod') {
      return;
    }
    
    this.log('debug', message, args);
  }

  public group(label: string): void {
    this.info(label);
    this._indentLevel++;
    
    if (typeof console.group === 'function') {
      console.group(label);
    }
  }

  public groupEnd(): void {
    if (this._indentLevel > 0) {
      this._indentLevel--;
    }
    
    if (typeof console.groupEnd === 'function') {
      console.groupEnd();
    }
  }

  public setMode(mode: LogMode): void {
    this._mode = mode;
  }

  public getMode(): LogMode {
    return this._mode;
  }

  /**
   * Set the tracking mode
   * @param mode Tracking mode from TrackingMode enum
   * @returns This instance for chaining
   */
  public setTrackingMode(mode: string): BrowserLogger {
    super.setTrackingMode(mode);
    return this;
  }

  /**
   * Create a trackable version of a function. Calls go through `track()`,
   * so nested trackables attach to their caller.
   */
  public createTrackable<T extends (...args: any[]) => any>(
    fn: T, 
    options: TrackOptions = {}
  ): (...args: Parameters<T>) => ReturnType<T> {
    const label = options.label || fn.name || 'anonymous';
    
    // Use a regular function so callers keep their own `this`
    const run = (thisArg: any, args: Parameters<T>): ReturnType<T> =>
      this.track(() => fn.apply(thisArg, args), {
        ...options,
        label
      }) as ReturnType<T>;
    const tracked = function(this: any, ...args: Parameters<T>): ReturnType<T> {
      return run(this, args);
    };
    preserveSignature(tracked, fn);
    return tracked as (...args: Parameters<T>) => ReturnType<T>;
  }

  private log(level: LogLevel, message: string | object, args: any[]): void {
    // Skip logs based on mode
    if (this._mode === 'prod' && level !== 'error') {
      return;
    }
    
    if (this._mode === 'staging' && (level === 'debug' || level === 'info')) {
      return;
    }
    
    // Format the message
    let formattedMessage: string;
    
    if (typeof message === 'string') {
      formattedMessage = message;
    } else {
      try {
        formattedMessage = JSON.stringify(message, null, 2);
      } catch {
        formattedMessage = String(message);
      }
    }
    
    // Add indentation
    const indent = '  '.repeat(this._indentLevel);
    formattedMessage = `${indent}${formattedMessage}`;
    
    // Log to console with appropriate method
    switch (level) {
      case 'info':
        console.info(formattedMessage, ...args);
        break;
      case 'warn':
        console.warn(formattedMessage, ...args);
        break;
      case 'error':
        console.error(formattedMessage, ...args);
        break;
      case 'debug':
        console.debug(formattedMessage, ...args);
        break;
    }
  }
}

function formatMemorySize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes.toFixed(2)}B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)}KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function slowSuggestion(name: string, duration: number): string {
  if (duration > 500) {
    return `Function "${name}" took ${duration.toFixed(2)}ms to execute. Consider optimizing or breaking it down into smaller functions.`;
  } else if (duration > 200) {
    return `Function "${name}" took ${duration.toFixed(2)}ms to execute. Consider optimizing if called frequently.`;
  } else if (duration > 100) {
    return `Function "${name}" took ${duration.toFixed(2)}ms to execute. Monitor if called in critical paths.`;
  }
  return '';
}

/**
 * Create a browser-compatible logger instance
 * @param config Configuration options
 * @returns Browser logger instance
 */
export function createBrowserLogger(config: IBrowserTracePerfConfig = {}): BrowserLogger {
  if (config.logger instanceof BrowserLogger) {
    return config.logger;
  }
  return new BrowserLogger(config);
}

/**
 * Create a browser-compatible TracePerf instance
 * Alias of createBrowserLogger for API consistency with Node.js version
 * @param config Configuration options
 * @returns Browser logger instance
 */
export function createTracePerf(config: IBrowserTracePerfConfig = {}): BrowserLogger {
  return createBrowserLogger(config);
}

// Create default browser logger instance
const browserLogger = createBrowserLogger();

// Export the default instance
export default browserLogger;

// Export classes for advanced usage
export {
  BrowserLogger
};

// Plugins and exporters that work in browsers
export { performanceTimeline } from './core/timeline';
export { toChromeTrace, jsonLinesExporter, openTelemetryExporter, recordToJSON } from './core/exporters';
export { formatTree } from './core/records';
export { instrumentFetch } from './instrument';
export type { ExecutionRecord, TracePerfPlugin } from './core/records';

// <cjs-compat>
// CommonJS compatibility (stripped from the ESM build)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(browserLogger, module.exports, {
    default: browserLogger,
    createBrowserLogger,
    createTracePerf,
    BrowserLogger,
    TrackingMode
  });
}
// </cjs-compat>

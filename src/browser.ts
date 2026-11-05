/**
 * Browser-compatible version of TracePerf
 * 
 * This file provides a browser-compatible version of TracePerf that can be used
 * in React, Next.js, or other frontend applications.
 */

import { ILoggerConfig, LogLevel, LogMode, ITrackOptions } from './types';

// Define tracking mode constants to avoid circular dependencies
export const TrackingMode = {
  PERFORMANCE: 'performance',
  BALANCED: 'balanced',
  DETAILED: 'detailed',
  DEBUG: 'debug'
};

/**
 * Configuration accepted by the browser createTracePerf()/BrowserLogger
 */
export interface IBrowserTracePerfConfig extends Partial<ILoggerConfig> {
  /** Suppress console output (default false) */
  silent?: boolean;
  /** Track memory usage where the browser exposes it (default true) */
  trackMemory?: boolean;
  /** Only report calls taking at least this many milliseconds */
  threshold?: number;
  /** Attach nested tracked calls to their caller (default true) */
  enableNestedTracking?: boolean;
  /** Use an existing logger instead of creating a new one */
  logger?: BrowserLogger;
}

const isNativePromise = (value: unknown): value is Promise<unknown> =>
  value instanceof Promise || Object.prototype.toString.call(value) === '[object Promise]';

const preserveSignature = (wrapper: Function, fn: Function): void => {
  Object.defineProperty(wrapper, 'name', { value: fn.name, configurable: true });
  Object.defineProperty(wrapper, 'length', { value: fn.length, configurable: true });
};

/**
 * Browser-compatible performance monitoring
 */
class BrowserPerformanceMonitor {
  private _timers: Map<string, number> = new Map();
  private _defaultThreshold: number;

  constructor(options: { defaultThreshold?: number } = {}) {
    this._defaultThreshold = options.defaultThreshold ?? 100; // ms
  }

  public startTimer(label: string): string {
    const id = `${label}-${Math.random().toString(36).substring(2, 9)}`;
    this._timers.set(id, performance.now());
    return id;
  }

  public endTimer(id: string): number {
    const startTime = this._timers.get(id);
    if (!startTime) {
      throw new Error(`Timer with id ${id} not found`);
    }
    
    const duration = performance.now() - startTime;
    this._timers.delete(id);
    
    return duration;
  }

  public isBottleneck(duration: number, threshold?: number): boolean {
    const effectiveThreshold = threshold ?? this._defaultThreshold;
    return duration > effectiveThreshold;
  }

  /**
   * Get memory usage from browser performance API
   * @returns Memory usage object with heap metrics or undefined if not available
   */
  public getMemoryUsage(): { heapUsed: number; heapTotal: number; external: number; rss: number } | undefined {
    try {
      // Chrome-specific memory API
      if (performance && 'memory' in performance) {
        const memory = (performance as any).memory;
        return {
          heapUsed: memory?.usedJSHeapSize || 0,
          heapTotal: memory?.totalJSHeapSize || 0,
          external: 0, // Not available in browser
          rss: 0, // Not available in browser
        };
      }
      
      // Firefox has a different memory API
      if (typeof window !== 'undefined' && (window as any).performance && (window as any).performance.memory) {
        const memory = (window as any).performance.memory;
        return {
          heapUsed: memory.usedJSHeapSize || 0,
          heapTotal: memory.totalJSHeapSize || 0,
          external: 0,
          rss: 0,
        };
      }
      
      return undefined;
    } catch (e) {
      console.warn('Memory API not available or permission denied:', e);
      return undefined;
    }
  }

  /**
   * Calculate memory difference
   * @param start - Starting memory usage
   * @returns Memory difference in bytes
   */
  public getMemoryDiff(start: { heapUsed: number }): number {
    try {
      const current = this.getMemoryUsage();
      if (!current) return 0;
      
      const diff = current.heapUsed - start.heapUsed;
      
      // Return zero instead of negative values
      return Math.max(0, diff);
    } catch (e) {
      console.warn('Error calculating memory difference:', e);
      return 0;
    }
  }

  public now(): number {
    return performance.now();
  }

  public generateSuggestion(
    functionName: string,
    duration: number,
    memoryUsage?: number
  ): string {
    if (duration > 1000) {
      return `🛠 Potential Fix: Consider optimizing or adding caching to ${functionName}`;
    }
    
    if (duration > 500) {
      return `🛠 Potential Fix: Look for blocking operations in ${functionName}`;
    }
    
    return `🛠 Potential Fix: Review ${functionName} for performance optimizations`;
  }
}

/**
 * Browser-compatible execution tracker for tracking function calls and generating flow charts
 */
class BrowserExecutionTracker {
  private _callStack: string[] = [];
  private _executions: any[] = [];
  private _currentExecution: any = null;
  private _defaultThreshold: number;
  private _globalScope: Record<string, any>;
  private _trackedFunctions: Map<Function, Function> = new Map();
  private _performanceMonitor: BrowserPerformanceMonitor;
  private _onRootComplete?: (execution: any) => void;

  /**
   * Create a new BrowserExecutionTracker instance
   * 
   * @param options - Tracker options. When `onRootComplete` is given, each
   *   finished top-level execution is handed to it and then discarded
   *   instead of being kept for generateFlowChart().
   */
  constructor(options: { defaultThreshold?: number; onRootComplete?: (execution: any) => void } = {}) {
    this._defaultThreshold = options.defaultThreshold ?? 100; // ms
    this._onRootComplete = options.onRootComplete;
    this._performanceMonitor = new BrowserPerformanceMonitor(options);
    
    // Get a reference to the global scope (window in browsers)
    this._globalScope = typeof window !== 'undefined' ? window : 
                        typeof global !== 'undefined' ? (global as unknown as Record<string, any>) : 
                        {} as Record<string, any>;
  }

  /**
   * Generate a performance optimization suggestion based on execution duration
   * 
   * @param name - Function name
   * @param duration - Execution duration in ms
   * @returns Optimization suggestion
   */
  private generateSuggestion(name: string, duration: number): string {
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
   * Track the execution of a function
   * 
   * @param fn - The function to track
   * @param options - Options for tracking
   * @returns The return value of the tracked function
   */
  public track<T>(fn: () => T, options: any = {}): T {
    const fnName = options.label || fn.name || 'anonymous';
    const threshold = options.threshold ?? this._defaultThreshold;
    const enableNestedTracking = options.enableNestedTracking ?? true;
    const trackMemory = options.trackMemory ?? true;
    
    // Get memory usage before execution
    let startMemory: { heapUsed: number; heapTotal: number; external: number; rss: number } | undefined;
    if (trackMemory) {
      try {
        startMemory = this._performanceMonitor.getMemoryUsage();
      } catch (e) {
        console.warn('Unable to track memory usage:', e);
      }
    }
    
    // Add to call stack
    this._callStack.push(fnName);
    
    // Create execution record
    const execution: any = {
      name: fnName,
      duration: 0,
      isSlow: false,
      level: this._callStack.length - 1,
      startTime: performance.now(),
      children: [],
      complete: false,
      silent: options.silent,
      reportThreshold: options.reportThreshold,
    };
    
    // Set parent-child relationship
    if (this._currentExecution && enableNestedTracking) {
      execution.parent = this._currentExecution;
      this._currentExecution.children.push(execution);
    } else {
      // This is a root execution
      execution.level = 0;
      this._executions.push(execution);
    }
    
    // Save the previous current execution
    const previousExecution = this._currentExecution;
    
    // Set this as the current execution
    this._currentExecution = execution;
    
    const finish = () => {
      const endTime = performance.now();
      execution.endTime = endTime;
      execution.duration = endTime - execution.startTime;
      execution.isSlow = execution.duration > threshold;
      execution.complete = true;
      
      // Calculate memory usage
      if (trackMemory && startMemory !== undefined) {
        try {
          execution.memoryUsage = this._performanceMonitor.getMemoryDiff(startMemory);
        } catch (e) {
          console.warn('Error calculating memory usage:', e);
        }
      }
      
      // Generate suggestion if slow
      if (execution.isSlow) {
        execution.suggestion = this.generateSuggestion(fnName, execution.duration);
      }
      
      // Hand finished top-level executions to the owner, then forget them
      if (!execution.parent && this._onRootComplete) {
        const index = this._executions.indexOf(execution);
        if (index !== -1) {
          this._executions.splice(index, 1);
        }
        this._onRootComplete(execution);
      }
    };
    
    let result: T;
    try {
      // Execute the function
      result = fn();
    } catch (error) {
      this._currentExecution = previousExecution;
      this._callStack.pop();
      finish();
      throw error;
    }
    
    // Nesting is tracked synchronously: restore the caller as current
    this._currentExecution = previousExecution;
    this._callStack.pop();
    
    // Async functions / promises: time until settled
    if (isNativePromise(result)) {
      return result.then(
        value => {
          finish();
          return value;
        },
        error => {
          finish();
          throw error;
        }
      ) as unknown as T;
    }
    
    finish();
    return result;
  }

  /**
   * Create a trackable version of a function
   * 
   * This is a helper method to create a tracked version of a function
   * that can be used for nested function tracking.
   * 
   * @param fn - The function to make trackable
   * @param options - Options for tracking
   * @returns A tracked version of the function
   */
  public createTrackable<T extends (...args: any[]) => any>(
    fn: T, 
    options?: Omit<ITrackOptions, 'label'> & { label?: string }
  ): (...args: Parameters<T>) => ReturnType<T> {
    const label = options?.label || fn.name || 'anonymous';
    const threshold = options?.threshold ?? 100; // Use a sensible default of 100ms
    const enableNestedTracking = options?.enableNestedTracking ?? true;
    const trackMemory = options?.trackMemory ?? true;
    const trackingMode = options?.trackingMode || TrackingMode.BALANCED;
    
    // Use a regular function so callers keep their own `this`
    const run = (thisArg: any, args: Parameters<T>): ReturnType<T> =>
      this.track(() => fn.apply(thisArg, args), {
        ...options,
        label,
        threshold,
        enableNestedTracking,
        trackMemory,
        trackingMode
      }) as ReturnType<T>;
    const tracked = function(this: any, ...args: Parameters<T>): ReturnType<T> {
      return run(this, args);
    };
    preserveSignature(tracked, fn);
    return tracked as (...args: Parameters<T>) => ReturnType<T>;
  }

  /**
   * Get the current call stack
   * 
   * @returns The current call stack
   */
  public getCallStack(): string[] {
    return [...this._callStack];
  }

  /**
   * Generate a visual representation of the execution flow
   * 
   * @returns ASCII flow chart of the execution
   */
  public generateFlowChart(executions: any[] = this._executions): string {
    let result = 'Execution Flow:\n';
    
    // Process each execution
    this.prepareExecutionData(executions).forEach(execution => {
      const indent = '  '.repeat(execution.level);
      const durationStr = execution.duration.toFixed(2);
      const slowMarker = execution.isSlow ? ' [SLOW]' : execution.complete === false ? ' [PENDING]' : '';
      
      let memoryStr = '';
      if (execution.memoryUsage !== undefined && execution.memoryUsage > 0) {
        memoryStr = ` [${this.formatMemorySize(execution.memoryUsage)}]`;
      }
      
      result += `${indent}→ ${execution.name} (${durationStr}ms)${slowMarker}${memoryStr}\n`;
      
      // Add suggestion if available
      if (execution.suggestion) {
        result += `${indent}  ⚠️ ${execution.suggestion}\n`;
      }
    });
    
    return result;
  }

  /**
   * Prepare execution data for the flow chart
   * 
   * @param executions - The execution records to prepare
   * @returns A list of execution data
   */
  private prepareExecutionData(executions: any[]): any[] {
    const result: any[] = [];
    
    // Process each root execution
    executions.forEach(execution => {
      // Add the root execution
      result.push({
        name: execution.name,
        duration: execution.duration,
        isSlow: execution.isSlow,
        suggestion: execution.suggestion,
        level: execution.level,
        memoryUsage: execution.memoryUsage,
        complete: execution.complete
      });
      
      // Add children recursively
      this.addChildrenToResult(execution.children, result);
    });
    
    return result;
  }

  /**
   * Add children to the result list
   * 
   * @param children - The children to add
   * @param result - The result list
   */
  private addChildrenToResult(children: any[], result: any[]): void {
    children.forEach(child => {
      // Add the child
      result.push({
        name: child.name,
        duration: child.duration,
        isSlow: child.isSlow,
        suggestion: child.suggestion,
        level: child.level,
        memoryUsage: child.memoryUsage,
        complete: child.complete
      });
      
      // Add grandchildren recursively
      this.addChildrenToResult(child.children, result);
    });
  }

  /**
   * Format memory size for display
   * @param bytes Memory usage in bytes
   * @returns Formatted string
   */
  private formatMemorySize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes.toFixed(2)}B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)}KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
    } else {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
    }
  }

  /**
   * Clear all execution records
   */
  public clear(): void {
    this._executions = [];
    this._currentExecution = null;
    this._callStack = [];
  }
}

/**
 * Browser-compatible logger
 */
class BrowserLogger {
  private _mode: LogMode = 'dev';
  private _indentLevel: number = 0;
  private _executionTracker: BrowserExecutionTracker;
  private _performanceMonitor: BrowserPerformanceMonitor;
  private _trackingMode: string = TrackingMode.BALANCED;
  private _silent: boolean;
  private _trackMemory: boolean;
  private _threshold?: number;
  private _enableNestedTracking: boolean;

  constructor(config: IBrowserTracePerfConfig = {}) {
    this._mode = config.mode || 'dev';
    this._trackingMode = config.trackingMode || TrackingMode.BALANCED;
    this._silent = config.silent ?? false;
    this._trackMemory = config.trackMemory ?? true;
    this._threshold = config.threshold;
    this._enableNestedTracking = config.enableNestedTracking ?? true;
    this._executionTracker = new BrowserExecutionTracker({
      defaultThreshold: config.performanceThreshold || 100,
      onRootComplete: execution => this.report(execution),
    });
    this._performanceMonitor = new BrowserPerformanceMonitor({
      defaultThreshold: config.performanceThreshold || 100,
    });
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
    this._trackingMode = mode;
    return this;
  }

  /**
   * Get the current tracking mode
   * @returns Current tracking mode
   */
  public getTrackingMode(): string {
    return this._trackingMode;
  }

  public track<T>(fn: () => T, options?: ITrackOptions): T {
    const threshold = options?.threshold ?? this._threshold;
    
    // The tree is printed by report() when the outermost call finishes
    // (after the promise settles for async functions).
    return this._executionTracker.track(fn, {
      ...options,
      ...(threshold !== undefined ? { threshold } : {}),
      silent: options?.silent ?? this._silent,
      reportThreshold: threshold ?? 0,
      trackMemory: options?.trackMemory ?? this._trackMemory,
      enableNestedTracking: options?.enableNestedTracking ?? this._enableNestedTracking,
      trackingMode: options?.trackingMode || this._trackingMode
    });
  }

  /**
   * Print a finished top-level execution unless silenced or below threshold
   */
  private report(execution: any): void {
    if (execution.silent || execution.duration < (execution.reportThreshold ?? 0)) {
      return;
    }
    console.log(this._executionTracker.generateFlowChart([execution]).replace(/\n$/, ''));
  }

  /**
   * Create a trackable version of a function
   * 
   * This is a helper method to create a tracked version of a function
   * that can be used for nested function tracking.
   * 
   * @param fn - The function to make trackable
   * @param options - Options for tracking
   * @returns A tracked version of the function
   */
  public createTrackable<T extends (...args: any[]) => any>(
    fn: T, 
    options?: Omit<ITrackOptions, 'label'> & { label?: string }
  ): (...args: Parameters<T>) => ReturnType<T> {
    const label = options?.label || fn.name || 'anonymous';
    
    // Use a regular function so callers keep their own `this`;
    // unspecified options are resolved by track() at call time
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
      } catch (error) {
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
  BrowserLogger,
  BrowserPerformanceMonitor,
  BrowserExecutionTracker
};

// <cjs-compat>
// CommonJS compatibility (stripped from the ESM build)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(browserLogger, module.exports, {
    default: browserLogger,
    createBrowserLogger,
    createTracePerf,
    BrowserLogger,
    BrowserPerformanceMonitor,
    BrowserExecutionTracker,
    TrackingMode
  });
}
// </cjs-compat>

/**
 * Browser-compatible version of TracePerf
 * 
 * This file provides a browser-compatible version of TracePerf that can be used
 * in React, Next.js, or other frontend applications.
 */

import { ILoggerConfig, LogLevel, LogMode, LogMeta, ITrackOptions } from './types';

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

  public getMemoryUsage(): { heapUsed: number; heapTotal: number; external: number; rss: number } {
    // Use browser performance API if available
    if (performance && 'memory' in performance) {
      const memory = (performance as any).memory;
      return {
        heapUsed: memory?.usedJSHeapSize || 0,
        heapTotal: memory?.totalJSHeapSize || 0,
        external: 0, // Not available in browser
        rss: 0, // Not available in browser
      };
    }
    
    // Fallback for browsers without memory API
    return {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      rss: 0,
    };
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

  /**
   * Create a new BrowserExecutionTracker instance
   * 
   * @param options - Tracker options
   */
  constructor(options: { defaultThreshold?: number } = {}) {
    this._defaultThreshold = options.defaultThreshold ?? 100; // ms
    
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
    };
    
    // Set parent-child relationship
    if (this._currentExecution && enableNestedTracking) {
      execution.parent = this._currentExecution;
      this._currentExecution.children.push(execution);
    } else {
      // This is a root execution
      this._executions.push(execution);
    }
    
    // Save the previous current execution
    const previousExecution = this._currentExecution;
    
    // Set this as the current execution
    this._currentExecution = execution;
    
    let result: T;
    
    try {
      // Execute the function
      result = fn();
    } catch (error) {
      // End timing
      const endTime = performance.now();
      execution.endTime = endTime;
      execution.duration = endTime - execution.startTime;
      execution.isSlow = execution.duration > threshold;
      
      // Restore the previous current execution
      this._currentExecution = previousExecution;
      
      // Remove from call stack
      this._callStack.pop();
      
      // Re-throw the error
      throw error;
    }
    
    // End timing
    const endTime = performance.now();
    execution.endTime = endTime;
    execution.duration = endTime - execution.startTime;
    execution.isSlow = execution.duration > threshold;
    
    // Generate suggestion if slow
    if (execution.isSlow) {
      execution.suggestion = this.generateSuggestion(fnName, execution.duration);
    }
    
    // Restore the previous current execution
    this._currentExecution = previousExecution;
    
    // Remove from call stack
    this._callStack.pop();
    
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
    const self = this;
    const fnName = options?.label || fn.name || 'anonymous';
    
    return function(this: any, ...args: Parameters<T>): ReturnType<T> {
      return self.track(() => fn.apply(this, args), { 
        ...options,
        label: fnName
      }) as ReturnType<T>;
    };
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
  public generateFlowChart(): string {
    let result = 'Execution Flow:\n';
    
    // Process each execution
    this.prepareExecutionData(this._executions).forEach(execution => {
      const indent = '  '.repeat(execution.level);
      const durationStr = execution.duration.toFixed(2);
      const slowMarker = execution.isSlow ? ' [SLOW]' : '';
      
      result += `${indent}→ ${execution.name} (${durationStr}ms)${slowMarker}\n`;
      
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
      });
      
      // Add grandchildren recursively
      this.addChildrenToResult(child.children, result);
    });
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

  constructor(config: Partial<ILoggerConfig> = {}) {
    this._mode = config.mode || 'dev';
    this._executionTracker = new BrowserExecutionTracker({
      defaultThreshold: config.performanceThreshold || 100,
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

  public track<T>(fn: () => T, options?: ITrackOptions): T {
    const silent = options?.silent ?? false;
    
    // Track the function execution
    const result = this._executionTracker.track(fn, options);
    
    // Log the execution flow if not silent
    if (!silent) {
      const flowChart = this._executionTracker.generateFlowChart();
      console.log(flowChart);
    }
    
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
    return this._executionTracker.createTrackable(fn, options);
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
 * Create a new browser logger instance
 * 
 * @param config - Configuration options
 * @returns A new BrowserLogger instance
 */
export function createBrowserLogger(config: Partial<ILoggerConfig> = {}): BrowserLogger {
  return new BrowserLogger(config);
}

// Create a singleton instance
const defaultBrowserLogger = new BrowserLogger();

// Export the singleton instance as the default export
export default defaultBrowserLogger;

// Export classes for advanced usage
export { BrowserLogger, BrowserPerformanceMonitor, BrowserExecutionTracker };

// Add CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(defaultBrowserLogger, {
    default: defaultBrowserLogger,
    createBrowserLogger,
    BrowserLogger,
    BrowserPerformanceMonitor,
    BrowserExecutionTracker
  });
} 
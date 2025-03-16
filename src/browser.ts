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
  private _instrumentedFunctions: Map<Function, Function> = new Map();
  private _isInstrumented: boolean = false;

  /**
   * Create a new BrowserExecutionTracker instance
   * 
   * @param options - Tracker options
   */
  constructor(options: { defaultThreshold?: number } = {}) {
    this._defaultThreshold = options.defaultThreshold ?? 100; // ms
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
    if (this._currentExecution) {
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
    
    // Flag to track if we're already instrumenting to avoid recursion
    const wasInstrumented = this._isInstrumented;
    
    let result: T;
    
    try {
      // If this is the top-level call and nested tracking is enabled, instrument the function
      if (enableNestedTracking && !wasInstrumented) {
        this._isInstrumented = true;
        
        // Instrument the function to track nested calls
        const instrumentedFn = this.instrumentFunction(fn);
        result = instrumentedFn();
      } else {
        // Execute the function normally
        result = fn();
      }
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
      
      // Reset instrumentation flag if this was the top-level call
      if (!wasInstrumented) {
        this._isInstrumented = false;
      }
      
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
    
    // Reset instrumentation flag if this was the top-level call
    if (!wasInstrumented) {
      this._isInstrumented = false;
    }
    
    return result;
  }

  /**
   * Instrument a function to track nested function calls
   * 
   * @param fn - The function to instrument
   * @returns The instrumented function
   */
  private instrumentFunction<T>(fn: () => T): () => T {
    // If we've already instrumented this function, return the instrumented version
    if (this._instrumentedFunctions.has(fn)) {
      return this._instrumentedFunctions.get(fn) as () => T;
    }
    
    // Create a new instrumented function
    const instrumentedFn = () => {
      // Execute the function and track nested calls
      try {
        // We can't actually modify the function at runtime to track nested calls,
        // so we'll just execute it and rely on the call stack for visualization
        return fn();
      } catch (error) {
        // Re-throw any errors
        throw error;
      }
    };
    
    // Cache the instrumented function
    this._instrumentedFunctions.set(fn, instrumentedFn);
    
    return instrumentedFn;
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
    this._instrumentedFunctions.clear();
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
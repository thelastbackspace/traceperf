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
 * Browser-compatible execution tracker
 */
class BrowserExecutionTracker {
  private _callStack: string[] = [];
  private _executions: any[] = [];
  private _currentExecution: any = null;
  private _defaultThreshold: number;

  constructor(options: { defaultThreshold?: number } = {}) {
    this._defaultThreshold = options.defaultThreshold ?? 100; // ms
  }

  public track<T>(fn: () => T, options?: ITrackOptions): T {
    const fnName = options?.label || fn.name || '<anonymous>';
    const threshold = options?.threshold ?? this._defaultThreshold;
    
    // Start timing
    const startTime = performance.now();
    
    // Add to call stack
    this._callStack.push(fnName);
    
    // Create execution record
    const execution: any = {
      name: fnName,
      duration: 0,
      isSlow: false,
      level: this._callStack.length - 1,
      startTime,
      children: [],
    };
    
    // Set parent-child relationship
    if (this._currentExecution) {
      execution.parent = this._currentExecution;
      this._currentExecution.children.push(execution);
    } else {
      this._executions.push(execution);
    }
    
    // Save the previous current execution
    const previousExecution = this._currentExecution;
    
    // Set this as the current execution
    this._currentExecution = execution;
    
    try {
      // Execute the function
      return fn();
    } finally {
      // End timing
      const endTime = performance.now();
      
      // Calculate duration
      execution.duration = endTime - startTime;
      
      // Check if it's a bottleneck
      execution.isSlow = execution.duration > threshold;
      
      // Restore the previous current execution
      this._currentExecution = previousExecution;
      
      // Remove from call stack
      this._callStack.pop();
    }
  }

  public getCallStack(): string[] {
    return [...this._callStack];
  }

  public generateFlowChart(): string {
    // Simplified flow chart for browser
    let chart = 'Execution Flow:\n';
    
    const flattenExecutions = (executions: any[], level = 0): void => {
      executions.forEach(execution => {
        const indent = '  '.repeat(level);
        const duration = execution.duration.toFixed(2);
        const slowMarker = execution.isSlow ? ' ⚠️ SLOW' : '';
        
        chart += `${indent}${execution.name} (${duration}ms)${slowMarker}\n`;
        
        if (execution.children && execution.children.length > 0) {
          flattenExecutions(execution.children, level + 1);
        }
      });
    };
    
    flattenExecutions(this._executions);
    
    return chart;
  }

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
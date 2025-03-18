import { IExecutionTracker, ITrackOptions } from '../types';
import { getFunctionName } from '../utils/stack';
import { getHighResTime, getDuration, formatDuration } from '../utils/timing';

/**
 * A record of a function execution
 */
export interface ExecutionRecord {
  name: string;
  duration: number;
  startTime: [number, number];
  endTime?: [number, number];
  isSlow: boolean;
  level: number;
  memoryUsage?: number;
  memoryReleased?: number;
  children: ExecutionRecord[];
  parent?: ExecutionRecord;
}

/**
 * Execution tracker for performance monitoring
 */
export class ExecutionTracker implements IExecutionTracker {
  private _executions: ExecutionRecord[] = [];
  private _currentExecution: ExecutionRecord | null = null;
  private _defaultThreshold: number;
  private _callStack: string[] = [];
  private _globalScope: Record<string, any>;
  private _trackedFunctions: Map<Function, Function> = new Map();
  
  /**
   * Constructor
   * 
   * @param options - Options for execution tracking
   */
  constructor(options: { defaultThreshold?: number } = {}) {
    this._defaultThreshold = options.defaultThreshold ?? 100; // ms
    
    // Get a reference to the global scope (works in both Node.js and browsers)
    this._globalScope = typeof window !== 'undefined' ? window : 
                        typeof global !== 'undefined' ? (global as unknown as Record<string, any>) : 
                        {} as Record<string, any>;
  }

  /**
   * Track the execution of a function
   * 
   * @param fn - The function to track
   * @param options - Options for tracking
   * @returns The return value of the tracked function
   */
  public track<T>(fn: () => T, options?: ITrackOptions): T {
    const fnName = options?.label || getFunctionName(fn);
    const threshold = options?.threshold ?? this._defaultThreshold;
    const includeMemory = options?.trackMemory ?? true;
    const enableNestedTracking = options?.enableNestedTracking ?? true;
    
    // Get memory usage before execution
    let startMemory: { heapUsed: number; heapTotal: number; external: number; rss: number } | undefined;
    if (includeMemory) {
      try {
        startMemory = process.memoryUsage();
      } catch (e) {
        console.warn('Unable to track memory usage:', e);
      }
    }
    
    // Start timing
    const startTime = getHighResTime();
    
    // Add to call stack
    const level = this._callStack.push(fnName);
    
    // Create execution record
    const execution: ExecutionRecord = {
      name: fnName,
      duration: 0,
      isSlow: false,
      level: level - 1, // 0-based level
      startTime,
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
    
    try {
      // Execute the function
      return fn();
    } finally {
      // End timing
      const endTime = getHighResTime();
      execution.endTime = endTime;
      
      // Calculate duration
      execution.duration = getDuration(startTime);
      
      // Check if it's a bottleneck
      execution.isSlow = execution.duration > threshold;
      
      // Calculate memory usage
      if (includeMemory && startMemory !== undefined) {
        try {
          const endMemory = process.memoryUsage();
          // Calculate the memory difference, ensuring it's never negative
          const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;
          execution.memoryUsage = Math.max(0, memoryDiff); // Ensure non-negative value
          
          // If memory decreased, store a separate field for better visualization
          if (memoryDiff < 0) {
            execution.memoryReleased = Math.abs(memoryDiff);
          }
        } catch (e) {
          console.warn('Error calculating memory usage:', e);
        }
      }
      
      // Restore the previous current execution
      this._currentExecution = previousExecution;
      
      // Remove from call stack
      this._callStack.pop();
    }
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
    
    // Create a tracked version of the function
    const trackedFn = function(this: any, ...args: Parameters<T>): ReturnType<T> {
      return self.track(() => fn.apply(this, args), { 
        ...options,
        label: fnName
      }) as ReturnType<T>;
    };
    
    // Store the original and tracked function
    this._trackedFunctions.set(fn, trackedFn as unknown as Function);
    
    return trackedFn;
  }

  /**
   * Get all execution records
   * 
   * @returns A list of execution records
   */
  public getExecutions(): ExecutionRecord[] {
    return [...this._executions];
  }

  /**
   * Generate a human-friendly memory size string
   * 
   * @param bytes - The size in bytes
   * @returns A formatted string
   */
  public formatMemorySize(bytes: number): string {
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
    let result = '';
    
    // Process each execution
    this._executions.forEach(execution => {
      result = this.printExecutionTree(execution, result);
    });
    
    return result;
  }

  /**
   * Recursively print an execution tree
   * 
   * @param execution - The root execution
   * @param result - The output string
   * @returns The updated result string
   */
  private printExecutionTree(execution: ExecutionRecord, result: string): string {
    // Print this execution
    result = this.printSingleExecution(execution, result);
    
    // Print children recursively
    execution.children.forEach(child => {
      result = this.printExecutionTree(child, result);
    });
    
    return result;
  }

  /**
   * Print a single execution with appropriate formatting
   * 
   * @param execution - The execution to print
   * @param result - The result string to append to
   * @returns The updated result string
   */
  private printSingleExecution(execution: ExecutionRecord, result: string): string {
    const indent = '  '.repeat(execution.level);
    const durationStr = execution.duration.toFixed(2);
    const slowMarker = execution.isSlow ? ' [SLOW]' : '';
    
    let memoryStr = '';
    if (execution.memoryUsage !== undefined) {
      memoryStr = ` [${this.formatMemorySize(execution.memoryUsage)}]`;
    }
    
    result += `${indent}→ ${execution.name} (${durationStr}ms)${slowMarker}${memoryStr}\n`;
    
    // Add connector if this execution has children
    if (execution.children.length > 0) {
      result += `${indent}  |\n`;
    }
    
    return result;
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
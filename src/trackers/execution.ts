import { IExecutionTracker, ITrackOptions } from '../types';
import { CallStackManager, getFunctionName } from '../utils/stack';
import { getHighResTime, getDuration } from '../utils/timing';
import { ExecutionData, AsciiArtGenerator } from '../formatters/ascii';

/**
 * Execution record for a function call
 */
interface ExecutionRecord {
  name: string;
  duration: number;
  isSlow: boolean;
  memoryUsage?: number;
  level: number;
  startTime: [number, number];
  endTime?: [number, number];
  children: ExecutionRecord[];
  parent?: ExecutionRecord;
}

/**
 * Execution tracker for tracking function calls and generating flow charts
 */
export class ExecutionTracker implements IExecutionTracker {
  private _callStack: CallStackManager;
  private _executions: ExecutionRecord[] = [];
  private _currentExecution: ExecutionRecord | null = null;
  private _asciiGenerator: AsciiArtGenerator;
  private _defaultThreshold: number;
  private _globalScope: Record<string, any>;
  private _trackedFunctions: Map<Function, Function> = new Map();

  /**
   * Create a new ExecutionTracker instance
   * 
   * @param options - Tracker options
   */
  constructor(options: { defaultThreshold?: number; boxWidth?: number } = {}) {
    this._callStack = new CallStackManager();
    this._asciiGenerator = new AsciiArtGenerator({ boxWidth: options.boxWidth });
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
    const includeMemory = options?.includeMemory ?? true;
    const enableNestedTracking = options?.enableNestedTracking ?? true;
    
    // Ensure garbage collection if available before measuring memory
    if (includeMemory && global.gc && typeof global.gc === 'function') {
      try {
        global.gc();
      } catch (e) {
        // Ignore if gc is not available
      }
    }
    
    // Get memory usage before execution
    const startMemory = includeMemory ? process.memoryUsage() : undefined;
    
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
        const endMemory = process.memoryUsage();
        
        // Calculate memory delta
        const heapUsedDelta = endMemory.heapUsed - startMemory.heapUsed;
        
        // Only report positive memory change or significant negative change
        // Small negative values might be due to garbage collection
        if (heapUsedDelta > 0 || heapUsedDelta < -10000) {
          execution.memoryUsage = heapUsedDelta;
        } else {
          // For very small negative changes, just report 0
          execution.memoryUsage = 0;
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
    
    // Create the tracked version of the function
    const trackedFn = function(this: any, ...args: Parameters<T>): ReturnType<T> {
      return self.track(() => fn.apply(this, args), { 
        ...options,
        label: fnName
      }) as ReturnType<T>;
    };
    
    // Store the original and tracked function for future reference
    this._trackedFunctions.set(fn, trackedFn as unknown as Function);
    
    return trackedFn;
  }

  /**
   * Get the current call stack
   * 
   * @returns The current call stack
   */
  public getCallStack(): string[] {
    return this._callStack.getStack();
  }

  /**
   * Generate a visual representation of the execution flow
   * 
   * @returns ASCII flow chart of the execution
   */
  public generateFlowChart(): string {
    // Convert execution records to execution data for the ASCII generator
    const executionData = this.prepareExecutionData(this._executions);
    
    // Generate the flow chart
    return this._asciiGenerator.generateFlowChart(executionData);
  }

  /**
   * Prepare execution data for the ASCII generator
   * 
   * @param executions - The execution records to prepare
   * @returns A list of execution data
   */
  private prepareExecutionData(executions: ExecutionRecord[]): ExecutionData[] {
    const result: ExecutionData[] = [];
    
    // Process each root execution
    executions.forEach(execution => {
      // Add the root execution
      result.push({
        name: execution.name,
        duration: execution.duration,
        isSlow: execution.isSlow,
        memoryUsage: execution.memoryUsage,
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
  private addChildrenToResult(children: ExecutionRecord[], result: ExecutionData[]): void {
    children.forEach(child => {
      // Add the child
      result.push({
        name: child.name,
        duration: child.duration,
        isSlow: child.isSlow,
        memoryUsage: child.memoryUsage,
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
    this._callStack.clear();
  }

  /**
   * Get all execution records
   * 
   * @returns All execution records
   */
  public getExecutions(): ExecutionRecord[] {
    return [...this._executions];
  }
} 
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
  private _instrumentedFunctions: Map<Function, Function> = new Map();
  private _isInstrumented: boolean = false;

  /**
   * Create a new ExecutionTracker instance
   * 
   * @param options - Tracker options
   */
  constructor(options: { defaultThreshold?: number; boxWidth?: number } = {}) {
    this._callStack = new CallStackManager();
    this._asciiGenerator = new AsciiArtGenerator({ boxWidth: options.boxWidth });
    this._defaultThreshold = options.defaultThreshold ?? 100; // ms
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
    
    // Get memory usage before execution
    const startMemory = includeMemory ? process.memoryUsage().heapUsed : undefined;
    
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
    
    try {
      // If this is the top-level call and nested tracking is enabled, instrument the function
      if (enableNestedTracking && !wasInstrumented) {
        this._isInstrumented = true;
        
        // Instrument the function to track nested calls
        const instrumentedFn = this.instrumentFunction(fn);
        return instrumentedFn();
      } else {
        // Execute the function normally
        return fn();
      }
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
        execution.memoryUsage = process.memoryUsage().heapUsed - startMemory;
      }
      
      // Restore the previous current execution
      this._currentExecution = previousExecution;
      
      // Remove from call stack
      this._callStack.pop();
      
      // Reset instrumentation flag if this was the top-level call
      if (!wasInstrumented) {
        this._isInstrumented = false;
      }
    }
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
      try {
        // We can't actually modify the function at runtime to track nested calls
        // in a generic way. The best we can do is execute the function and rely
        // on the call stack for visualization.
        //
        // For proper nested function tracking, users should wrap each function
        // they want to track with tracePerf.track() or use a more advanced
        // instrumentation approach like aspect-oriented programming or
        // code transformation.
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
    this._instrumentedFunctions.clear();
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
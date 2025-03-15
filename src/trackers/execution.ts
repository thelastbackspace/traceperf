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
        execution.memoryUsage = process.memoryUsage().heapUsed - startMemory;
      }
      
      // Restore the previous current execution
      this._currentExecution = previousExecution;
      
      // Remove from call stack
      this._callStack.pop();
    }
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
    const flatExecutions = this.flattenExecutions(this._executions);
    
    // Generate the flow chart
    return this._asciiGenerator.generateFlowChart(flatExecutions);
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

  /**
   * Flatten the execution tree into a list
   * 
   * @param executions - The execution records to flatten
   * @returns A flat list of execution data
   */
  private flattenExecutions(executions: ExecutionRecord[]): ExecutionData[] {
    const result: ExecutionData[] = [];
    
    // Helper function to recursively flatten the tree
    const flatten = (record: ExecutionRecord): void => {
      result.push({
        name: record.name,
        duration: record.duration,
        isSlow: record.isSlow,
        memoryUsage: record.memoryUsage,
        level: record.level,
      });
      
      // Process children
      record.children.forEach(child => flatten(child));
    };
    
    // Flatten each root execution
    executions.forEach(execution => flatten(execution));
    
    return result;
  }
} 
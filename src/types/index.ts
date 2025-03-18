export * from './config';
export * from './logger';

/**
 * Options for tracking function execution
 */
export interface ITrackOptions {
  /**
   * Custom label for the function
   */
  label?: string;
  
  /**
   * Performance threshold in milliseconds
   */
  threshold?: number;
  
  /**
   * Whether to include memory usage in the tracking
   */
  includeMemory?: boolean;
  
  /**
   * Whether to track nested function calls
   * 
   * When enabled, TracePerf will track nested function calls that are made
   * within the tracked function. This requires either using the createTrackable
   * method or explicitly wrapping nested function calls with track().
   * 
   * @default true
   */
  enableNestedTracking?: boolean;
  
  /**
   * Whether to suppress logging
   */
  silent?: boolean;
}

/**
 * Interface for execution trackers
 */
export interface IExecutionTracker {
  /**
   * Track the execution of a function
   * 
   * @param fn - The function to track
   * @param options - Options for tracking
   * @returns The return value of the tracked function
   */
  track<T>(fn: () => T, options?: ITrackOptions): T;
  
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
  createTrackable<T extends (...args: any[]) => any>(
    fn: T, 
    options?: Omit<ITrackOptions, 'label'> & { label?: string }
  ): (...args: Parameters<T>) => ReturnType<T>;
  
  /**
   * Get the current call stack
   * 
   * @returns The current call stack
   */
  getCallStack(): string[];
  
  /**
   * Generate a visual representation of the execution flow
   * 
   * @returns ASCII flow chart of the execution
   */
  generateFlowChart(): string;
  
  /**
   * Clear all execution records
   */
  clear(): void;
} 
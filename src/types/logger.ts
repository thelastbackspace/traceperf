import { LogLevel, LogMode, ITrackOptions } from './config';

/**
 * ILogger - Interface for the main logger functionality
 */
export interface ILogger {
  /**
   * Log an informational message
   * 
   * @param message - The message to log
   * @param args - Additional arguments to include in the log
   */
  info(message: string | object, ...args: any[]): void;
  
  /**
   * Log a warning message
   * 
   * @param message - The message to log
   * @param args - Additional arguments to include in the log
   */
  warn(message: string | object, ...args: any[]): void;
  
  /**
   * Log an error message
   * 
   * @param message - The message to log
   * @param args - Additional arguments to include in the log
   */
  error(message: string | object, ...args: any[]): void;
  
  /**
   * Log a debug message
   * 
   * @param message - The message to log
   * @param args - Additional arguments to include in the log
   */
  debug(message: string | object, ...args: any[]): void;
  
  /**
   * Start a new log group with the given label
   * 
   * @param label - The label for the group
   */
  group(label: string): void;
  
  /**
   * End the current log group
   */
  groupEnd(): void;
  
  /**
   * Set the operational mode for the logger
   * 
   * @param mode - The mode to set
   */
  setMode(mode: LogMode): void;
  
  /**
   * Get the current operational mode
   * 
   * @returns The current mode
   */
  getMode(): LogMode;
  
  /**
   * Track the execution of a function and log performance metrics
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
    options?: any
  ): (...args: Parameters<T>) => ReturnType<T>;
}

/**
 * IExecutionTracker - Interface for tracking function execution
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
}

/**
 * IPerformanceMonitor - Interface for monitoring performance
 */
export interface IPerformanceMonitor {
  /**
   * Start timing an operation
   * 
   * @param label - Label for the operation
   * @returns A unique identifier for the timing operation
   */
  startTimer(label: string): string;
  
  /**
   * End timing an operation
   * 
   * @param id - The identifier returned by startTimer
   * @returns The duration in milliseconds
   */
  endTimer(id: string): number;
  
  /**
   * Check if an operation exceeds the performance threshold
   * 
   * @param duration - The duration in milliseconds
   * @param threshold - The threshold to check against
   * @returns Whether the operation is considered slow
   */
  isBottleneck(duration: number, threshold?: number): boolean;
  
  /**
   * Get memory usage information
   * 
   * @returns Memory usage in bytes
   */
  getMemoryUsage(): { heapUsed: number; heapTotal: number; external: number; rss: number };
} 
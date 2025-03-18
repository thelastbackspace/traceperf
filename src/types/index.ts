export * from './config';
export * from './logger';

/**
 * Interface for TracePerf configuration
 */
export interface ITracePerfConfig {
  /** Tracking mode for balancing performance vs detail */
  trackingMode?: string;
  /** Whether to suppress console output */
  silent?: boolean;
  /** Whether to track memory usage */
  trackMemory?: boolean;
  /** Whether to enable nested function tracking */
  enableNestedTracking?: boolean;
  /** Minimum duration threshold in microseconds */
  threshold?: number;
  /** Sampling rate (0.0-1.0) for reducing overhead */
  sampleRate?: number;
}

/**
 * Interface for tracking options
 */
export interface ITrackOptions {
  /** Custom label for the tracked function */
  label?: string;
  /** Override default tracking mode */
  trackingMode?: string;
  /** Override default silent setting */
  silent?: boolean;
  /** Override default memory tracking */
  trackMemory?: boolean;
  /** Override default nested tracking */
  enableNestedTracking?: boolean;
  /** Minimum duration threshold in microseconds */
  threshold?: number;
  /** Sampling rate (0.0-1.0) for reducing overhead */
  sampleRate?: number;
  /** Any other options */
  [key: string]: any;
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
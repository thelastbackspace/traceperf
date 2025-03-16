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
   * Note: This option doesn't automatically track all nested function calls.
   * It only enables the infrastructure for tracking nested calls, but you still
   * need to manually track each nested function using one of the approaches
   * described in the documentation.
   * 
   * @default true
   */
  enableNestedTracking?: boolean;
  
  /**
   * Whether to suppress logging
   */
  silent?: boolean;
} 
/**
 * LogLevel - Defines the severity levels for logging
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * LogMode - Defines the operational modes for the logger
 */
export type LogMode = 'dev' | 'staging' | 'prod' | string;

/**
 * Transport - Interface for log output destinations
 */
export interface ITransport {
  /**
   * Write a log entry to the destination
   * 
   * @param entry - The formatted log entry to write
   */
  write(entry: string): void;
}

/**
 * Formatter - Interface for log formatters
 */
export interface IFormatter {
  /**
   * Format a log entry
   * 
   * @param level - The log level
   * @param message - The log message
   * @param args - Additional arguments
   * @param meta - Metadata for the log entry
   * @returns The formatted log entry
   */
  format(level: LogLevel, message: string | object, args: any[], meta: LogMeta): string;
}

/**
 * LogMeta - Metadata for log entries
 */
export interface LogMeta {
  timestamp: Date;
  level: LogLevel;
  indentLevel: number;
  [key: string]: any;
}

/**
 * TrackOptions - Options for function execution tracking
 */
export interface ITrackOptions {
  /**
   * Custom label for the tracked function
   */
  label?: string;
  
  /**
   * Performance threshold in milliseconds
   * Functions exceeding this threshold will be flagged as bottlenecks
   */
  threshold?: number;
  
  /**
   * Whether to include memory usage tracking
   */
  includeMemory?: boolean;
  
  /**
   * Whether to suppress logging for this tracking
   */
  silent?: boolean;
  
  /**
   * Whether to enable nested tracking
   * 
   * When enabled, TracePerf will track nested function calls
   * if they are also wrapped with track().
   * 
   * @default true
   */
  enableNestedTracking?: boolean;
}

/**
 * Logger configuration
 */
export interface ILoggerConfig {
  /**
   * Operational mode
   * 
   * - dev: All logs are shown
   * - staging: Only warn and error logs are shown
   * - prod: Only error logs are shown
   */
  mode: LogMode;
  
  /**
   * Minimum log level to show
   */
  level: LogLevel;
  
  /**
   * Whether to colorize logs
   */
  colorize: boolean;
  
  /**
   * Whether to include timestamps in logs
   */
  timestamp: boolean;
  
  /**
   * Performance threshold in milliseconds
   * 
   * Functions that take longer than this threshold will be marked as bottlenecks
   */
  performanceThreshold: number;
  
  /**
   * Indentation size for nested logs
   */
  indentSize: number;
  
  /**
   * Whether to automatically track nested function calls
   * 
   * When enabled, TracePerf will automatically track nested function calls
   * using a proxy-based approach.
   * 
   * @default true
   */
  autoTracking?: boolean;
  
  /**
   * Log output destinations
   * @default [ConsoleTransport]
   */
  transports?: ITransport[];
  
  /**
   * Log formatters
   * @default [CliFormatter]
   */
  formatters?: IFormatter[];
} 
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
}

/**
 * LoggerConfig - Configuration options for the logger
 */
export interface ILoggerConfig {
  /**
   * Operational mode
   * @default 'dev'
   */
  mode?: LogMode;
  
  /**
   * Minimum log level to display
   * @default 'debug'
   */
  level?: LogLevel;
  
  /**
   * Whether to colorize output
   * @default true
   */
  colorize?: boolean;
  
  /**
   * Whether to include timestamps in logs
   * @default true
   */
  timestamp?: boolean;
  
  /**
   * Default performance threshold in milliseconds
   * @default 100
   */
  performanceThreshold?: number;
  
  /**
   * Number of spaces for each indentation level
   * @default 2
   */
  indentSize?: number;
  
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
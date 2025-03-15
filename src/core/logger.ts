import { ILogger, ILoggerConfig, LogLevel, LogMode, LogMeta, ITrackOptions } from '../types';
import { ConfigManager } from './config';
import { ExecutionTracker } from '../trackers/execution';
import { PerformanceMonitor } from '../trackers/performance';
import { CliFormatter } from '../formatters/cli';

/**
 * Console transport for outputting logs to the console
 */
class ConsoleTransport {
  /**
   * Write a log entry to the console
   * 
   * @param entry - The formatted log entry
   */
  public write(entry: string): void {
    console.log(entry);
  }
}

/**
 * Main logger class that implements the ILogger interface
 */
export class Logger implements ILogger {
  private _config: ConfigManager;
  private _executionTracker: ExecutionTracker;
  private _performanceMonitor: PerformanceMonitor;
  private _indentLevel: number = 0;
  private _transports: { write: (entry: string) => void }[];
  private _formatters: { format: (level: LogLevel, message: string | object, args: any[], meta: LogMeta) => string }[];

  /**
   * Create a new Logger instance
   * 
   * @param config - Logger configuration
   */
  constructor(config: Partial<ILoggerConfig> = {}) {
    this._config = new ConfigManager(config);
    
    // Set up trackers
    this._executionTracker = new ExecutionTracker({
      defaultThreshold: this._config.getPerformanceThreshold(),
    });
    
    this._performanceMonitor = new PerformanceMonitor({
      defaultThreshold: this._config.getPerformanceThreshold(),
    });
    
    // Set up transports
    this._transports = config.transports || [new ConsoleTransport()];
    
    // Set up formatters
    this._formatters = config.formatters || [
      new CliFormatter({
        colorEnabled: this._config.isColorEnabled(),
        indentSize: this._config.getIndentSize(),
      }),
    ];
  }

  /**
   * Log an informational message
   * 
   * @param message - The message to log
   * @param args - Additional arguments to include in the log
   */
  public info(message: string | object, ...args: any[]): void {
    this.log('info', message, args);
  }

  /**
   * Log a warning message
   * 
   * @param message - The message to log
   * @param args - Additional arguments to include in the log
   */
  public warn(message: string | object, ...args: any[]): void {
    this.log('warn', message, args);
  }

  /**
   * Log an error message
   * 
   * @param message - The message to log
   * @param args - Additional arguments to include in the log
   */
  public error(message: string | object, ...args: any[]): void {
    this.log('error', message, args);
  }

  /**
   * Log a debug message
   * 
   * @param message - The message to log
   * @param args - Additional arguments to include in the log
   */
  public debug(message: string | object, ...args: any[]): void {
    // Skip debug logs in production mode
    if (this.getMode() === 'prod') {
      return;
    }
    
    this.log('debug', message, args);
  }

  /**
   * Start a new log group with the given label
   * 
   * @param label - The label for the group
   */
  public group(label: string): void {
    this.info(label);
    this._indentLevel++;
  }

  /**
   * End the current log group
   */
  public groupEnd(): void {
    if (this._indentLevel > 0) {
      this._indentLevel--;
    }
  }

  /**
   * Set the operational mode for the logger
   * 
   * @param mode - The mode to set
   */
  public setMode(mode: LogMode): void {
    this._config.setMode(mode);
  }

  /**
   * Get the current operational mode
   * 
   * @returns The current mode
   */
  public getMode(): LogMode {
    return this._config.getMode();
  }

  /**
   * Track the execution of a function and log performance metrics
   * 
   * @param fn - The function to track
   * @param options - Options for tracking
   * @returns The return value of the tracked function
   */
  public track<T>(fn: () => T, options?: ITrackOptions): T {
    const silent = options?.silent ?? false;
    
    // Track the function execution
    const result = this._executionTracker.track(fn, options);
    
    // Log the execution flow if not silent
    if (!silent) {
      const flowChart = this._executionTracker.generateFlowChart();
      
      // Log the flow chart directly to the console
      // This bypasses the formatters to preserve the ASCII art
      console.log('\nExecution Flow:');
      console.log(flowChart);
    }
    
    return result;
  }

  /**
   * Internal method to log a message
   * 
   * @param level - The log level
   * @param message - The message to log
   * @param args - Additional arguments
   */
  private log(level: LogLevel, message: string | object, args: any[]): void {
    // Check if this log level should be displayed
    if (!this._config.shouldLog(level)) {
      return;
    }
    
    // Create metadata for the log entry
    const meta: LogMeta = {
      timestamp: new Date(),
      level,
      indentLevel: this._indentLevel,
    };
    
    // Format the log entry using each formatter
    for (const formatter of this._formatters) {
      const formattedEntry = formatter.format(level, message, args, meta);
      
      // Send to each transport
      for (const transport of this._transports) {
        transport.write(formattedEntry);
      }
    }
  }
} 
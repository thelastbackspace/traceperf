import { IFormatter, LogLevel, LogMeta } from '../types';
import { LEVEL_COLORS, LEVEL_ICONS } from '../core/constants';
import { colorize, dim, supportsColor } from '../utils/colors';

/**
 * CLI formatter for console output
 * Formats log entries with colors, icons, and indentation
 */
export class CliFormatter implements IFormatter {
  private _colorEnabled: boolean;
  private _indentSize: number;

  /**
   * Create a new CliFormatter instance
   * 
   * @param options - Formatter options
   */
  constructor(options: { colorEnabled?: boolean; indentSize?: number } = {}) {
    this._colorEnabled = options.colorEnabled ?? supportsColor();
    this._indentSize = options.indentSize ?? 2;
  }

  /**
   * Format a log entry for CLI output
   * 
   * @param level - The log level
   * @param message - The log message
   * @param args - Additional arguments
   * @param meta - Metadata for the log entry
   * @returns The formatted log entry
   */
  public format(level: LogLevel, message: string | object, args: any[], meta: LogMeta): string {
    const timestamp = this.formatTimestamp(meta.timestamp);
    const levelStr = this.formatLevel(level);
    const indent = ' '.repeat(meta.indentLevel * this._indentSize);
    const formattedMessage = this.formatMessage(message, args);
    
    return `${timestamp} ${levelStr} ${indent}${formattedMessage}`;
  }

  /**
   * Format a timestamp
   * 
   * @param date - The date to format
   * @returns The formatted timestamp
   */
  private formatTimestamp(date: Date): string {
    const timeStr = date.toISOString().replace(/T/, ' ').replace(/\..+/, '');
    return this._colorEnabled ? dim(`[${timeStr}]`) : `[${timeStr}]`;
  }

  /**
   * Format a log level
   * 
   * @param level - The log level
   * @returns The formatted log level
   */
  private formatLevel(level: LogLevel): string {
    const icon = LEVEL_ICONS[level];
    const text = level.toUpperCase();
    
    if (this._colorEnabled) {
      return colorize(`${icon} ${text}`, LEVEL_COLORS[level]);
    }
    
    return `${icon} ${text}`;
  }

  /**
   * Format a message and its arguments
   * 
   * @param message - The message to format
   * @param args - Additional arguments
   * @returns The formatted message
   */
  private formatMessage(message: string | object, args: any[]): string {
    let formattedMessage: string;
    
    if (typeof message === 'string') {
      formattedMessage = message;
    } else {
      try {
        formattedMessage = JSON.stringify(message, null, 2);
      } catch (error) {
        formattedMessage = String(message);
      }
    }
    
    // Format additional arguments
    if (args.length > 0) {
      const formattedArgs = args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg, null, 2);
          } catch (error) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
      
      formattedMessage = `${formattedMessage} ${formattedArgs}`;
    }
    
    return formattedMessage;
  }
} 
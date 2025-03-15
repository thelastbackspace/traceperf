import { IFormatter, LogLevel, LogMeta } from '../types';

/**
 * JSON formatter for structured output
 * Formats log entries as JSON objects
 */
export class JsonFormatter implements IFormatter {
  /**
   * Format a log entry as JSON
   * 
   * @param level - The log level
   * @param message - The log message
   * @param args - Additional arguments
   * @param meta - Metadata for the log entry
   * @returns The formatted log entry as a JSON string
   */
  public format(level: LogLevel, message: string | object, args: any[], meta: LogMeta): string {
    const logEntry = {
      timestamp: meta.timestamp.toISOString(),
      level,
      indentLevel: meta.indentLevel,
      message: this.formatMessage(message),
      args: this.formatArgs(args),
      ...this.extractExtraMeta(meta),
    };
    
    return JSON.stringify(logEntry);
  }

  /**
   * Format a message for JSON output
   * 
   * @param message - The message to format
   * @returns The formatted message
   */
  private formatMessage(message: string | object): string | object {
    if (typeof message === 'string') {
      return message;
    }
    
    return this.sanitizeObject(message);
  }

  /**
   * Format arguments for JSON output
   * 
   * @param args - The arguments to format
   * @returns The formatted arguments
   */
  private formatArgs(args: any[]): any[] {
    return args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        return this.sanitizeObject(arg);
      }
      return arg;
    });
  }

  /**
   * Sanitize an object for JSON serialization
   * 
   * @param obj - The object to sanitize
   * @returns A sanitized version of the object
   */
  private sanitizeObject(obj: object): object {
    try {
      // Use JSON.parse(JSON.stringify()) to remove non-serializable values
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      // If serialization fails, return a simplified object
      return { value: String(obj) };
    }
  }

  /**
   * Extract additional metadata from the log meta object
   * 
   * @param meta - The log metadata
   * @returns Additional metadata as an object
   */
  private extractExtraMeta(meta: LogMeta): Record<string, any> {
    const result: Record<string, any> = {};
    
    // Copy all properties except the standard ones
    Object.keys(meta).forEach(key => {
      if (!['timestamp', 'level', 'indentLevel'].includes(key)) {
        result[key] = meta[key];
      }
    });
    
    return result;
  }
} 
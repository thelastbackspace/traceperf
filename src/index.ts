import { Logger } from './core/logger';
import { ILoggerConfig } from './types';

// Create a singleton instance of the logger
const defaultLogger = new Logger();

// Export the singleton instance as the default export
export default defaultLogger;

// Export a function to create a new logger instance
export function createLogger(config: Partial<ILoggerConfig> = {}): Logger {
  return new Logger(config);
}

// Export types and classes for advanced usage
export * from './types';
export * from './core';
export * from './formatters';
export * from './trackers';
export * from './utils';

// Add CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(defaultLogger, {
    default: defaultLogger,
    createLogger,
    // Re-export everything from the modules
    ...require('./types'),
    ...require('./core'),
    ...require('./formatters'),
    ...require('./trackers'),
    ...require('./utils')
  });
} 
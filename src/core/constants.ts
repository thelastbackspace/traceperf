import { LogLevel, LogMode, ILoggerConfig } from '../types';

/**
 * Default configuration for the logger
 */
export const DEFAULT_CONFIG: ILoggerConfig = {
  mode: 'dev',
  level: 'debug',
  colorize: true,
  timestamp: true,
  performanceThreshold: 100, // ms
  indentSize: 2,
};

/**
 * Log level priorities (higher number = higher priority)
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Minimum log level for each mode
 */
export const MODE_MIN_LEVELS: Record<LogMode, LogLevel> = {
  dev: 'debug',    // In dev mode, show all logs
  staging: 'warn',  // In staging, show only warnings and errors
  prod: 'error',    // In prod, show only errors
};

/**
 * ANSI color codes for terminal output
 */
export const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  
  // Foreground colors
  fg: {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
  },
  
  // Background colors
  bg: {
    black: '\x1b[40m',
    red: '\x1b[41m',
    green: '\x1b[42m',
    yellow: '\x1b[43m',
    blue: '\x1b[44m',
    magenta: '\x1b[45m',
    cyan: '\x1b[46m',
    white: '\x1b[47m',
  },
};

/**
 * Log level colors
 */
export const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.fg.gray,
  info: COLORS.fg.blue,
  warn: COLORS.fg.yellow,
  error: COLORS.fg.red,
};

/**
 * Log level icons
 */
export const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
};

/**
 * Box drawing characters for ASCII flow charts
 */
export const BOX_CHARS = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  verticalRight: '├',
  verticalLeft: '┤',
  horizontalDown: '┬',
  horizontalUp: '┴',
  cross: '┼',
  downArrow: '▼',
};

/**
 * Performance icons
 */
export const PERFORMANCE_ICONS = {
  timer: '⏱',
  slow: '⚠️',
  memory: '📊',
  bottleneck: '🛑',
  fix: '🛠',
}; 
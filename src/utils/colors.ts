import { COLORS } from '../core/constants';

/**
 * Utilities for working with terminal colors
 */

/**
 * Apply color to a string
 * 
 * @param text - The text to colorize
 * @param color - The color to apply
 * @returns The colorized string
 */
export function colorize(text: string, color: string): string {
  return `${color}${text}${COLORS.reset}`;
}

/**
 * Apply bold formatting to a string
 * 
 * @param text - The text to make bold
 * @returns The bold string
 */
export function bold(text: string): string {
  return `${COLORS.bright}${text}${COLORS.reset}`;
}

/**
 * Apply dim formatting to a string
 * 
 * @param text - The text to make dim
 * @returns The dim string
 */
export function dim(text: string): string {
  return `${COLORS.dim}${text}${COLORS.reset}`;
}

/**
 * Apply underline formatting to a string
 * 
 * @param text - The text to underline
 * @returns The underlined string
 */
export function underline(text: string): string {
  return `${COLORS.underscore}${text}${COLORS.reset}`;
}

/**
 * Apply red color to a string
 * 
 * @param text - The text to colorize
 * @returns The red string
 */
export function red(text: string): string {
  return colorize(text, COLORS.fg.red);
}

/**
 * Apply green color to a string
 * 
 * @param text - The text to colorize
 * @returns The green string
 */
export function green(text: string): string {
  return colorize(text, COLORS.fg.green);
}

/**
 * Apply yellow color to a string
 * 
 * @param text - The text to colorize
 * @returns The yellow string
 */
export function yellow(text: string): string {
  return colorize(text, COLORS.fg.yellow);
}

/**
 * Apply blue color to a string
 * 
 * @param text - The text to colorize
 * @returns The blue string
 */
export function blue(text: string): string {
  return colorize(text, COLORS.fg.blue);
}

/**
 * Apply magenta color to a string
 * 
 * @param text - The text to colorize
 * @returns The magenta string
 */
export function magenta(text: string): string {
  return colorize(text, COLORS.fg.magenta);
}

/**
 * Apply cyan color to a string
 * 
 * @param text - The text to colorize
 * @returns The cyan string
 */
export function cyan(text: string): string {
  return colorize(text, COLORS.fg.cyan);
}

/**
 * Apply gray color to a string
 * 
 * @param text - The text to colorize
 * @returns The gray string
 */
export function gray(text: string): string {
  return colorize(text, COLORS.fg.gray);
}

/**
 * Check if terminal supports colors
 * 
 * @returns Whether the terminal supports colors
 */
export function supportsColor(): boolean {
  if (process.env.FORCE_COLOR === '0') {
    return false;
  }
  
  if (process.env.FORCE_COLOR) {
    return true;
  }
  
  if (process.platform === 'win32') {
    return true;
  }
  
  if ('CI' in process.env) {
    return true;
  }
  
  if (process.env.COLORTERM) {
    return true;
  }
  
  if (process.env.TERM === 'dumb') {
    return false;
  }
  
  if (process.stdout.isTTY) {
    return true;
  }
  
  return false;
} 
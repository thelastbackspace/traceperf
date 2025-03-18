/**
 * String utility functions
 */

/**
 * Center a string with padding
 * 
 * @param str - The string to center
 * @param length - The total length of the returned string
 * @param char - The character to use for padding (default: space)
 * @returns The padded string
 */
export function padCenter(str: string, length: number, char: string = ' '): string {
  if (str.length >= length) return str;
  
  const leftPadding = Math.floor((length - str.length) / 2);
  const rightPadding = length - str.length - leftPadding;
  
  return char.repeat(leftPadding) + str + char.repeat(rightPadding);
}

/**
 * Truncate a string to a specified length and add ellipsis if needed
 * 
 * @param str - The string to truncate
 * @param maxLength - The maximum length allowed
 * @returns The truncated string
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  
  const ellipsis = '...';
  return str.substring(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Ensure that the string is at least a certain length
 * 
 * @param str - The string to pad
 * @param length - The minimum length desired
 * @param char - The character to use for padding (default: space)
 * @returns The padded string
 */
export function padEnd(str: string, length: number, char: string = ' '): string {
  if (str.length >= length) return str;
  
  return str + char.repeat(length - str.length);
} 
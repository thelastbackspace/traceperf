/**
 * Utilities for managing call stacks and function tracking
 */

/**
 * Extract the name of a function
 * 
 * @param fn - The function to extract the name from
 * @returns The function name or a placeholder if not available
 */
export function getFunctionName(fn: Function): string {
  if (fn.name) {
    return fn.name;
  }
  
  // Try to extract name from function toString()
  const fnStr = fn.toString();
  const nameMatch = fnStr.match(/function\s+([^(]+)/);
  if (nameMatch) {
    return nameMatch[1].trim();
  }
  
  // For arrow functions or anonymous functions
  const arrowMatch = fnStr.match(/^\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/);
  if (arrowMatch) {
    return '<arrow function>';
  }
  
  return '<anonymous>';
}

/**
 * Get the current call stack
 * 
 * @returns An array of function names in the call stack
 */
export function getCallStack(): string[] {
  const stack = new Error().stack;
  if (!stack) {
    return [];
  }
  
  // Parse the stack trace
  return stack
    .split('\n')
    .slice(2) // Skip the Error and this function
    .map(line => {
      const match = line.match(/at\s+([^\s]+)/);
      return match ? match[1] : line.trim();
    });
}

/**
 * CallStackManager - Manages a call stack for execution tracking
 */
export class CallStackManager {
  private _stack: string[] = [];
  
  /**
   * Push a function name onto the call stack
   * 
   * @param name - The function name
   * @returns The current stack depth
   */
  public push(name: string): number {
    this._stack.push(name);
    return this._stack.length;
  }
  
  /**
   * Pop a function name from the call stack
   * 
   * @returns The popped function name or undefined if the stack is empty
   */
  public pop(): string | undefined {
    return this._stack.pop();
  }
  
  /**
   * Get the current call stack
   * 
   * @returns A copy of the current call stack
   */
  public getStack(): string[] {
    return [...this._stack];
  }
  
  /**
   * Get the current stack depth
   * 
   * @returns The current stack depth
   */
  public getDepth(): number {
    return this._stack.length;
  }
  
  /**
   * Clear the call stack
   */
  public clear(): void {
    this._stack = [];
  }
  
  /**
   * Get the current function name (top of the stack)
   * 
   * @returns The current function name or undefined if the stack is empty
   */
  public getCurrentFunction(): string | undefined {
    return this._stack[this._stack.length - 1];
  }
  
  /**
   * Get the parent function name
   * 
   * @returns The parent function name or undefined if there is no parent
   */
  public getParentFunction(): string | undefined {
    return this._stack[this._stack.length - 2];
  }
} 
/**
 * High-resolution timing utilities for performance tracking
 */

/**
 * Get the current high-resolution time
 * 
 * @returns The current high-resolution time
 */
export function getHighResTime(): [number, number] {
  return process.hrtime();
}

/**
 * Calculate the duration between a start time and now
 * 
 * @param startTime - The start time from getHighResTime()
 * @returns The duration in milliseconds
 */
export function getDuration(startTime: [number, number]): number {
  const [seconds, nanoseconds] = process.hrtime(startTime);
  return seconds * 1000 + nanoseconds / 1000000;
}

/**
 * Format a duration in milliseconds to a human-readable string
 * 
 * @param duration - The duration in milliseconds
 * @returns A formatted string (e.g., "1.23ms", "1.23s")
 */
export function formatDuration(duration: number): string {
  if (duration < 1) {
    return `${(duration * 1000).toFixed(2)}μs`;
  } else if (duration < 1000) {
    return `${duration.toFixed(2)}ms`;
  } else {
    return `${(duration / 1000).toFixed(2)}s`;
  }
}

/**
 * A simple timer class for measuring durations
 */
export class Timer {
  private _startTime: [number, number];
  private _endTime: [number, number] | null = null;
  private _label: string;

  /**
   * Create a new Timer instance
   * 
   * @param label - A label for the timer
   */
  constructor(label: string) {
    this._startTime = getHighResTime();
    this._label = label;
  }

  /**
   * Stop the timer
   * 
   * @returns The duration in milliseconds
   */
  public stop(): number {
    if (this._endTime === null) {
      this._endTime = getHighResTime();
    }
    return this.getDuration();
  }

  /**
   * Get the duration of the timer
   * 
   * @returns The duration in milliseconds
   */
  public getDuration(): number {
    if (this._endTime === null) {
      return getDuration(this._startTime);
    }
    return getDuration(this._startTime);
  }

  /**
   * Get the label of the timer
   * 
   * @returns The timer label
   */
  public getLabel(): string {
    return this._label;
  }

  /**
   * Reset the timer
   */
  public reset(): void {
    this._startTime = getHighResTime();
    this._endTime = null;
  }

  /**
   * Get a formatted string with the duration
   * 
   * @returns A formatted string (e.g., "label: 1.23ms")
   */
  public toString(): string {
    return `${this._label}: ${formatDuration(this.getDuration())}`;
  }
} 
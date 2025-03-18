import { IPerformanceMonitor } from '../types';
import { getHighResTime, getDuration } from '../utils/timing';
import { v4 as uuidv4 } from 'uuid';

/**
 * Performance monitor for tracking execution times and memory usage
 */
export class PerformanceMonitor implements IPerformanceMonitor {
  private _timers: Map<string, [number, number]> = new Map();
  private _defaultThreshold: number;

  /**
   * Create a new PerformanceMonitor instance
   * 
   * @param options - Monitor options
   */
  constructor(options: { defaultThreshold?: number } = {}) {
    this._defaultThreshold = options.defaultThreshold ?? 100; // ms
  }

  /**
   * Start timing an operation
   * 
   * @param label - Label for the operation
   * @returns A unique identifier for the timing operation
   */
  public startTimer(label: string): string {
    const id = `${label}-${uuidv4()}`;
    this._timers.set(id, getHighResTime());
    return id;
  }

  /**
   * End timing an operation
   * 
   * @param id - The identifier returned by startTimer
   * @returns The duration in milliseconds
   * @throws Error if the timer doesn't exist
   */
  public endTimer(id: string): number {
    const startTime = this._timers.get(id);
    if (!startTime) {
      throw new Error(`Timer with id ${id} not found`);
    }
    
    const duration = getDuration(startTime);
    this._timers.delete(id);
    
    return duration;
  }

  /**
   * Check if an operation exceeds the performance threshold
   * 
   * @param duration - The duration in milliseconds
   * @param threshold - The threshold to check against
   * @returns Whether the operation is considered slow
   */
  public isBottleneck(duration: number, threshold?: number): boolean {
    const effectiveThreshold = threshold ?? this._defaultThreshold;
    return duration > effectiveThreshold;
  }

  /**
   * Get memory usage information
   * 
   * @returns Memory usage object
   */
  public getMemoryUsage(): { heapUsed: number; heapTotal: number; external: number; rss: number } | undefined {
    try {
      return process.memoryUsage();
    } catch (e) {
      console.warn('Unable to track memory usage:', e);
      return undefined;
    }
  }

  /**
   * Calculate memory difference between current and start memory
   * 
   * @param start - Starting memory usage snapshot
   * @returns Memory difference or undefined
   */
  public getMemoryDiff(start: { heapUsed: number }): number {
    try {
      const current = this.getMemoryUsage();
      if (!current) return 0;
      
      const diff = current.heapUsed - start.heapUsed;
      
      // Return zero instead of negative values
      // Negative values usually indicate garbage collection, not actual memory release
      return Math.max(0, diff);
    } catch (e) {
      console.warn('Error calculating memory usage:', e);
      return 0;
    }
  }

  /**
   * Generate a suggestion for a bottleneck
   * 
   * @param functionName - The name of the function
   * @param duration - The duration in milliseconds
   * @param memoryUsage - Memory usage in bytes
   * @returns A suggestion for improving performance
   */
  public generateSuggestion(
    functionName: string,
    duration: number,
    memoryUsage?: number
  ): string {
    // Simple heuristic-based suggestions
    if (memoryUsage && memoryUsage > 10 * 1024 * 1024) {
      return `🛠 Potential Fix: Check for memory leaks or large object allocations in ${functionName}`;
    }
    
    if (duration > 1000) {
      return `🛠 Potential Fix: Consider optimizing or adding caching to ${functionName}`;
    }
    
    if (duration > 500) {
      return `🛠 Potential Fix: Look for blocking operations in ${functionName}`;
    }
    
    return `🛠 Potential Fix: Review ${functionName} for performance optimizations`;
  }
} 
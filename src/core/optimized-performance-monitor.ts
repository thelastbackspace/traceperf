/**
 * Optimized Performance Monitoring Library
 * 
 * This implementation incorporates all optimizations from benchmarking:
 * 1. Tiered tracking modes for performance vs. detail balance
 * 2. Context preservation for object methods
 * 3. Async/Promise support
 * 4. Browser/Node.js environment detection
 * 5. Memory usage tracking optimizations
 * 6. Module registration capability
 * 7. Enhanced visualization
 */

// Define tracking mode constants directly to avoid circular dependency
export const TrackingModes = {
  PERFORMANCE: 'performance',
  BALANCED: 'balanced',
  DETAILED: 'detailed',
  DEBUG: 'debug'
};

// Define default tracking mode separately to avoid circular dependency
const DEFAULT_TRACKING_MODE = TrackingModes.BALANCED;

/**
 * Get current memory usage with environment detection
 * @returns Memory usage in bytes
 */
export const getMemoryUsage = (): number => {
  // Safe check for Node.js process.memoryUsage()
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const mem = process.memoryUsage();
    return mem.heapUsed;
  }
  // Browser memory API if available
  else if (typeof performance !== 'undefined' && 'memory' in performance) {
    // @ts-ignore - performance.memory exists in Chrome
    return performance.memory.usedJSHeapSize;
  }
  // Fallback when no memory API available
  return 0;
};

/**
 * Get high-resolution timestamp with environment detection
 * @returns Timestamp in nanoseconds
 */
export const getTimestamp = (): number => {
  // Use performance.now() in browsers (convert to nanoseconds)
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now() * 1000000;
  }
  // Use process.hrtime() in Node.js
  else if (typeof process !== 'undefined' && process.hrtime) {
    const hrTime = process.hrtime();
    return hrTime[0] * 1000000000 + hrTime[1];
  }
  // Fallback to Date.now() (converted to nanoseconds)
  return Date.now() * 1000000;
};

/**
 * Calculate time difference between two timestamps
 * @param startTime Starting timestamp in nanoseconds
 * @returns Duration in nanoseconds
 */
export const getDuration = (startTime: number): number => {
  return getTimestamp() - startTime;
};

/**
 * Interface for execution tracking options
 */
export interface ExecutionTrackerOptions {
  trackingMode?: string;
  silent?: boolean;
  showMemoryUsage?: boolean;
  enableNestedTracking?: boolean;
  threshold?: number;
}

/**
 * Interface for timer options
 */
export interface TimerOptions {
  trackMemory?: boolean;
  captureArgs?: boolean;
  args?: any[];
}

/**
 * Interface for execution data
 */
export interface ExecutionData {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  duration: number;
  parentId: string | null;
  children: string[];
  args?: string[];
  complete: boolean;
  memoryAtStart?: number;
  memoryAtEnd?: number;
  memoryDelta?: number;
  result?: any;
  error?: Error | null;
}

/**
 * Optimized tracker for individual function executions
 */
export class OptimizedExecutionTracker {
  private executionTree: Record<string, ExecutionData> = {};
  private currentExecutionId: number = 0;
  private activeExecutions: Map<string, ExecutionData> = new Map();
  
  // Configuration
  public showMemoryUsage: boolean;
  public enableNestedTracking: boolean;
  public silent: boolean;
  public trackingMode: string;
  public defaultThreshold: number;
  
  // Formatters for flow chart generation
  private _formatters = {
    indent: '  ',
    childPrefix: '├─ ',
    lastChildPrefix: '└─ ',
    linePrefix: '│  ',
    emptyPrefix: '   ',
    errorMarker: '✖ ',
    memoryLabel: '📊 '
  };

  /**
   * Create a new execution tracker
   * @param options Tracker configuration options
   */
  constructor(options: ExecutionTrackerOptions = {}) {
    this.showMemoryUsage = options.showMemoryUsage ?? true;
    this.enableNestedTracking = options.enableNestedTracking ?? true;
    this.silent = options.silent ?? false;
    this.trackingMode = options.trackingMode ?? TrackingModes.BALANCED;
    this.defaultThreshold = options.threshold ?? 100;
  }

  /**
   * Start timing a function execution
   * @param label Function name or label
   * @param parentExecutionId ID of parent execution if nested
   * @param options Additional options
   * @returns Execution ID
   */
  public startTimer(label: string, parentExecutionId: string | null = null, options: TimerOptions = {}): string {
    // Skip detailed tracking in performance mode
    const collectMemory = this.trackingMode !== TrackingModes.PERFORMANCE && this.showMemoryUsage;
    
    const startTime = getTimestamp();
    const executionId = (++this.currentExecutionId).toString();
    
    const execution: ExecutionData = {
      id: executionId,
      label: label || 'anonymous',
      startTime,
      endTime: 0,
      duration: 0,
      parentId: parentExecutionId,
      children: [],
      args: options.captureArgs && options.args ? 
        Array.from(options.args).map(arg => String(arg).substring(0, 50)) : [],
      complete: false
    };
    
    // Collect memory usage if enabled
    if (collectMemory) {
      execution.memoryAtStart = getMemoryUsage();
      execution.memoryAtEnd = 0;
      execution.memoryDelta = 0;
    }
    
    // Add to parent's children if parent exists
    if (parentExecutionId && this.activeExecutions.has(parentExecutionId)) {
      const parent = this.activeExecutions.get(parentExecutionId);
      if (parent && parent.children) {
        parent.children.push(executionId);
      }
    }
    
    // Store in active executions map
    this.activeExecutions.set(executionId, execution);
    
    return executionId;
  }

  /**
   * End timing a function execution
   * @param executionId ID of the execution to end
   * @param result Result of the function
   * @param error Error if the function threw
   * @returns Execution data
   */
  public endTimer(executionId: string, result?: any, error: Error | null = null): ExecutionData | null {
    if (!this.activeExecutions.has(executionId)) {
      return null;
    }
    
    const execution = this.activeExecutions.get(executionId)!;
    execution.endTime = getTimestamp();
    execution.duration = execution.endTime - execution.startTime;
    execution.result = result;
    execution.error = error;
    execution.complete = true;
    
    // Only collect memory in non-performance modes
    if (this.trackingMode !== TrackingModes.PERFORMANCE && this.showMemoryUsage) {
      execution.memoryAtEnd = getMemoryUsage();
      execution.memoryDelta = execution.memoryAtEnd - (execution.memoryAtStart || 0);
    }
    
    // Store in the execution tree
    this.executionTree[executionId] = { ...execution };
    
    // Generate flow chart if not silent
    if (!this.silent && this.trackingMode !== TrackingModes.PERFORMANCE) {
      const flowChart = this._generateExecutionFlowChart(execution);
      console.log(flowChart);
    }
    
    return execution;
  }

  /**
   * Generate a visualization of the execution flow
   * @param execution The execution to visualize
   * @param depth Current depth in the tree
   * @param isLastChild Whether this is the last child
   * @param ancestors Array tracking if parents were last children
   * @returns Formatted execution flow chart
   */
  private _generateExecutionFlowChart(
    execution: ExecutionData, 
    depth: number = 0, 
    isLastChild: boolean = true, 
    ancestors: boolean[] = []
  ): string {
    // Skip in performance mode
    if (this.trackingMode === TrackingModes.PERFORMANCE) {
      return '';
    }
    
    // Build the flow chart
    let flowChart = '';
    
    // Format the execution line based on tracking mode
    const durationStr = (execution.duration / 1000000).toFixed(3);
    const formatters = this._formatters;
    let line = `${formatters.indent.repeat(depth)}${isLastChild ? formatters.lastChildPrefix : formatters.childPrefix}${execution.label}: ${durationStr} ms`;
    
    // Add memory usage if enabled and in detailed modes
    if (this.showMemoryUsage && 
        execution.memoryDelta !== undefined && 
        this.trackingMode !== TrackingModes.PERFORMANCE) {
      const memoryStr = (execution.memoryDelta / 1024).toFixed(2);
      const sign = execution.memoryDelta >= 0 ? '+' : '';
      line += ` ${formatters.memoryLabel}${sign}${memoryStr} KB`;
    }
    
    // Add error indicator
    if (execution.error && (this.trackingMode === TrackingModes.DETAILED || this.trackingMode === TrackingModes.DEBUG)) {
      line += ` ${formatters.errorMarker}${execution.error.message}`;
    }
    
    flowChart += line + '\n';
    
    // Process children (skip in performance mode)
    if (execution.children && execution.children.length > 0 && this.trackingMode !== TrackingModes.PERFORMANCE) {
      const childExecutions = execution.children
        .map(childId => this.executionTree[childId] || this.activeExecutions.get(childId))
        .filter(Boolean);
        
      for (let i = 0; i < childExecutions.length; i++) {
        const isLast = i === childExecutions.length - 1;
        const childFlowChart = this._generateExecutionFlowChart(
          childExecutions[i]!,
          depth + 1,
          isLast,
          [...ancestors, !isLastChild]
        );
        flowChart += childFlowChart;
      }
    }
    
    return flowChart;
  }

  /**
   * Create a trackable version of a function
   * @param fn Function to track
   * @param options Tracking options
   * @returns Tracked version of the function
   */
  public createTrackable<T extends (...args: any[]) => any>(
    fn: T,
    options: Record<string, any> = {}
  ): (...args: Parameters<T>) => ReturnType<T> {
    if (typeof fn !== 'function') {
      throw new Error('First argument must be a function');
    }
    
    const label = options.label || fn.name || 'anonymous';
    const parentExecutionId = options.parentExecutionId || null;
    const silent = options.hasOwnProperty('silent') ? options.silent : this.silent;
    const trackingMode = options.trackingMode || this.trackingMode;
    const sampleRate = options.hasOwnProperty('sampleRate') ? 
      Math.max(0, Math.min(1, options.sampleRate)) : 1.0;
    
    // Performance optimization - if in performance mode and silent, return original function
    if (trackingMode === TrackingModes.PERFORMANCE && 
        (options.silent || this.silent) && 
        !this.enableNestedTracking) {
      return fn;
    }
    
    // Create the tracked function
    const self = this;
    const trackedFn = function(this: any, ...args: Parameters<T>): ReturnType<T> {
      // Apply sampling - randomly decide whether to track this call
      const shouldSample = Math.random() < sampleRate;
      
      // If not sampling this call, just execute the function directly
      if (!shouldSample) {
        return fn.apply(this, args);
      }
      
      // Start tracking the execution
      const executionId = self.startTimer(
        label,
        parentExecutionId,
        {
          trackMemory: options.trackMemory !== undefined ? options.trackMemory : self.showMemoryUsage,
          captureArgs: options.captureArgs,
          args: args
        }
      );
      
      try {
        // Execute the function with correct this context
        const result = fn.apply(this, args);
        
        // Handle promises
        if (result && typeof result.then === 'function') {
          return result
            .then((resolvedValue: any) => {
              self.endTimer(executionId, resolvedValue);
              return resolvedValue;
            })
            .catch((error: Error) => {
              self.endTimer(executionId, undefined, error);
              throw error; // Re-throw to preserve error behavior
            }) as ReturnType<T>;
        }
        
        // Handle synchronous functions
        self.endTimer(executionId, result);
        return result;
      } catch (error) {
        // Handle synchronous errors
        self.endTimer(executionId, undefined, error as Error);
        throw error; // Re-throw to preserve error behavior
      }
    };
    
    // Preserve function properties
    Object.defineProperty(trackedFn, 'name', { value: fn.name, configurable: true });
    Object.defineProperty(trackedFn, 'length', { value: fn.length });
    
    return trackedFn as (...args: Parameters<T>) => ReturnType<T>;
  }

  /**
   * Track a module's methods
   * @param module Module to track
   * @param options Tracking options
   * @returns Tracked module
   */
  public trackModule<T extends Record<string, any>>(module: T, options: Record<string, any> = {}): T {
    if (!module || typeof module !== 'object') {
      throw new Error('Module must be an object');
    }
    
    const prefix = options.prefix || '';
    const trackingMode = options.trackingMode || this.trackingMode;
    
    // Performance optimization - if in performance mode and silent, return original module
    if (trackingMode === TrackingModes.PERFORMANCE && 
        (options.silent || this.silent) && 
        !this.enableNestedTracking) {
      return module;
    }
    
    // Create a new object to avoid modifying the original
    const trackedModule = Object.create(
      Object.getPrototypeOf(module)
    );
    
    // Copy own properties
    Object.getOwnPropertyNames(module).forEach(key => {
      const descriptor = Object.getOwnPropertyDescriptor(module, key);
      if (!descriptor) return;
      
      // If it's a method, track it
      if (typeof module[key] === 'function') {
        const methodOptions = {
          ...options,
          label: `${prefix}${key}`
        };
        trackedModule[key] = this.createTrackable(module[key], methodOptions);
      } else {
        // Otherwise, just copy the property
        Object.defineProperty(trackedModule, key, descriptor);
      }
    });
    
    return trackedModule;
  }

  /**
   * Track a function execution directly
   * @param fn Function to track
   * @param options Tracking options
   * @returns Function result
   */
  public track<T>(fn: () => T, options: Record<string, any> = {}): T {
    // Create a trackable version and call it immediately
    const trackableFn = this.createTrackable(fn, options);
    return trackableFn.apply(options.thisContext || this, options.args || []);
  }

  /**
   * Reset the tracker state
   */
  public reset(): void {
    this.executionTree = {};
    this.currentExecutionId = 0;
    this.activeExecutions = new Map();
  }
}

/**
 * Interface for performance monitor options
 */
export interface PerformanceMonitorOptions {
  trackingMode?: string;
  silent?: boolean;
  trackMemory?: boolean;
  enableNestedTracking?: boolean;
  threshold?: number;
  sampleRate?: number;
}

/**
 * Main performance monitoring interface
 */
export class OptimizedPerformanceMonitor {
  private config: {
    trackingMode: string;
    silent: boolean;
    trackMemory: boolean;
    enableNestedTracking: boolean;
    threshold: number;
    sampleRate: number;
  };
  
  private executionTracker: OptimizedExecutionTracker;

  /**
   * Create a new performance monitor instance
   * @param options Configuration options
   */
  constructor(options: PerformanceMonitorOptions = {}) {
    this.config = {
      trackingMode: options.trackingMode || DEFAULT_TRACKING_MODE,
      silent: options.silent || false,
      trackMemory: options.trackMemory !== undefined ? options.trackMemory : true,
      enableNestedTracking: options.enableNestedTracking !== undefined ? options.enableNestedTracking : true,
      threshold: options.threshold || 100,
      sampleRate: options.sampleRate !== undefined ? 
        Math.max(0, Math.min(1, options.sampleRate)) : 1.0 // Clamp between 0 and 1
    };
    
    this.executionTracker = new OptimizedExecutionTracker({
      trackingMode: this.config.trackingMode,
      silent: this.config.silent,
      showMemoryUsage: this.config.trackMemory,
      enableNestedTracking: this.config.enableNestedTracking,
      threshold: this.config.threshold
    });
  }

  /**
   * Track a function execution
   * @param fn The function to track
   * @param options Tracking options
   * @returns Result of the tracked function
   */
  public track<T>(fn: () => T, options: Record<string, any> = {}): T {
    if (typeof fn !== 'function') {
      throw new Error('First argument must be a function');
    }
    
    // Merge global config with function-specific options
    const trackingOptions = {
      label: options.label || fn.name || 'anonymous',
      trackingMode: options.trackingMode || this.config.trackingMode,
      silent: options.hasOwnProperty('silent') ? options.silent : this.config.silent,
      trackMemory: options.hasOwnProperty('trackMemory') ? options.trackMemory : this.config.trackMemory,
      sampleRate: options.hasOwnProperty('sampleRate') ? options.sampleRate : this.config.sampleRate,
      captureArgs: options.hasOwnProperty('captureArgs') ? options.captureArgs : false,
      parentExecutionId: options.parentExecutionId || null,
      thisContext: options.thisContext,
      args: options.args
    };
    
    // Use the tracker to directly track the function
    return this.executionTracker.track(fn, trackingOptions);
  }

  /**
   * Create a trackable version of a function
   * @param fn The function to track
   * @param options Tracking options
   * @returns Tracked version of the function
   */
  public createTrackable<T extends (...args: any[]) => any>(
    fn: T,
    options: Record<string, any> = {}
  ): (...args: Parameters<T>) => ReturnType<T> {
    if (typeof fn !== 'function') {
      throw new Error('First argument must be a function');
    }
    
    // Merge global config with function-specific options
    const trackingOptions = {
      label: options.label || fn.name || 'anonymous',
      trackingMode: options.trackingMode || this.config.trackingMode,
      silent: options.hasOwnProperty('silent') ? options.silent : this.config.silent,
      trackMemory: options.hasOwnProperty('trackMemory') ? options.trackMemory : this.config.trackMemory,
      sampleRate: options.hasOwnProperty('sampleRate') ? options.sampleRate : this.config.sampleRate,
      captureArgs: options.hasOwnProperty('captureArgs') ? options.captureArgs : false,
      parentExecutionId: options.parentExecutionId || null
    };
    
    return this.executionTracker.createTrackable(fn, trackingOptions);
  }

  /**
   * Register a module for tracking
   * @param module The module or object containing methods to track
   * @param options Tracking options
   * @returns Modified module with tracked methods
   */
  public registerModule<T extends Record<string, any>>(module: T, options: Record<string, any> = {}): T {
    if (!module || typeof module !== 'object') {
      throw new Error('Module must be an object');
    }
    
    // Merge global config with module-specific options
    const trackingOptions = {
      prefix: options.prefix || '',
      trackingMode: options.trackingMode || this.config.trackingMode,
      silent: options.hasOwnProperty('silent') ? options.silent : this.config.silent,
      trackMemory: options.hasOwnProperty('trackMemory') ? options.trackMemory : this.config.trackMemory,
      sampleRate: options.hasOwnProperty('sampleRate') ? options.sampleRate : this.config.sampleRate,
      captureArgs: options.hasOwnProperty('captureArgs') ? options.captureArgs : false
    };
    
    return this.executionTracker.trackModule(module, trackingOptions);
  }

  /**
   * Set configuration options
   * @param config Configuration to update
   * @returns Current configuration after update
   */
  public setConfig(config: Partial<PerformanceMonitorOptions> = {}): Record<string, any> {
    // Update trackingMode if specified
    if (config.trackingMode) {
      this.config.trackingMode = config.trackingMode;
      this.executionTracker.trackingMode = config.trackingMode;
    }
    
    // Update silent if specified
    if (config.silent !== undefined) {
      this.config.silent = config.silent;
      this.executionTracker.silent = config.silent;
    }
    
    // Update trackMemory if specified
    if (config.trackMemory !== undefined) {
      this.config.trackMemory = config.trackMemory;
      this.executionTracker.showMemoryUsage = config.trackMemory;
    }
    
    // Update enableNestedTracking if specified
    if (config.enableNestedTracking !== undefined) {
      this.config.enableNestedTracking = config.enableNestedTracking;
      this.executionTracker.enableNestedTracking = config.enableNestedTracking;
    }
    
    // Update threshold if specified
    if (config.threshold !== undefined) {
      this.config.threshold = config.threshold;
      this.executionTracker.defaultThreshold = config.threshold;
    }
    
    // Update sampleRate if specified
    if (config.sampleRate !== undefined) {
      this.config.sampleRate = Math.max(0, Math.min(1, config.sampleRate));
    }
    
    return { ...this.config };
  }

  /**
   * Enable silent mode (no console output)
   * @returns This instance for chaining
   */
  public enableSilentMode(): OptimizedPerformanceMonitor {
    this.config.silent = true;
    this.executionTracker.silent = true;
    return this;
  }

  /**
   * Disable silent mode (allow console output)
   * @returns This instance for chaining
   */
  public disableSilentMode(): OptimizedPerformanceMonitor {
    this.config.silent = false;
    this.executionTracker.silent = false;
    return this;
  }

  /**
   * Set the tracking mode
   * @param mode Tracking mode from TrackingMode enum
   * @returns This instance for chaining
   */
  public setTrackingMode(mode: string): OptimizedPerformanceMonitor {
    this.config.trackingMode = mode;
    this.executionTracker.trackingMode = mode;
    return this;
  }

  /**
   * Enable memory usage tracking
   * @returns This instance for chaining
   */
  public enableMemoryTracking(): OptimizedPerformanceMonitor {
    this.config.trackMemory = true;
    this.executionTracker.showMemoryUsage = true;
    return this;
  }

  /**
   * Disable memory usage tracking
   * @returns This instance for chaining
   */
  public disableMemoryTracking(): OptimizedPerformanceMonitor {
    this.config.trackMemory = false;
    this.executionTracker.showMemoryUsage = false;
    return this;
  }
  
  /**
   * Set the sampling rate
   * @param rate Sampling rate between 0.0 and 1.0
   * @returns This instance for chaining
   */
  public setSampleRate(rate: number): OptimizedPerformanceMonitor {
    this.config.sampleRate = Math.max(0, Math.min(1, rate));
    return this;
  }
  
  /**
   * Reset the tracker state
   * @returns This instance for chaining
   */
  public reset(): OptimizedPerformanceMonitor {
    this.executionTracker.reset();
    return this;
  }
}

// Remove singleton instance to avoid circular dependency - it will be created in index.ts
// export const optimizedTracePerf = new OptimizedPerformanceMonitor(); 
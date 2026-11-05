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

import {
  ExecutionRecord,
  ExecutionStart,
  TracePerfPlugin,
  coveredLength,
  formatTree,
  walkRecords,
} from './records';
import { LabelStats, StatsCollector, StatsOptions, formatStatsTable } from './stats';
import { TraceRecorder, createTraceRecorder } from './exporters';
import { loadNodeBuiltin } from './env';
import type { ModuleTrackOptions, TrackCallOptions, TrackOptions, TracePerfConfig } from '../types/options';

// Define tracking mode constants directly to avoid circular dependency
export const TrackingModes = {
  PERFORMANCE: 'performance',
  BALANCED: 'balanced',
  DETAILED: 'detailed',
  DEBUG: 'debug'
} as const;

// Define default tracking mode separately to avoid circular dependency
const DEFAULT_TRACKING_MODE = TrackingModes.BALANCED;

// v8.getHeapStatistics() reports the same heap figure as
// process.memoryUsage().heapUsed but ~20x faster (it skips measuring RSS).
const v8Module = loadNodeBuiltin('v8');
const readHeapUsed: (() => number) | undefined =
  v8Module && typeof v8Module.getHeapStatistics === 'function'
    ? () => v8Module.getHeapStatistics().used_heap_size
    : undefined;

/**
 * Get current memory usage with environment detection
 * @returns Memory usage in bytes
 */
export const getMemoryUsage = (): number => {
  if (readHeapUsed) {
    return readHeapUsed();
  }
  // Safe check for Node.js process.memoryUsage()
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const mem = process.memoryUsage();
    return mem.heapUsed;
  }
  // Browser memory API if available
  else if (typeof performance !== 'undefined' && 'memory' in performance) {
    return (performance as any).memory?.usedJSHeapSize || 0;
  }
  // Fallback when no memory API available
  return 0;
};

/**
 * Get high-resolution timestamp with environment detection
 * @returns Timestamp in nanoseconds
 */
export const getTimestamp: () => number =
  // Clock chosen once at load time (the hot path should not re-detect it)
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now() * 1000000
    : typeof process !== 'undefined' && typeof process.hrtime === 'function'
      ? () => {
          const hrTime = process.hrtime();
          return hrTime[0] * 1000000000 + hrTime[1];
        }
      : () => Date.now() * 1000000;

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
  sampleRate?: number;
  enabled?: boolean;
  blockingThreshold?: number;
  stats?: boolean | StatsOptions;
  reporter?: (root: ExecutionRecord) => void;
  plugins?: TracePerfPlugin[];
}

/**
 * Interface for timer options
 */
export interface TimerOptions {
  trackMemory?: boolean;
  captureArgs?: boolean;
  args?: any[];
  /** Per-execution overrides; fall back to the tracker's current settings */
  silent?: boolean;
  trackingMode?: string;
  /** Minimum duration in milliseconds for this execution to be reported */
  threshold?: number;
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
  silent?: boolean;
  trackingMode?: string;
  threshold?: number;
  /** Set when the function returned a promise: the end of its synchronous part */
  syncEndTime?: number;
}

// Offset from the monotonic clock (ms) to Unix epoch ms, fixed at load time
const EPOCH_OFFSET_MS = Date.now() - getTimestamp() / 1000000;

const MAX_ARG_LENGTH = 50;

/**
 * Render one captured argument as a short, safe string.
 * Never throws and never walks large structures in full.
 */
export const formatArg = (arg: unknown): string => {
  let text: string;
  try {
    if (typeof arg === 'string') {
      text = JSON.stringify(arg.length > MAX_ARG_LENGTH ? arg.slice(0, MAX_ARG_LENGTH) : arg);
    } else if (typeof arg === 'function') {
      text = `[Function ${arg.name || 'anonymous'}]`;
    } else if (Array.isArray(arg)) {
      text = `Array(${arg.length})`;
    } else if (arg !== null && typeof arg === 'object') {
      const keys = Object.keys(arg);
      if (keys.length <= 5) {
        text = JSON.stringify(arg);
      } else {
        const name = (arg as object).constructor?.name || 'Object';
        text = `${name}{${keys.length} keys}`;
      }
    } else {
      text = String(arg);
    }
  } catch {
    // circular structures, null prototypes, throwing getters/toJSON, ...
    const name = (arg as any)?.constructor?.name;
    text = typeof name === 'string' && name ? `[${name}]` : '[object]';
  }
  return text.length > MAX_ARG_LENGTH ? `${text.slice(0, MAX_ARG_LENGTH - 1)}…` : text;
};

/**
 * Tracks which execution is "current" so nested tracked calls can find
 * their parent. Uses AsyncLocalStorage on Node.js so the parent survives
 * `await`; elsewhere falls back to a synchronous stack (children started
 * after an `await` then become separate roots).
 */
interface ExecutionContext {
  current(): string | null;
  run<R>(executionId: string, fn: () => R): R;
  /** run() for fn.apply(thisArg, args) without allocating a closure per call */
  apply<R>(executionId: string, fn: (...args: any[]) => R, thisArg: unknown, args: ArrayLike<unknown>): R;
}

const loadAsyncLocalStorage = (): (new () => any) | undefined =>
  loadNodeBuiltin('async_hooks')?.AsyncLocalStorage;

const createExecutionContext = (): ExecutionContext => {
  const AsyncLocalStorage = loadAsyncLocalStorage();
  if (AsyncLocalStorage) {
    const storage = new AsyncLocalStorage();
    return {
      current: () => storage.getStore() ?? null,
      run: (executionId, fn) => storage.run(executionId, fn),
      // AsyncLocalStorage.run forwards extra arguments to the callback
      apply: (executionId, fn, thisArg, args) => storage.run(executionId, Reflect.apply, fn, thisArg, args)
    };
  }
  let current: string | null = null;
  const run = <R>(executionId: string, fn: () => R): R => {
    const previous = current;
    current = executionId;
    try {
      return fn();
    } finally {
      current = previous;
    }
  };
  return {
    current: () => current,
    run,
    apply: (executionId, fn, thisArg, args) => run(executionId, () => fn.apply(thisArg, args as unknown[]))
  };
};

/**
 * A manually-ended execution, see `startSpan()` / `monitor.start()`
 */
export interface Span {
  /** Execution id ('' when the span is not recorded: disabled or sampled out) */
  readonly id: string;
  /** Rename the span before it ends (e.g. once a route is known) */
  setLabel(label: string): void;
  /** Run `fn` as part of this span; tracked calls inside become its children */
  run<R>(fn: () => R): R;
  /** Finish the span; pass the error if the work failed. Calling twice is a no-op. */
  end(error?: unknown): void;
}

const NOOP_SPAN: Span = {
  id: '',
  setLabel: () => undefined,
  run: <R>(fn: () => R): R => fn(),
  end: () => undefined
};

const clampRate = (rate: number): number => Math.max(0, Math.min(1, rate));

const isNativePromise = (value: unknown): value is Promise<unknown> =>
  value !== null && typeof value === 'object' &&
  (value instanceof Promise ||
    (typeof (value as any).then === 'function' && Object.prototype.toString.call(value) === '[object Promise]'));

/**
 * Optimized tracker for individual function executions
 */
export class OptimizedExecutionTracker {
  private executionTree: Map<string, ExecutionData> = new Map();
  private currentExecutionId: number = 0;
  private activeExecutions: Map<string, ExecutionData> = new Map();
  private context: ExecutionContext = createExecutionContext();
  
  // Configuration
  public showMemoryUsage: boolean;
  public enableNestedTracking: boolean;
  public silent: boolean;
  public trackingMode: string;
  public defaultThreshold: number;
  public defaultSampleRate: number;
  /** When false, tracked functions just call through (no timing at all) */
  public enabled: boolean;
  /** Sync time (ms) from which detailed output flags event-loop blocking; 0 disables */
  public blockingThreshold: number;
  /** Replaces console output for reported trees (null = default console tree) */
  public reporter: ((root: ExecutionRecord) => void) | null;
  /** Per-label statistics (null when disabled) */
  public stats: StatsCollector | null;
  private plugins: TracePerfPlugin[] = [];
  private wrappers: TracePerfPlugin[] = [];
  private failedPlugins = new Set<TracePerfPlugin>();

  /**
   * Create a new execution tracker
   * @param options Tracker configuration options
   */
  constructor(options: ExecutionTrackerOptions = {}) {
    this.showMemoryUsage = options.showMemoryUsage ?? true;
    this.enableNestedTracking = options.enableNestedTracking ?? true;
    this.silent = options.silent ?? false;
    this.trackingMode = options.trackingMode ?? TrackingModes.BALANCED;
    this.defaultThreshold = options.threshold ?? 0;
    this.defaultSampleRate = clampRate(options.sampleRate ?? 1);
    this.enabled = options.enabled ?? true;
    this.blockingThreshold = options.blockingThreshold ?? 50;
    this.reporter = options.reporter ?? null;
    this.stats = options.stats === false ? null :
      new StatsCollector(typeof options.stats === 'object' ? options.stats : {});
    (options.plugins || []).forEach(plugin => this.use(plugin));
  }

  /**
   * Register a plugin. Returns a function that removes it again.
   */
  public use(plugin: TracePerfPlugin): () => void {
    this.plugins = [...this.plugins, plugin];
    this.wrappers = this.plugins.filter(p => typeof p.wrap === 'function');
    return () => {
      this.plugins = this.plugins.filter(p => p !== plugin);
      this.wrappers = this.plugins.filter(p => typeof p.wrap === 'function');
    };
  }

  /**
   * Run `run` inside every plugin's wrap() (first registered = outermost).
   * A wrap() that throws before calling run is reported once and skipped.
   */
  private _wrap<R>(execution: ExecutionStart, run: () => R): R {
    let next = run;
    for (let i = this.wrappers.length - 1; i >= 0; i--) {
      const plugin = this.wrappers[i];
      const inner = next;
      next = () => {
        let ran = false;
        const once = () => {
          ran = true;
          return inner();
        };
        try {
          return plugin.wrap!(execution, once);
        } catch (error) {
          if (ran) throw error; // the tracked code itself threw
          this._pluginFailed(plugin, 'wrap', error);
          return inner();
        }
      };
    }
    return next();
  }

  private _pluginFailed(plugin: TracePerfPlugin, hook: string, error: unknown): void {
    if (!this.failedPlugins.has(plugin)) {
      this.failedPlugins.add(plugin);
      console.warn(`traceperf: plugin ${plugin.name || '(unnamed)'} threw in ${hook}:`, error);
    }
  }

  private _callPlugins(hook: 'onStart' | 'onComplete', payload: ExecutionStart | ExecutionRecord): void {
    for (const plugin of this.plugins) {
      const fn = plugin[hook] as ((value: any) => void) | undefined;
      if (!fn) continue;
      try {
        fn.call(plugin, payload);
      } catch (error) {
        // Never let a plugin break the tracked code; warn once per plugin
        this._pluginFailed(plugin, hook, error);
      }
    }
  }

  /**
   * Start timing a function execution
   * @param label Function name or label
   * @param parentExecutionId ID of parent execution if nested
   * @param options Additional options
   * @returns Execution ID
   */
  public startTimer(
    label: string,
    parentExecutionId: string | null = null,
    options: TimerOptions = {},
    args: ArrayLike<unknown> | undefined = options.args
  ): string {
    // Per-execution settings, falling back to the tracker's current config
    const trackingMode = options.trackingMode ?? this.trackingMode;
    const trackMemory = options.trackMemory ?? this.showMemoryUsage;
    // Skip detailed tracking in performance mode
    const collectMemory = trackingMode !== TrackingModes.PERFORMANCE && trackMemory;
    
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
      args: options.captureArgs && args ?
        Array.from(args).map(formatArg) : undefined,
      complete: false,
      silent: options.silent ?? this.silent,
      trackingMode,
      threshold: options.threshold ?? this.defaultThreshold
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

    if (this.plugins.length > 0) {
      this._callPlugins('onStart', {
        id: executionId,
        label: execution.label,
        parentId: parentExecutionId,
        startEpochMs: EPOCH_OFFSET_MS + startTime / 1000000
      });
    }

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
    this.activeExecutions.delete(executionId);
    execution.endTime = getTimestamp();
    execution.duration = execution.endTime - execution.startTime;
    execution.result = result;
    execution.error = error;
    execution.complete = true;
    
    // Only collect memory if it was collected at start
    if (execution.memoryAtStart !== undefined) {
      execution.memoryAtEnd = getMemoryUsage();
      execution.memoryDelta = execution.memoryAtEnd - (execution.memoryAtStart || 0);
    }
    
    // A child whose parent is still running is reported as part of the
    // parent's tree once the parent finishes.
    const parentRunning = execution.parentId !== null && this.activeExecutions.has(execution.parentId);
    if (parentRunning) {
      this.executionTree.set(executionId, execution);
      return execution;
    }
    
    // Root (or a child that outlived its parent): build the record tree once
    // and hand it to stats, the console reporter and plugins.
    const record = this._toRecord(execution);

    // Release the finished tree so memory use does not grow with call count
    if (execution.children.length > 0) {
      this._release(execution);
    }

    if (this.stats) {
      this.stats.addTree(record);
    }

    if (!record.silent &&
        record.trackingMode !== TrackingModes.PERFORMANCE &&
        record.duration >= record.threshold) {
      this._report(record);
    }

    if (this.plugins.length > 0) {
      this._callPlugins('onComplete', record);
    }

    return execution;
  }

  /**
   * Drop a finished execution and its finished descendants
   */
  private _release(execution: ExecutionData): void {
    for (const childId of execution.children) {
      const child = this.executionTree.get(childId);
      if (child) {
        this.executionTree.delete(childId);
        this._release(child);
      }
    }
  }

  /**
   * Mark the end of the synchronous part of an execution that returned a promise
   */
  public markSyncEnd(executionId: string): void {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.syncEndTime = getTimestamp();
    }
  }

  /**
   * Convert a finished execution (and its finished children) to a record tree
   */
  private _toRecord(execution: ExecutionData): ExecutionRecord {
    const startTime = execution.startTime / 1000000;
    const endTime = execution.endTime / 1000000;
    const duration = execution.duration / 1000000;
    const children: ExecutionRecord[] = [];
    let covered = 0;
    if (execution.children.length > 0) {
      for (const childId of execution.children) {
        const child = this.executionTree.get(childId);
        if (child) {
          children.push(this._toRecord(child));
        }
      }
      covered = coveredLength(children.map(c => [Math.max(c.startTime, startTime), Math.min(c.endTime, endTime)] as [number, number]));
    }
    const isAsync = execution.syncEndTime !== undefined;
    const record: ExecutionRecord = {
      id: execution.id,
      label: execution.label,
      parentId: execution.parentId,
      startTime,
      endTime,
      startEpochMs: EPOCH_OFFSET_MS + startTime,
      duration,
      selfDuration: Math.max(0, duration - covered),
      syncDuration: isAsync ? (execution.syncEndTime! - execution.startTime) / 1000000 : duration,
      async: isAsync,
      children,
      threshold: execution.threshold ?? 0,
      trackingMode: execution.trackingMode ?? this.trackingMode,
      silent: execution.silent ?? this.silent,
    };
    if (execution.memoryAtStart !== undefined && execution.memoryDelta !== undefined) {
      record.memoryDelta = execution.memoryDelta;
    }
    if (execution.error !== null && execution.error !== undefined) {
      record.error = execution.error;
    }
    if (execution.args && execution.args.length > 0) {
      record.args = execution.args;
    }
    return record;
  }

  /**
   * Print a finished tree (or hand it to the custom reporter)
   */
  private _report(record: ExecutionRecord): void {
    if (this.reporter) {
      this.reporter(record);
      return;
    }
    const detailed = record.trackingMode === TrackingModes.DETAILED || record.trackingMode === TrackingModes.DEBUG;
    console.log(formatTree(record, {
      detailed,
      showErrors: detailed,
      blockingThreshold: this.blockingThreshold
    }));
  }

  /**
   * Run one call of `fn` with tracking (shared by createTrackable and track)
   */
  private _invoke<T extends (...args: any[]) => any>(
    fn: T,
    thisArg: unknown,
    args: Parameters<T>,
    options: Record<string, any>,
    label: string
  ): ReturnType<T> {
    // Disabled: call straight through
    if (!this.enabled) {
      return fn.apply(thisArg, args);
    }

    // Apply sampling - randomly decide whether to track this call
    const sampleRate = options.sampleRate !== undefined ?
      clampRate(options.sampleRate) : this.defaultSampleRate;
    const shouldSample = Math.random() < sampleRate;
    
    // If not sampling this call, just execute the function directly
    if (!shouldSample) {
      return fn.apply(thisArg, args);
    }
    
    const nested = this.enableNestedTracking && options.enableNestedTracking !== false;
    const explicitParentId: string | null = options.parentExecutionId || null;
    const parentExecutionId = explicitParentId ?? (nested ? this.context.current() : null);
    
    // Start tracking the execution
    // The options object already has the TimerOptions fields; pass it as is
    const executionId = this.startTimer(label, parentExecutionId, options as TimerOptions, args);
    
    let result: ReturnType<T>;
    try {
      // Execute the function with the caller's `this`, as the current
      // execution so nested tracked calls attach to it
      if (this.wrappers.length > 0) {
        result = this._wrap({ id: executionId, label, parentId: parentExecutionId }, () => (nested ?
          this.context.apply(executionId, fn, thisArg, args) :
          fn.apply(thisArg, args)));
      } else {
        result = nested ?
          this.context.apply(executionId, fn, thisArg, args) :
          fn.apply(thisArg, args);
      }
    } catch (error) {
      // Handle synchronous errors
      this.endTimer(executionId, undefined, error as Error);
      throw error; // Re-throw to preserve error behavior
    }
    
    // Native promises (incl. async functions): time until settled.
    // Other thenables are returned untouched - calling their then() could
    // trigger side effects (e.g. query builders) or change their type.
    if (isNativePromise(result)) {
      this.markSyncEnd(executionId);
      return result.then(
        (resolvedValue: unknown) => {
          this.endTimer(executionId, resolvedValue);
          return resolvedValue;
        },
        (error: unknown) => {
          this.endTimer(executionId, undefined, error as Error);
          throw error; // Re-throw to preserve error behavior
        }
      ) as ReturnType<T>;
    }
    
    // Handle synchronous functions
    this.endTimer(executionId, result);
    return result;
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
    const silent = options.silent ?? this.silent;
    const trackingMode = options.trackingMode || this.trackingMode;
    
    // Performance optimization - if in performance mode and silent, return original function
    if (trackingMode === TrackingModes.PERFORMANCE && 
        silent && 
        !this.enableNestedTracking) {
      return fn;
    }
    
    const invoke = (thisArg: unknown, args: Parameters<T>): ReturnType<T> =>
      this._invoke(fn, thisArg, args, options, label);

    // A regular function (not an arrow) so callers keep their own `this`
    const trackedFn = function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
      return invoke(this, args);
    };
    
    // Preserve function properties
    Object.defineProperty(trackedFn, 'name', { value: fn.name, configurable: true });
    Object.defineProperty(trackedFn, 'length', { value: fn.length });
    
    return trackedFn as (...args: Parameters<T>) => ReturnType<T>;
  }

  /**
   * Start a manually-ended execution (a "span"). Use `run()` to execute code
   * as part of it, so tracked calls inside attach as children, and `end()`
   * when the work is finished.
   */
  public startSpan(label: string, options: Record<string, any> = {}): Span {
    if (!this.enabled) {
      return NOOP_SPAN;
    }
    const sampleRate = options.sampleRate !== undefined ? clampRate(options.sampleRate) : this.defaultSampleRate;
    if (!(Math.random() < sampleRate)) {
      return NOOP_SPAN;
    }
    const nested = this.enableNestedTracking && options.enableNestedTracking !== false;
    const explicitParentId: string | null = options.parentExecutionId || null;
    const parentExecutionId = explicitParentId ?? (nested ? this.context.current() : null);
    const executionId = this.startTimer(label || 'anonymous', parentExecutionId, {
      trackMemory: options.trackMemory,
      silent: options.silent,
      trackingMode: options.trackingMode,
      threshold: options.threshold
    });
    let ended = false;
    return {
      id: executionId,
      setLabel: (newLabel: string) => {
        const execution = this.activeExecutions.get(executionId);
        if (execution && newLabel) {
          execution.label = newLabel;
        }
      },
      run: <R>(fn: () => R): R => {
        const runInContext = () => (nested ? this.context.run(executionId, fn) : fn());
        const result = this.wrappers.length > 0 ?
          this._wrap({ id: executionId, label: label || 'anonymous', parentId: parentExecutionId }, runInContext) :
          runInContext();
        // The span's synchronous part ends when its first run() returns
        const execution = this.activeExecutions.get(executionId);
        if (execution && execution.syncEndTime === undefined) {
          execution.syncEndTime = getTimestamp();
        }
        return result;
      },
      end: (error?: unknown) => {
        if (ended) return;
        ended = true;
        this.endTimer(executionId, undefined, (error ?? null) as Error | null);
      }
    };
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
        (options.silent ?? this.silent) && 
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
    if (typeof fn !== 'function') {
      throw new Error('First argument must be a function');
    }
    // Same fast path as createTrackable, without building a wrapper per call
    if ((options.trackingMode || this.trackingMode) === TrackingModes.PERFORMANCE &&
        (options.silent ?? this.silent) &&
        !this.enableNestedTracking) {
      return (fn as (...args: unknown[]) => T).apply(options.thisContext, options.args || []);
    }
    const label = options.label || fn.name || 'anonymous';
    return this._invoke(fn as (...args: any[]) => T, options.thisContext, (options.args || []) as [], options, label);
  }

  /**
   * Reset the tracker state
   */
  public reset(): void {
    this.executionTree = new Map();
    this.currentExecutionId = 0;
    this.activeExecutions = new Map();
    if (this.stats) {
      this.stats.reset();
    }
  }
}

/**
 * @deprecated Use `TracePerfConfig`.
 */
export type PerformanceMonitorOptions = TracePerfConfig;

/** Decorator returned by `traced()`: works as a standard or legacy method decorator */
export type TracedDecorator = (target: any, context?: any, descriptor?: PropertyDescriptor) => any;

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
    enabled: boolean;
    blockingThreshold: number;
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
      threshold: options.threshold ?? 0,
      sampleRate: options.sampleRate !== undefined ? clampRate(options.sampleRate) : 1.0,
      enabled: options.enabled ?? true,
      blockingThreshold: options.blockingThreshold ?? 50
    };
    
    this.executionTracker = new OptimizedExecutionTracker({
      trackingMode: this.config.trackingMode,
      silent: this.config.silent,
      showMemoryUsage: this.config.trackMemory,
      enableNestedTracking: this.config.enableNestedTracking,
      threshold: this.config.threshold,
      sampleRate: this.config.sampleRate,
      enabled: this.config.enabled,
      blockingThreshold: this.config.blockingThreshold,
      stats: options.stats,
      reporter: options.reporter,
      plugins: options.plugins
    });
    
    if (options.onComplete) {
      this.onComplete(options.onComplete);
    }
  }

  /**
   * Track a function execution
   * @param fn The function to track
   * @param options Tracking options
   * @returns Result of the tracked function
   */
  public track<T>(fn: () => T, options: TrackCallOptions = {}): T {
    if (typeof fn !== 'function') {
      throw new Error('First argument must be a function');
    }
    
    // Only per-call options are passed down; anything left out falls back to
    // this instance's *current* configuration when the call runs.
    return this.executionTracker.track(fn, options);
  }

  /**
   * Create a trackable version of a function
   * @param fn The function to track
   * @param options Tracking options
   * @returns Tracked version of the function
   */
  public createTrackable<T extends (...args: any[]) => any>(
    fn: T,
    options: TrackOptions = {}
  ): (...args: Parameters<T>) => ReturnType<T> {
    if (typeof fn !== 'function') {
      throw new Error('First argument must be a function');
    }
    
    return this.executionTracker.createTrackable(fn, options);
  }

  /**
   * Register a module for tracking
   * @param module The module or object containing methods to track
   * @param options Tracking options
   * @returns Modified module with tracked methods
   */
  public registerModule<T extends Record<string, any>>(module: T, options: ModuleTrackOptions = {}): T {
    if (!module || typeof module !== 'object') {
      throw new Error('Module must be an object');
    }
    
    return this.executionTracker.trackModule(module, options);
  }

  /**
   * Track every method of an object or class instance, including methods
   * inherited from its prototype, without copying it. Returns a proxy:
   * state changes go to the original object, and methods run with the
   * original object as `this` (so private #fields keep working).
   */
  public trackObject<T extends object>(target: T, options: ModuleTrackOptions = {}): T {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
      throw new Error('trackObject expects an object');
    }
    const ctorName = (target as any).constructor && (target as any).constructor !== Object
      ? (target as any).constructor.name : '';
    const prefix = options.prefix ?? (ctorName ? `${ctorName}.` : '');
    const trackOptions: TrackOptions = { ...options };
    delete (trackOptions as ModuleTrackOptions).prefix;
    const cache = new Map<PropertyKey, { original: Function; tracked: Function }>();
    const wrap = (original: Function, key: string, proxy: unknown): Function => {
      const tracked = this.createTrackable(original as (...args: any[]) => any, {
        ...trackOptions,
        label: trackOptions.label ?? `${prefix}${key}`
      });
      return function (this: unknown, ...args: unknown[]) {
        return tracked.apply(this === proxy ? target : this, args);
      };
    };
    const proxy: T = new Proxy(target, {
      get: (obj, key, receiver) => {
        const value = Reflect.get(obj, key, receiver);
        if (typeof value !== 'function' || typeof key === 'symbol' || key === 'constructor' ||
            (Object.prototype as any)[key] === value) {
          return value;
        }
        const hit = cache.get(key);
        if (hit && hit.original === value) {
          return hit.tracked;
        }
        const tracked = wrap(value, key, proxy);
        cache.set(key, { original: value, tracked });
        return tracked;
      }
    });
    return proxy;
  }

  /**
   * Method decorator. Works with TypeScript 5 / TC39 standard decorators and
   * with legacy `experimentalDecorators`. The label defaults to
   * "ClassName.method".
   *
   *   class UserService {
   *     @tp.traced()
   *     async getUser(id: string) { ... }
   *   }
   */
  public traced(options: TrackOptions = {}): TracedDecorator {
    const trackables = new Map<string, Function>();
    const trackedFor = (fn: Function, label: string): Function => {
      let tracked = trackables.get(label);
      if (!tracked) {
        tracked = this.createTrackable(fn as (...args: any[]) => any, { ...options, label });
        trackables.set(label, tracked);
      }
      return tracked;
    };
    const ownerName = (receiver: any): string =>
      typeof receiver === 'function' ? receiver.name : receiver?.constructor?.name || 'anonymous';
    const wrapMethod = (fn: Function, methodName: string): Function => {
      const wrapped = function (this: unknown, ...args: unknown[]) {
        const label = options.label ?? `${ownerName(this)}.${methodName}`;
        return trackedFor(fn, label).apply(this, args);
      };
      Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true });
      Object.defineProperty(wrapped, 'length', { value: fn.length, configurable: true });
      return wrapped;
    };
    return (target: any, context?: any, descriptor?: PropertyDescriptor): any => {
      // Standard decorators: (method, context)
      if (typeof target === 'function' && context && typeof context === 'object' && 'kind' in context) {
        if (context.kind !== 'method') {
          throw new TypeError('@traced can only decorate methods');
        }
        return wrapMethod(target, String(context.name));
      }
      // Legacy decorators: (prototype or constructor, key, descriptor)
      if (descriptor && typeof descriptor.value === 'function') {
        descriptor.value = wrapMethod(descriptor.value, String(context));
        return descriptor;
      }
      throw new TypeError('@traced can only decorate methods');
    };
  }

  /**
   * Start a manually-ended execution (a span), e.g. for a request:
   *
   *   const span = tp.start('GET /users');
   *   span.run(() => next());      // tracked calls inside become children
   *   res.on('finish', () => span.end());
   */
  public start(label: string, options: TrackOptions = {}): Span {
    return this.executionTracker.startSpan(label, options);
  }

  /**
   * Register a plugin (exporter, custom sink). Returns an unsubscribe function.
   */
  public use(plugin: TracePerfPlugin): () => void {
    return this.executionTracker.use(plugin);
  }

  /**
   * Call `listener` with every finished top-level execution tree (even when
   * silent or below threshold). Returns an unsubscribe function.
   */
  public onComplete(listener: (root: ExecutionRecord) => void): () => void {
    return this.use({ name: 'onComplete', onComplete: listener });
  }

  /**
   * Call `listener` for every finished call (nested ones included) that
   * took at least `threshold` ms. Pass a number, or per-label thresholds
   * with an optional '*' default:
   *
   *   tp.onSlow(200, (call, root) => logger.warn(`${call.label} took ${call.duration}ms in ${root.label}`));
   *   tp.onSlow({ 'db.query': 50, 'GET /search': 500, '*': 1000 }, alert);
   *
   * Works in every tracking mode and when silent. Returns an unsubscribe function.
   */
  public onSlow(
    threshold: number | Record<string, number>,
    listener: (call: ExecutionRecord, root: ExecutionRecord) => void
  ): () => void {
    const limitFor = typeof threshold === 'number'
      ? () => threshold
      : (label: string) => (label in threshold ? threshold[label] : threshold['*']);
    return this.use({
      name: 'onSlow',
      onComplete: root => {
        walkRecords(root, record => {
          const limit = limitFor(record.label);
          if (limit !== undefined && record.duration >= limit) listener(record, root);
        });
      }
    });
  }

  /**
   * Per-label statistics (ms): count, errors, total, mean, min, max,
   * p50/p95/p99 and mean self time.
   */
  public getStats(): Record<string, LabelStats>;
  public getStats(label: string): LabelStats | undefined;
  public getStats(label?: string): Record<string, LabelStats> | LabelStats | undefined {
    const stats = this.executionTracker.stats;
    if (label !== undefined) {
      return stats ? stats.get(label) : undefined;
    }
    return stats ? stats.all() : {};
  }

  /** Clear collected statistics */
  public resetStats(): OptimizedPerformanceMonitor {
    if (this.executionTracker.stats) {
      this.executionTracker.stats.reset();
    }
    return this;
  }

  /** Statistics as a text table, slowest total first */
  public formatStats(): string {
    return formatStatsTable(this.getStats());
  }

  /** Print the statistics table to the console */
  public printStats(): OptimizedPerformanceMonitor {
    console.log(this.formatStats());
    return this;
  }

  /**
   * Start recording finished calls for a Chrome/Perfetto trace.
   *
   *   const recording = tp.startTrace();
   *   await work();
   *   fs.writeFileSync('trace.json', JSON.stringify(recording.stop()));
   *
   * Open the file in https://ui.perfetto.dev or chrome://tracing.
   */
  public startTrace(options: { maxRoots?: number } = {}): TraceRecorder {
    let unsubscribe: () => void = () => undefined;
    const recorder = createTraceRecorder({ maxRoots: options.maxRoots, onStop: () => unsubscribe() });
    unsubscribe = this.use(recorder);
    return recorder;
  }

  /** Turn tracking on */
  public enable(): OptimizedPerformanceMonitor {
    this.config.enabled = true;
    this.executionTracker.enabled = true;
    return this;
  }

  /** Turn tracking off: tracked functions become plain pass-through calls */
  public disable(): OptimizedPerformanceMonitor {
    this.config.enabled = false;
    this.executionTracker.enabled = false;
    return this;
  }

  /** Whether tracking is on */
  public isEnabled(): boolean {
    return this.config.enabled;
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
      this.config.sampleRate = clampRate(config.sampleRate);
      this.executionTracker.defaultSampleRate = this.config.sampleRate;
    }
    
    if (config.enabled !== undefined) {
      this.config.enabled = config.enabled;
      this.executionTracker.enabled = config.enabled;
    }
    
    if (config.blockingThreshold !== undefined) {
      this.config.blockingThreshold = config.blockingThreshold;
      this.executionTracker.blockingThreshold = config.blockingThreshold;
    }
    
    if (config.reporter !== undefined) {
      this.executionTracker.reporter = config.reporter;
    }
    
    if (config.plugins) {
      config.plugins.forEach(plugin => this.use(plugin));
    }
    
    if (config.onComplete) {
      this.onComplete(config.onComplete);
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
   * Get the current tracking mode
   */
  public getTrackingMode(): string {
    return this.config.trackingMode;
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
    this.config.sampleRate = clampRate(rate);
    this.executionTracker.defaultSampleRate = this.config.sampleRate;
    return this;
  }
  
  /**
   * Reset the tracker state (in-flight executions and statistics)
   * @returns This instance for chaining
   */
  public reset(): OptimizedPerformanceMonitor {
    this.executionTracker.reset();
    return this;
  }
}

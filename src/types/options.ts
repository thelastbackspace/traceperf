import type { ExecutionRecord, TracePerfPlugin, TrackingModeName } from '../core/records';
import type { StatsOptions } from '../core/stats';

/**
 * Options for a single tracked function or call. Anything left out falls
 * back to the instance configuration at the time of the call.
 */
export interface TrackOptions {
  /** Label shown in output and stats (default: the function name) */
  label?: string;
  /** Tracking mode for this call */
  trackingMode?: TrackingModeName;
  /** Suppress console output for this call */
  silent?: boolean;
  /** Record the heap change for this call */
  trackMemory?: boolean;
  /** Only report this call if it takes at least this many milliseconds */
  threshold?: number;
  /** Fraction of calls to track (0.0 - 1.0) */
  sampleRate?: number;
  /** Include a short rendering of the arguments in output and records */
  captureArgs?: boolean;
  /** Attach tracked calls made inside this one as children (default true) */
  enableNestedTracking?: boolean;
  /** Attach this call to a specific parent execution */
  parentExecutionId?: string | null;
}

/** Options for `track(fn, options)` */
export interface TrackCallOptions extends TrackOptions {
  /** `this` for the tracked function */
  thisContext?: unknown;
  /** Arguments passed to the tracked function */
  args?: unknown[];
}

/** Options for `registerModule` / `trackObject` */
export interface ModuleTrackOptions extends TrackOptions {
  /** Prefix for each method label, e.g. "userService." */
  prefix?: string;
}

/** Configuration for `createTracePerf()` / `new OptimizedPerformanceMonitor()` */
export interface TracePerfConfig {
  /** Detail level (default "balanced") */
  trackingMode?: TrackingModeName;
  /** Suppress console output (stats, hooks and exporters still run) */
  silent?: boolean;
  /** Record heap change per call (default true) */
  trackMemory?: boolean;
  /** Attach nested tracked calls to their caller (default true) */
  enableNestedTracking?: boolean;
  /** Only report calls taking at least this many milliseconds (default 0) */
  threshold?: number;
  /** Fraction of calls to track (default 1) */
  sampleRate?: number;
  /** Set to false to make every tracked function a plain pass-through */
  enabled?: boolean;
  /** Detailed mode flags calls whose synchronous part runs at least this long (ms, default 50; 0 disables) */
  blockingThreshold?: number;
  /** Collect per-label statistics (default true) */
  stats?: boolean | StatsOptions;
  /** Replace console output: called with each reported top-level tree */
  reporter?: (root: ExecutionRecord) => void;
  /** Plugins/exporters to register */
  plugins?: TracePerfPlugin[];
  /** Called with every finished top-level tree (also when silent) */
  onComplete?: (root: ExecutionRecord) => void;
}

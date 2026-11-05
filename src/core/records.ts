/**
 * Finished-execution records: the single data shape that console output,
 * statistics, hooks and exporters all consume.
 */

/** Tracking mode names */
export type TrackingModeName = 'performance' | 'balanced' | 'detailed' | 'debug';

/**
 * One finished tracked call. Times are in milliseconds on the same
 * monotonic clock as `performance.now()`; `startEpochMs` is wall-clock.
 */
export interface ExecutionRecord {
  /** Unique id within the tracker */
  id: string;
  /** Label given to the call (or the function name) */
  label: string;
  /** Id of the parent execution, or null for a top-level call */
  parentId: string | null;
  /** Start time (ms, monotonic) */
  startTime: number;
  /** End time (ms, monotonic) */
  endTime: number;
  /** Start time as a Unix epoch timestamp in ms */
  startEpochMs: number;
  /** Total wall time in ms */
  duration: number;
  /** Time not covered by tracked children, in ms */
  selfDuration: number;
  /**
   * Time spent synchronously before the call returned, in ms. For a sync
   * function this equals `duration`; for an async function it is the part
   * that ran before the first `await` (and blocked the event loop).
   */
  syncDuration: number;
  /** Whether the call returned a promise */
  async: boolean;
  /** Heap change in bytes, when memory tracking was on. Negative means GC freed memory. */
  memoryDelta?: number;
  /** The thrown or rejected value, if the call failed */
  error?: unknown;
  /** Rendered arguments, when `captureArgs` was on */
  args?: string[];
  /** Tracked calls made from inside this one, in start order */
  children: ExecutionRecord[];
  /** Report threshold (ms) that applied to this call */
  threshold: number;
  /** Tracking mode that applied to this call */
  trackingMode: string;
  /** Whether console output was suppressed for this call */
  silent: boolean;
}

/**
 * Length of the union of [start, end] intervals (handles overlapping
 * concurrent children, e.g. Promise.all).
 */
export function coveredLength(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0;
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i];
    if (start > curEnd) {
      total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    } else if (end > curEnd) {
      curEnd = end;
    }
  }
  return total + (curEnd - curStart);
}

/** Visit every record in a tree, parents before children */
export function walkRecords(root: ExecutionRecord, visit: (record: ExecutionRecord, depth: number) => void, depth = 0): void {
  visit(root, depth);
  for (const child of root.children) {
    walkRecords(child, visit, depth + 1);
  }
}

/** Options for formatTree */
export interface FormatTreeOptions {
  /** Show self/sync time and event-loop blocking (detailed/debug modes) */
  detailed?: boolean;
  /** Show the error message of failed calls */
  showErrors?: boolean;
  /** Sync time (ms) from which a call is flagged as blocking the event loop */
  blockingThreshold?: number;
}

const formatMs = (ms: number): string => `${ms.toFixed(3)} ms`;

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatLine(record: ExecutionRecord, options: FormatTreeOptions): string {
  const args = record.args && record.args.length > 0 ? `(${record.args.join(', ')})` : '';
  let line = `${record.label}${args}: ${formatMs(record.duration)}`;

  if (options.detailed) {
    const extra: string[] = [];
    if (record.children.length > 0) extra.push(`self ${formatMs(record.selfDuration)}`);
    if (record.async) extra.push(`sync ${formatMs(record.syncDuration)}`);
    if (extra.length > 0) line += ` (${extra.join(', ')})`;
  }

  if (record.memoryDelta !== undefined) {
    const kb = (record.memoryDelta / 1024).toFixed(2);
    line += ` 📊 ${record.memoryDelta >= 0 ? '+' : ''}${kb} KB`;
    if (record.memoryDelta < 0) line += ' (gc)';
  }

  if (options.detailed && options.blockingThreshold !== undefined &&
      options.blockingThreshold > 0 && record.syncDuration >= options.blockingThreshold) {
    line += ` ⚠ blocked event loop ${formatMs(record.syncDuration)}`;
  }

  if (options.showErrors && record.error !== undefined && record.error !== null) {
    line += ` ✖ ${formatError(record.error)}`;
  }
  return line;
}

/**
 * Render an execution tree the way traceperf prints it to the console.
 * Children below their threshold are left out.
 */
export function formatTree(root: ExecutionRecord, options: FormatTreeOptions = {}): string {
  const lines: string[] = [];
  const visit = (record: ExecutionRecord, ancestors: boolean[], isLast: boolean) => {
    // One column per ancestor: a connector while that ancestor has more siblings below
    const prefix = ancestors.map(hasMoreSiblings => (hasMoreSiblings ? '│ ' : '  ')).join('');
    lines.push(`${prefix}${isLast ? '└─ ' : '├─ '}${formatLine(record, options)}`);
    const shown = record.children.filter(child => child.duration >= child.threshold);
    shown.forEach((child, i) => visit(child, [...ancestors, !isLast], i === shown.length - 1));
  };
  visit(root, [], true);
  return lines.join('\n');
}

/** What a plugin sees when a tracked call starts */
export interface ExecutionStart {
  id: string;
  label: string;
  parentId: string | null;
  /** Start time as a Unix epoch timestamp in ms (set for onStart) */
  startEpochMs?: number;
}

/**
 * Extension point for exporters and custom sinks. Hooks run synchronously;
 * errors thrown by a plugin are caught and reported once, never propagated
 * into the tracked code.
 */
export interface TracePerfPlugin {
  /** Optional name used in error messages */
  name?: string;
  /** A tracked call started (runs inside the caller's async context) */
  onStart?(execution: ExecutionStart): void;
  /** A top-level call finished; `root` holds the whole tree */
  onComplete?(root: ExecutionRecord): void;
  /**
   * Run the tracked code inside something (e.g. an active OpenTelemetry
   * span). Must call `run` exactly once and return its result.
   */
  wrap?<R>(execution: ExecutionStart, run: () => R): R;
}

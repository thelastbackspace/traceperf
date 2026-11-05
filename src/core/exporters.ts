/**
 * Exporters: get traceperf data out of the process.
 *
 * - Chrome Trace Event / Perfetto JSON (open in chrome://tracing,
 *   https://ui.perfetto.dev or the DevTools Performance panel)
 * - OpenTelemetry spans (bring your own @opentelemetry/api)
 * - JSON lines
 */
import { ExecutionRecord, TracePerfPlugin, walkRecords } from './records';

/** A single Trace Event Format "complete" event */
export interface ChromeTraceEvent {
  name: string;
  cat: string;
  ph: 'X' | 'M';
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
}

/** Trace Event Format document */
export interface ChromeTrace {
  traceEvents: ChromeTraceEvent[];
  displayTimeUnit: 'ms';
}

/**
 * Convert finished execution trees to Trace Event Format.
 *
 * Complete ("X") events must nest strictly within a thread, so calls that
 * overlap without nesting (concurrent async work) are placed on extra lanes.
 */
export function toChromeTrace(roots: ExecutionRecord[]): ChromeTrace {
  const events: ChromeTraceEvent[] = [];
  // For each lane, the stack of end times of open events
  const lanes: number[][] = [];

  const fits = (lane: number[], start: number, end: number): boolean => {
    while (lane.length > 0 && lane[lane.length - 1] <= start) lane.pop();
    return lane.length === 0 || end <= lane[lane.length - 1];
  };

  const place = (record: ExecutionRecord, preferred: number): number => {
    const candidates = [preferred, ...lanes.map((_, i) => i).filter(i => i !== preferred)];
    for (const i of candidates) {
      if (lanes[i] && fits(lanes[i], record.startTime, record.endTime)) {
        lanes[i].push(record.endTime);
        return i;
      }
    }
    lanes.push([record.endTime]);
    return lanes.length - 1;
  };

  const all: Array<{ record: ExecutionRecord; parentLane: number }> = [];
  const sortedRoots = roots.slice().sort((a, b) => a.startTime - b.startTime);
  const visit = (record: ExecutionRecord, parentLane: number) => {
    all.push({ record, parentLane });
  };
  sortedRoots.forEach(root => walkRecords(root, r => visit(r, 0)));
  // Events must be placed in start order (parents before children on ties)
  all.sort((a, b) => a.record.startTime - b.record.startTime || b.record.duration - a.record.duration);

  const laneOf = new Map<string, number>();
  for (const { record } of all) {
    const preferred = record.parentId !== null && laneOf.has(record.parentId) ? laneOf.get(record.parentId)! : 0;
    const lane = place(record, preferred);
    laneOf.set(record.id, lane);
    const args: Record<string, unknown> = { selfMs: record.selfDuration, syncMs: record.syncDuration };
    if (record.memoryDelta !== undefined) args.memoryDeltaBytes = record.memoryDelta;
    if (record.args && record.args.length) args.args = record.args;
    if (record.error !== undefined && record.error !== null) {
      args.error = record.error instanceof Error ? record.error.message : String(record.error);
    }
    events.push({
      name: record.label,
      cat: 'traceperf',
      ph: 'X',
      ts: Math.round(record.startTime * 1000),
      dur: Math.max(0, Math.round(record.duration * 1000)),
      pid: 1,
      tid: lane + 1,
      args,
    });
  }

  const meta: ChromeTraceEvent[] = [
    { name: 'process_name', cat: '__metadata', ph: 'M', ts: 0, pid: 1, tid: 0, args: { name: 'traceperf' } },
    ...lanes.map((_, i) => ({
      name: 'thread_name', cat: '__metadata', ph: 'M' as const, ts: 0, pid: 1, tid: i + 1,
      args: { name: i === 0 ? 'main' : `concurrent ${i}` },
    })),
  ];
  return { traceEvents: [...meta, ...events], displayTimeUnit: 'ms' };
}

/** Collects finished trees in memory; `stop()` returns a Chrome trace */
export interface TraceRecorder extends TracePerfPlugin {
  /** Trees recorded so far */
  readonly roots: ExecutionRecord[];
  /** Stop recording and return the trace (also unsubscribes, when attached via startTrace) */
  stop(): ChromeTrace;
}

/**
 * Create a plugin that records finished trees for a Chrome/Perfetto trace.
 * Keeps at most `maxRoots` top-level calls (oldest dropped first).
 */
export function createTraceRecorder(options: { maxRoots?: number; onStop?: () => void } = {}): TraceRecorder {
  const maxRoots = Math.max(1, options.maxRoots ?? 10000);
  const roots: ExecutionRecord[] = [];
  let stopped = false;
  return {
    name: 'chrome-trace',
    roots,
    onComplete(root) {
      if (stopped) return;
      roots.push(root);
      if (roots.length > maxRoots) roots.shift();
    },
    stop() {
      if (!stopped) {
        stopped = true;
        if (options.onStop) options.onStop();
      }
      return toChromeTrace(roots);
    },
  };
}

/**
 * Minimal structural types for the parts of @opentelemetry/api used here,
 * so traceperf needs no dependency on it.
 */
export interface OtelSpanLike {
  setAttribute(key: string, value: string | number | boolean): unknown;
  recordException(exception: unknown): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
  end(endTime?: number): unknown;
  updateName?(name: string): unknown;
}
export interface OtelTracerLike {
  startSpan(name: string, options?: { startTime?: number }, context?: unknown): OtelSpanLike;
}
export interface OtelApiLike {
  trace: {
    getTracer(name: string, version?: string): OtelTracerLike;
    setSpan(context: unknown, span: OtelSpanLike): unknown;
  };
  context: {
    active(): unknown;
    /** Needed for live mode */
    with?<R>(context: unknown, fn: () => R): R;
  };
}

/** OpenTelemetry status code for errors (SpanStatusCode.ERROR) */
const OTEL_STATUS_ERROR = 2;

export interface OpenTelemetryExporterOptions {
  /** Tracer name (default "traceperf") */
  tracerName?: string;
  /** Use this tracer instead of api.trace.getTracer() */
  tracer?: OtelTracerLike;
  /**
   * Live mode: open each span when the call starts and make it the active
   * OpenTelemetry context while the call runs, so spans created by other
   * instrumentation (HTTP clients, database drivers) nest under it.
   * Requires a context manager to be registered (as any OTel SDK setup does).
   */
  live?: boolean;
}

function decorateSpan(span: OtelSpanLike, record: ExecutionRecord): void {
  span.setAttribute('traceperf.self_ms', record.selfDuration);
  span.setAttribute('traceperf.sync_ms', record.syncDuration);
  span.setAttribute('traceperf.async', record.async);
  if (record.memoryDelta !== undefined) span.setAttribute('traceperf.memory_delta_bytes', record.memoryDelta);
  if (record.args && record.args.length) span.setAttribute('traceperf.args', record.args.join(', '));
  if (record.error !== undefined && record.error !== null) {
    span.recordException(record.error);
    span.setStatus({
      code: OTEL_STATUS_ERROR,
      message: record.error instanceof Error ? record.error.message : String(record.error),
    });
  }
}

/**
 * Export tracked calls as OpenTelemetry spans.
 *
 *   import * as otel from '@opentelemetry/api';
 *   tp.use(openTelemetryExporter(otel));                 // spans created when the tree finishes
 *   tp.use(openTelemetryExporter(otel, { live: true })); // spans active while the call runs
 *
 * Default mode creates spans when the top-level call finishes, with the
 * real start/end times, parented to the OpenTelemetry context that was
 * active when the call started. Live mode opens each span when the call
 * starts and makes it the active context, so other instrumentation's spans
 * become its children.
 */
export function openTelemetryExporter(api: OtelApiLike, options: OpenTelemetryExporterOptions = {}): TracePerfPlugin {
  const tracer = options.tracer ?? api.trace.getTracer(options.tracerName ?? 'traceperf');

  if (options.live) {
    if (typeof api.context.with !== 'function') {
      throw new Error('openTelemetryExporter: live mode needs api.context.with (pass @opentelemetry/api)');
    }
    const spans = new Map<string, OtelSpanLike>();
    return {
      name: 'opentelemetry-live',
      onStart(execution) {
        // Inside a tracked parent, wrap() has made the parent span active
        spans.set(execution.id, tracer.startSpan(execution.label, { startTime: execution.startEpochMs }, api.context.active()));
      },
      wrap(execution, run) {
        const span = spans.get(execution.id);
        if (!span) return run();
        return api.context.with!(api.trace.setSpan(api.context.active(), span), run);
      },
      onComplete(root) {
        walkRecords(root, record => {
          const span = spans.get(record.id);
          if (!span) return;
          spans.delete(record.id);
          if (span.updateName) span.updateName(record.label);
          decorateSpan(span, record);
          span.end(record.startEpochMs + record.duration);
        });
      },
    };
  }

  const startContexts = new Map<string, unknown>();
  return {
    name: 'opentelemetry',
    onStart(execution) {
      if (execution.parentId === null) startContexts.set(execution.id, api.context.active());
    },
    onComplete(root) {
      const parentContext = startContexts.get(root.id) ?? api.context.active();
      startContexts.delete(root.id);
      const emit = (record: ExecutionRecord, ctx: unknown) => {
        const span = tracer.startSpan(record.label, { startTime: record.startEpochMs }, ctx);
        decorateSpan(span, record);
        const childCtx = api.trace.setSpan(ctx, span);
        record.children.forEach(child => emit(child, childCtx));
        span.end(record.startEpochMs + record.duration);
      };
      emit(root, parentContext);
    },
  };
}

/** JSON-serialisable view of a record (errors become messages) */
export function recordToJSON(record: ExecutionRecord): Record<string, unknown> {
  return {
    label: record.label,
    start: new Date(record.startEpochMs).toISOString(),
    durationMs: record.duration,
    selfMs: record.selfDuration,
    syncMs: record.syncDuration,
    async: record.async,
    ...(record.memoryDelta !== undefined ? { memoryDeltaBytes: record.memoryDelta } : {}),
    ...(record.args && record.args.length ? { args: record.args } : {}),
    ...(record.error !== undefined && record.error !== null
      ? { error: record.error instanceof Error ? record.error.message : String(record.error) }
      : {}),
    children: record.children.map(recordToJSON),
  };
}

/**
 * Write one JSON line per finished top-level call (the whole tree).
 * Defaults to stdout in Node and console.log elsewhere.
 */
export function jsonLinesExporter(write?: (line: string) => void): TracePerfPlugin {
  const out = write ?? ((line: string) => {
    const proc: any = typeof process !== 'undefined' ? process : undefined;
    if (proc && proc.stdout && typeof proc.stdout.write === 'function') proc.stdout.write(line + '\n');
    else console.log(line);
  });
  return {
    name: 'json-lines',
    onComplete(root) {
      out(JSON.stringify(recordToJSON(root)));
    },
  };
}

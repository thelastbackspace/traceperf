#!/usr/bin/env node
/**
 * traceperf CLI
 *
 *   traceperf report <file> [--top N] [--sort total|mean|p95|max|count] [--json] [--html out.html]
 *
 * <file> is a Chrome/Perfetto trace written from startTrace().stop(), or a
 * JSON-lines file written by jsonLinesExporter(). Prints per-label
 * statistics and the slowest individual calls.
 */
import { ExecutionRecord } from './core/records';
import { LabelStats, StatsCollector, formatStatsTable } from './core/stats';
import { renderHtmlReport } from './report-html';

export interface ReportOptions {
  top?: number;
  /** Return a self-contained HTML report instead of text */
  html?: boolean;
  title?: string;
  sort?: 'total' | 'mean' | 'p95' | 'max' | 'count';
  json?: boolean;
}

export interface Call {
  label: string;
  path: string;
  duration: number;
  selfDuration: number;
  error?: string;
  /** Start time in ms (trace clock or epoch, consistent within one input) */
  start: number;
  /** Nesting depth within its tree (0 = top level) */
  depth: number;
  /** Lane / thread the call ran on (concurrent work gets separate lanes) */
  lane: number;
}

function record(label: string, duration: number, selfDuration: number, error?: string): ExecutionRecord {
  return {
    id: '', label, parentId: null, startTime: 0, endTime: duration, startEpochMs: 0, duration,
    selfDuration, syncDuration: duration, async: false, children: [], threshold: 0,
    trackingMode: 'balanced', silent: true, ...(error ? { error: new Error(error) } : {}),
  };
}

/** Parse a Chrome trace or JSON-lines document into flat calls */
export function parseCalls(text: string): Call[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const calls: Call[] = [];

  if (trimmed.startsWith('{') && /"traceEvents"\s*:/.test(trimmed.slice(0, 200))) {
    const trace = JSON.parse(trimmed);
    // Rebuild parent paths from nesting within each lane
    const byTid = new Map<number, any[]>();
    for (const e of trace.traceEvents || []) {
      if (e.ph !== 'X') continue;
      byTid.set(e.tid, [...(byTid.get(e.tid) || []), e]);
    }
    byTid.forEach(events => {
      events.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
      const stack: Array<{ end: number; name: string }> = [];
      for (const e of events) {
        while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
        const path = [...stack.map(s => s.name), e.name].join(' > ');
        const args = e.args || {};
        calls.push({
          label: e.name,
          path,
          duration: (e.dur || 0) / 1000,
          selfDuration: typeof args.selfMs === 'number' ? args.selfMs : (e.dur || 0) / 1000,
          error: typeof args.error === 'string' ? args.error : undefined,
          start: e.ts / 1000,
          depth: stack.length,
          lane: e.tid,
        });
        stack.push({ end: e.ts + (e.dur || 0), name: e.name });
      }
    });
    return calls;
  }

  // JSON lines: one tree per line (recordToJSON format)
  // Top-level trees that overlap in time go on separate lanes
  const laneEnds: number[] = [];
  const visit = (node: any, parents: string[], lane: number) => {
    const path = [...parents, node.label].join(' > ');
    const start = typeof node.start === 'string' ? Date.parse(node.start) : 0;
    calls.push({
      label: node.label,
      path,
      duration: node.durationMs,
      selfDuration: typeof node.selfMs === 'number' ? node.selfMs : node.durationMs,
      error: node.error,
      start,
      depth: parents.length,
      lane,
    });
    (node.children || []).forEach((child: any) => visit(child, [...parents, node.label], lane));
  };
  const pickLane = (start: number, end: number): number => {
    let lane = laneEnds.findIndex(laneEnd => laneEnd <= start);
    if (lane === -1) {
      laneEnds.push(end);
      lane = laneEnds.length - 1;
    } else {
      laneEnds[lane] = end;
    }
    return lane + 1;
  };
  trimmed.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let node: any;
    try {
      node = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1} is not JSON (expected a Chrome trace or JSON lines)`);
    }
    if (typeof node.label !== 'string' || typeof node.durationMs !== 'number') {
      throw new Error(`line ${i + 1} is not a traceperf record`);
    }
    const start = typeof node.start === 'string' ? Date.parse(node.start) : 0;
    visit(node, [], pickLane(start, start + node.durationMs));
  });
  return calls;
}

/** Build the report text (or JSON) from a trace / JSON-lines document */
export function report(text: string, options: ReportOptions = {}): string {
  const calls = parseCalls(text);
  const collector = new StatsCollector({ reservoirSize: 100000, maxLabels: 100000 });
  calls.forEach(c => collector.add(record(c.label, c.duration, c.selfDuration, c.error)));
  const stats = collector.all();
  const sortKey = options.sort ?? 'total';
  const top = Math.max(0, options.top ?? 10);
  const slowest = calls.slice().sort((a, b) => b.duration - a.duration).slice(0, top);

  if (options.html) {
    return renderHtmlReport(calls, stats, { title: options.title, top: options.top ?? 20 });
  }
  if (options.json) {
    return JSON.stringify({ calls: calls.length, stats, slowest }, null, 2);
  }
  if (calls.length === 0) return 'traceperf: no calls in input';

  const sorted: Record<string, LabelStats> = {};
  Object.keys(stats)
    .sort((a, b) => (stats[b][sortKey] as number) - (stats[a][sortKey] as number))
    .forEach(label => { sorted[label] = stats[label]; });
  const table = formatStatsTable(sorted).split('\n');
  // formatStatsTable sorts by total; re-apply the requested order to the body
  const [head, rule, ...body] = table;
  const order = Object.keys(sorted);
  body.sort((a, b) => order.indexOf(a.split(/\s{2,}/)[0].trim()) - order.indexOf(b.split(/\s{2,}/)[0].trim()));

  const lines = [`${calls.length} calls, ${order.length} labels (sorted by ${sortKey})`, '', head, rule, ...body];
  if (slowest.length) {
    lines.push('', `Slowest ${slowest.length} calls:`);
    const width = Math.max(...slowest.map(c => c.duration.toFixed(3).length));
    slowest.forEach(c => {
      lines.push(`  ${c.duration.toFixed(3).padStart(width)} ms  ${c.path}${c.error ? `  ✖ ${c.error}` : ''}`);
    });
  }
  return lines.join('\n');
}

const USAGE = `Usage: traceperf report <file> [--top N] [--sort total|mean|p95|max|count] [--json] [--html out.html]

  <file>  a Chrome/Perfetto trace from startTrace().stop(), or JSON lines
          from jsonLinesExporter(); "-" reads stdin`;

export function main(argv: string[], io: {
  readFile: (path: string) => string;
  readStdin: () => string;
  writeFile?: (path: string, content: string) => void;
  out: (text: string) => void;
  err: (text: string) => void;
}): number {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    io.out(USAGE);
    return command ? 0 : 1;
  }
  if (command !== 'report') {
    io.err(`traceperf: unknown command "${command}"\n\n${USAGE}`);
    return 1;
  }
  const options: ReportOptions = {};
  let file: string | undefined;
  let htmlOut: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--top') options.top = Number(rest[++i]);
    else if (arg === '--sort') options.sort = rest[++i] as ReportOptions['sort'];
    else if (arg === '--html') htmlOut = rest[++i];
    else if (!file) file = arg;
    else {
      io.err(`traceperf: unexpected argument "${arg}"`);
      return 1;
    }
  }
  if (!file) {
    io.err(USAGE);
    return 1;
  }
  if (options.top !== undefined && !(options.top >= 0)) {
    io.err('traceperf: --top expects a number');
    return 1;
  }
  if (options.sort && !['total', 'mean', 'p95', 'max', 'count'].includes(options.sort)) {
    io.err('traceperf: --sort expects total, mean, p95, max or count');
    return 1;
  }
  try {
    const text = file === '-' ? io.readStdin() : io.readFile(file);
    if (htmlOut !== undefined) {
      if (!htmlOut || !io.writeFile) {
        io.err('traceperf: --html expects an output file');
        return 1;
      }
      io.writeFile(htmlOut, report(text, { ...options, html: true, title: `traceperf report: ${file === '-' ? 'stdin' : file.split(/[\\/]/).pop()}` }));
      io.out(`wrote ${htmlOut}`);
      return 0;
    }
    io.out(report(text, options));
    return 0;
  } catch (error) {
    io.err(`traceperf: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/* istanbul ignore next -- process wiring */
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  process.exitCode = main(process.argv.slice(2), {
    readFile: path => fs.readFileSync(path, 'utf8'),
    readStdin: () => fs.readFileSync(0, 'utf8'),
    writeFile: (path, content) => fs.writeFileSync(path, content),
    out: text => console.log(text),
    err: text => console.error(text),
  });
}

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
import { explain, ExplainNode, ExplainOptions, Finding, formatFindings } from './core/explain';
import { renderHtmlReport } from './report-html';
import { createWatcher, WatchOptions } from './watch';
import { parseRunArgs, runApp, RUN_USAGE } from './run';

export interface ReportOptions {
  top?: number;
  /** Return a self-contained HTML report instead of text */
  html?: boolean;
  title?: string;
  sort?: 'total' | 'mean' | 'p95' | 'max' | 'count';
  json?: boolean;
  /** Findings for the HTML report (default: explain() on the input) */
  findings?: Finding[];
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

/** Start in epoch ms: exact startMs when present (ISO strings are rounded to the ms) */
const startOf = (node: any): number =>
  typeof node.startMs === 'number' ? node.startMs : typeof node.start === 'string' ? Date.parse(node.start) : 0;

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
    const start = startOf(node);
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
    const start = startOf(node);
    visit(node, [], pickLane(start, start + node.durationMs));
  });
  return calls;
}

/** Rebuild call trees (for explain) from a Chrome trace or JSON-lines document */
export function parseTrees(text: string): ExplainNode[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') && /"traceEvents"\s*:/.test(trimmed.slice(0, 200))) {
    const trace = JSON.parse(trimmed);
    const roots: ExplainNode[] = [];
    const byTid = new Map<number, any[]>();
    for (const e of trace.traceEvents || []) {
      if (e.ph === 'X') byTid.set(e.tid, [...(byTid.get(e.tid) || []), e]);
    }
    byTid.forEach(events => {
      events.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
      const stack: Array<{ end: number; node: ExplainNode }> = [];
      for (const e of events) {
        while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
        const args = e.args || {};
        const duration = (e.dur || 0) / 1000;
        const sync = typeof args.syncMs === 'number' ? args.syncMs : duration;
        const node: ExplainNode = {
          label: e.name,
          startTime: e.ts / 1000,
          duration,
          selfDuration: typeof args.selfMs === 'number' ? args.selfMs : duration,
          syncDuration: sync,
          async: sync < duration - 0.01, // trace durations are rounded to µs
          error: typeof args.error === 'string' ? args.error : undefined,
          children: [],
        };
        if (stack.length) stack[stack.length - 1].node.children.push(node);
        else roots.push(node);
        stack.push({ end: e.ts + (e.dur || 0), node });
      }
    });
    return roots.sort((a, b) => a.startTime - b.startTime);
  }
  const convert = (n: any): ExplainNode => ({
    label: n.label,
    startTime: startOf(n),
    duration: n.durationMs,
    selfDuration: typeof n.selfMs === 'number' ? n.selfMs : n.durationMs,
    syncDuration: typeof n.syncMs === 'number' ? n.syncMs : undefined,
    async: n.async,
    error: n.error,
    children: (n.children || []).map(convert),
  });
  return trimmed.split('\n').filter(l => l.trim()).map((line, i) => {
    let node: any;
    try {
      node = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1} is not JSON (expected a Chrome trace or JSON lines)`);
    }
    if (typeof node.label !== 'string' || typeof node.durationMs !== 'number') throw new Error(`line ${i + 1} is not a traceperf record`);
    return convert(node);
  });
}

function runExplain(rest: string[], io: { readFile: (p: string) => string; readStdin: () => string; out: (t: string) => void; err: (t: string) => void }): number {
  let file: string | undefined;
  let json = false;
  const options: ExplainOptions = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--json') json = true;
    else if (arg === '--max') options.max = Number(rest[++i]);
    else if (arg === '--blocking') options.blockingMs = Number(rest[++i]);
    else if (arg === '--min') options.minMs = Number(rest[++i]);
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
  for (const [name, v] of [['--max', options.max], ['--blocking', options.blockingMs], ['--min', options.minMs]] as const) {
    if (v !== undefined && !(v >= 0)) {
      io.err(`traceperf: ${name} expects a number`);
      return 1;
    }
  }
  try {
    const findings = explain(parseTrees(file === '-' ? io.readStdin() : io.readFile(file)), options);
    io.out(json ? JSON.stringify(findings, null, 2) : formatFindings(findings));
    return 0;
  } catch (error) {
    io.err(`traceperf: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
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
    let findings = options.findings;
    if (!findings) {
      try {
        findings = explain(parseTrees(text), { max: 10 });
      } catch {
        findings = [];
      }
    }
    return renderHtmlReport(calls, stats, { title: options.title, top: options.top ?? 20, findings });
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

export interface CompareOptions {
  /** Statistic to compare (default p95) */
  metric?: 'mean' | 'p50' | 'p95' | 'p99' | 'max';
  /** Percent increase that counts as a regression (default 10) */
  threshold?: number;
  /** Ignore changes smaller than this many ms (default 0.5) */
  minDelta?: number;
  /** Ignore labels with fewer calls than this in either run (default 1) */
  minCalls?: number;
  json?: boolean;
}

export interface CompareRow {
  label: string;
  before?: number;
  after?: number;
  changePct?: number;
  status: 'regressed' | 'improved' | 'unchanged' | 'added' | 'removed' | 'skipped';
}

function statsOf(text: string): Record<string, LabelStats> {
  const collector = new StatsCollector({ reservoirSize: 100000, maxLabels: 100000 });
  parseCalls(text).forEach(c => collector.add(record(c.label, c.duration, c.selfDuration, c.error)));
  return collector.all();
}

/** Compare two runs label by label */
export function compare(beforeText: string, afterText: string, options: CompareOptions = {}): { rows: CompareRow[]; regressions: number; text: string } {
  const metric = options.metric ?? 'p95';
  const threshold = options.threshold ?? 10;
  const minDelta = options.minDelta ?? 0.5;
  const minCalls = options.minCalls ?? 1;
  const before = statsOf(beforeText);
  const after = statsOf(afterText);
  const labels = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const rows: CompareRow[] = labels.map(label => {
    const b = before[label];
    const a = after[label];
    if (!b) return { label, after: a[metric], status: 'added' as const };
    if (!a) return { label, before: b[metric], status: 'removed' as const };
    if (b.count < minCalls || a.count < minCalls) return { label, before: b[metric], after: a[metric], status: 'skipped' as const };
    const delta = a[metric] - b[metric];
    const changePct = b[metric] > 0 ? (delta / b[metric]) * 100 : (delta > 0 ? Infinity : 0);
    const status = Math.abs(delta) < minDelta ? 'unchanged'
      : changePct > threshold ? 'regressed'
        : changePct < -threshold ? 'improved' : 'unchanged';
    return { label, before: b[metric], after: a[metric], changePct, status };
  });
  const order = { regressed: 0, improved: 1, added: 2, removed: 3, unchanged: 4, skipped: 5 };
  rows.sort((x, y) => order[x.status] - order[y.status] || Math.abs(y.changePct ?? 0) - Math.abs(x.changePct ?? 0));
  const regressions = rows.filter(r => r.status === 'regressed').length;
  if (options.json) {
    return { rows, regressions, text: JSON.stringify({ metric, threshold, regressions, rows }, null, 2) };
  }
  const fmt = (n?: number) => (n === undefined ? '-' : n.toFixed(3));
  const pct = (r: CompareRow) => (r.changePct === undefined ? '' : `${r.changePct >= 0 ? '+' : ''}${Number.isFinite(r.changePct) ? r.changePct.toFixed(1) : '∞'}%`);
  const table = [['label', `before ${metric}`, `after ${metric}`, 'change', 'status'],
    ...rows.map(r => [r.label, fmt(r.before), fmt(r.after), pct(r), r.status])];
  const widths = table[0].map((_, i) => Math.max(...table.map(row => row[i].length)));
  const lines = table.map((row, ri) => row.map((cell, i) => (i === 0 || i === 4 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ').trimEnd()
    + (ri === 0 ? `\n${widths.map(w => '-'.repeat(w)).join('  ')}` : ''));
  const summary = regressions
    ? `${regressions} label${regressions === 1 ? '' : 's'} regressed by more than ${threshold}% (${metric}, ignoring changes < ${minDelta} ms)`
    : `no regressions over ${threshold}% (${metric})`;
  return { rows, regressions, text: `${lines.join('\n')}\n\n${summary}` };
}

const USAGE = `Usage:
  traceperf report <file> [--top N] [--sort total|mean|p95|max|count] [--json] [--html out.html]
  traceperf compare <before> <after> [--metric p95|p99|p50|mean|max] [--threshold 10]
                    [--min-delta 0.5] [--min-calls 1] [--json] [--fail]

  <file>  a Chrome/Perfetto trace from startTrace().stop(), or JSON lines
          from jsonLinesExporter(); "-" reads stdin
  traceperf explain <file> [--max 20] [--blocking 10] [--min 5] [--json]
  traceperf watch <calls.jsonl> [--top N] [--sort p95|p99|mean|total|count|max]
                  [--interval ms] [--once]

  explain lists likely causes: blocking code, sequential awaits, N+1 calls
  compare --fail exits with code 1 when any label regressed (for CI)
  watch follows a JSON-lines log as it grows; --once prints one frame

${RUN_USAGE}`;

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
  if (command === 'compare') {
    return runCompare(rest, io);
  }
  if (command === 'explain') {
    return runExplain(rest, io);
  }
  if (command === 'watch') {
    return runWatchOnce(rest, io);
  }
  if (command === 'run') {
    const args = parseRunArgs(rest);
    io.err(typeof args === 'string' ? `traceperf: ${args}\n\n${RUN_USAGE}` : 'traceperf: run starts an app; use the traceperf command');
    return 1;
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

function runCompare(rest: string[], io: { readFile: (path: string) => string; out: (t: string) => void; err: (t: string) => void }): number {
  const options: CompareOptions = {};
  const files: string[] = [];
  let fail = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--fail') fail = true;
    else if (arg === '--metric') options.metric = rest[++i] as CompareOptions['metric'];
    else if (arg === '--threshold') options.threshold = Number(rest[++i]);
    else if (arg === '--min-delta') options.minDelta = Number(rest[++i]);
    else if (arg === '--min-calls') options.minCalls = Number(rest[++i]);
    else files.push(arg);
  }
  if (files.length !== 2) {
    io.err(USAGE);
    return 1;
  }
  if (options.metric && !['mean', 'p50', 'p95', 'p99', 'max'].includes(options.metric)) {
    io.err('traceperf: --metric expects mean, p50, p95, p99 or max');
    return 1;
  }
  for (const [flag, value] of [['--threshold', options.threshold], ['--min-delta', options.minDelta], ['--min-calls', options.minCalls]] as const) {
    if (value !== undefined && !(value >= 0)) {
      io.err(`traceperf: ${flag} expects a number`);
      return 1;
    }
  }
  try {
    const result = compare(io.readFile(files[0]), io.readFile(files[1]), options);
    io.out(result.text);
    return fail && result.regressions > 0 ? 1 : 0;
  } catch (error) {
    io.err(`traceperf: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

interface WatchArgs extends WatchOptions {
  file?: string;
  interval: number;
  once: boolean;
}

export function parseWatchArgs(rest: string[]): WatchArgs | string {
  const args: WatchArgs = { interval: 1000, once: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--once') args.once = true;
    else if (arg === '--top') args.top = Number(rest[++i]);
    else if (arg === '--sort') args.sort = rest[++i] as WatchArgs['sort'];
    else if (arg === '--interval') args.interval = Number(rest[++i]);
    else if (!args.file) args.file = arg;
    else return `unexpected argument "${arg}"`;
  }
  if (!args.file) return 'watch needs a JSON-lines file';
  if (args.sort && !['p95', 'p99', 'mean', 'total', 'count', 'max'].includes(args.sort)) return '--sort expects p95, p99, mean, total, count or max';
  if (args.top !== undefined && !(args.top >= 1)) return '--top expects a number';
  if (!(args.interval >= 100)) return '--interval expects milliseconds (>= 100)';
  return args;
}

/** `watch --once`: one frame from the whole file (the live loop is in the bin wiring) */
function runWatchOnce(rest: string[], io: { readFile: (path: string) => string; out: (t: string) => void; err: (t: string) => void }): number {
  const args = parseWatchArgs(rest);
  if (typeof args === 'string') {
    io.err(`traceperf: ${args}\n\n${USAGE}`);
    return 1;
  }
  if (!args.once) {
    io.err('traceperf: live watch needs a terminal; use --once for a single frame');
    return 1;
  }
  try {
    const watcher = createWatcher({ ...args, showRate: false });
    watcher.ingest(io.readFile(args.file!) + '\n');
    io.out(watcher.frame(`traceperf watch ${args.file}`));
    return 0;
  } catch (error) {
    io.err(`traceperf: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** Live loop: follow the file, redraw every interval */
function watchLive(args: WatchArgs, fs: any): void {
  const watcher = createWatcher(args);
  const tty = !!(process.stdout && (process.stdout as any).isTTY);
  let offset = 0;
  const tick = () => {
    let size = 0;
    try {
      size = fs.statSync(args.file).size;
    } catch {
      size = 0;
    }
    if (size < offset) {
      watcher.reset(); // truncated or rotated
      offset = 0;
    }
    if (size > offset) {
      const fd = fs.openSync(args.file, 'r');
      try {
        const buffer = Buffer.alloc(size - offset);
        fs.readSync(fd, buffer, 0, buffer.length, offset);
        offset = size;
        watcher.ingest(buffer.toString('utf8'));
      } finally {
        fs.closeSync(fd);
      }
    }
    const frame = watcher.frame(`traceperf watch ${args.file}`);
    process.stdout.write(tty ? `\x1b[H\x1b[2J${frame}\n` : `${frame}\n\n`);
  };
  tick();
  setInterval(tick, args.interval);
}

/* istanbul ignore next -- process wiring */
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  const argv = process.argv.slice(2);
  const watchArgs = argv[0] === 'watch' ? parseWatchArgs(argv.slice(1)) : undefined;
  const runArgs = argv[0] === 'run' ? parseRunArgs(argv.slice(1)) : undefined;
  if (watchArgs && typeof watchArgs !== 'string' && !watchArgs.once) {
    watchLive(watchArgs, fs);
  } else if (runArgs && typeof runArgs !== 'string') {
    /* eslint-disable @typescript-eslint/no-require-imports */
    runApp(runArgs, {
      childProcess: require('child_process'), fs, http: require('http'), os: require('os'), path: require('path'),
      registerPath: require('path').join(__dirname, 'register.js'),
      report, parseTrees,
      out: text => console.log(text),
      err: text => console.error(text),
    }).then(code => { process.exitCode = code; }, error => {
      console.error(`traceperf: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
    /* eslint-enable @typescript-eslint/no-require-imports */
  } else process.exitCode = main(argv, {
    readFile: path => fs.readFileSync(path, 'utf8'),
    readStdin: () => fs.readFileSync(0, 'utf8'),
    writeFile: (path, content) => fs.writeFileSync(path, content),
    out: text => console.log(text),
    err: text => console.error(text),
  });
}

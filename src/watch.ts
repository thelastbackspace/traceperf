/**
 * traceperf watch: a live, top-style view of a JSON-lines log
 * (from jsonLinesExporter) as the application writes it.
 */
import { StatsCollector, LabelStats } from './core/stats';
import type { ExecutionRecord } from './core/records';

export interface WatchOptions {
  top?: number;
  sort?: 'p95' | 'p99' | 'mean' | 'total' | 'count' | 'max';
  /** Calls/s is computed over this window (ms, default 10000) */
  rateWindow?: number;
  /** Show the arrival rate (only meaningful while following a live file; default true) */
  showRate?: boolean;
}

function toRecord(label: string, duration: number, selfDuration: number, error?: string): ExecutionRecord {
  return {
    id: '', label, parentId: null, startTime: 0, endTime: duration, startEpochMs: 0, duration,
    selfDuration, syncDuration: duration, async: false, children: [], threshold: 0,
    trackingMode: 'balanced', silent: true, ...(error ? { error: new Error(error) } : {}),
  };
}

/** Incremental state for `traceperf watch`; feed it text, render frames */
export function createWatcher(options: WatchOptions = {}) {
  const stats = new StatsCollector({ reservoirSize: 2048, maxLabels: 5000 });
  const window = options.rateWindow ?? 10000;
  const arrivals: number[] = [];
  let pending = '';
  let calls = 0;
  let invalid = 0;

  const visit = (node: any) => {
    if (!node || typeof node.label !== 'string' || typeof node.durationMs !== 'number') return;
    stats.add(toRecord(node.label, node.durationMs, typeof node.selfMs === 'number' ? node.selfMs : node.durationMs, node.error));
    calls++;
    (node.children || []).forEach(visit);
  };

  return {
    /** Add newly appended text (may end mid-line) */
    ingest(text: string, now: number = Date.now()): void {
      const lines = (pending + text).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const before = calls;
          visit(JSON.parse(line));
          for (let i = before; i < calls; i++) arrivals.push(now);
        } catch {
          invalid++;
        }
      }
      while (arrivals.length && arrivals[0] < now - window) arrivals.shift();
    },
    /** Forget everything (e.g. the file was truncated) */
    reset(): void {
      stats.reset();
      arrivals.length = 0;
      pending = '';
      calls = 0;
      invalid = 0;
    },
    /** Render one frame as text */
    frame(title: string, now: number = Date.now()): string {
      while (arrivals.length && arrivals[0] < now - window) arrivals.shift();
      const sort = options.sort ?? 'p95';
      const all = stats.all();
      const labels = Object.keys(all).sort((a, b) => (all[b][sort] as number) - (all[a][sort] as number))
        .slice(0, Math.max(1, options.top ?? 15));
      const rate = arrivals.length / (window / 1000);
      const rateText = options.showRate === false ? '' : `  |  ${rate.toFixed(1)} calls/s (last ${window / 1000}s)`;
      const head = `${title}  |  ${calls.toLocaleString('en-US')} calls${rateText}  |  ${new Date(now).toISOString().slice(11, 19)}`
        + (invalid ? `  |  ${invalid} invalid lines` : '');
      if (labels.length === 0) return `${head}\n\nwaiting for data...`;
      const cols: Array<[string, (s: LabelStats) => string]> = [
        ['calls', s => String(s.count)], ['errors', s => String(s.errors)], ['p50', s => s.p50.toFixed(2)],
        ['p95', s => s.p95.toFixed(2)], ['p99', s => s.p99.toFixed(2)], ['max', s => s.max.toFixed(2)], ['total', s => s.total.toFixed(0)],
      ];
      const rows = labels.map(l => [l, ...cols.map(([, f]) => f(all[l]))]);
      const header = ['label', ...cols.map(([n]) => (n === sort ? `${n}▼` : n))];
      const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
      const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
      const footer = options.showRate === false ? 'times in ms' : 'times in ms - Ctrl+C to exit';
      return [head, '', fmt(header), widths.map(w => '-'.repeat(w)).join('  '), ...rows.map(fmt), '', footer].join('\n');
    },
  };
}

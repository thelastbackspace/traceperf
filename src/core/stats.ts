/**
 * Per-label aggregate statistics with bounded memory.
 *
 * count/total/min/max/errors are exact; percentiles come from a fixed-size
 * uniform reservoir sample per label, so memory stays bounded however many
 * calls are made. The number of distinct labels is capped too: labels beyond
 * the cap are folded into "(other)".
 */
import { ExecutionRecord, walkRecords } from './records';

/** Aggregated timings for one label, in milliseconds */
export interface LabelStats {
  count: number;
  errors: number;
  total: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  /** Mean self time (time not spent in tracked children) */
  selfMean: number;
}

export interface StatsOptions {
  /** Samples kept per label for percentiles (default 1024) */
  reservoirSize?: number;
  /** Distinct labels tracked before folding into "(other)" (default 1000) */
  maxLabels?: number;
}

export const OTHER_LABEL = '(other)';

class LabelAccumulator {
  count = 0;
  errors = 0;
  total = 0;
  selfTotal = 0;
  min = Infinity;
  max = -Infinity;
  private samples: number[] = [];

  constructor(private readonly reservoirSize: number) {}

  add(duration: number, selfDuration: number, failed: boolean): void {
    this.count++;
    this.total += duration;
    this.selfTotal += selfDuration;
    if (failed) this.errors++;
    if (duration < this.min) this.min = duration;
    if (duration > this.max) this.max = duration;
    if (this.samples.length < this.reservoirSize) {
      this.samples.push(duration);
    } else {
      // Algorithm R: keep each value with probability reservoirSize / count
      const slot = Math.floor(Math.random() * this.count);
      if (slot < this.reservoirSize) this.samples[slot] = duration;
    }
  }

  snapshot(): LabelStats {
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const pct = (p: number) => {
      if (sorted.length === 0) return 0;
      const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
      return sorted[rank];
    };
    return {
      count: this.count,
      errors: this.errors,
      total: this.total,
      mean: this.count ? this.total / this.count : 0,
      min: this.count ? this.min : 0,
      max: this.count ? this.max : 0,
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
      selfMean: this.count ? this.selfTotal / this.count : 0,
    };
  }
}

export class StatsCollector {
  private readonly reservoirSize: number;
  private readonly maxLabels: number;
  private labels = new Map<string, LabelAccumulator>();

  constructor(options: StatsOptions = {}) {
    this.reservoirSize = Math.max(1, options.reservoirSize ?? 1024);
    this.maxLabels = Math.max(1, options.maxLabels ?? 1000);
  }

  /** Record one execution (not its children) */
  add(record: ExecutionRecord): void {
    let label = record.label;
    let acc = this.labels.get(label);
    if (!acc) {
      // Keep the last slot for "(other)" so the total never exceeds maxLabels
      if (this.labels.size >= this.maxLabels - 1) {
        label = OTHER_LABEL;
        acc = this.labels.get(label);
      }
      if (!acc) {
        acc = new LabelAccumulator(this.reservoirSize);
        this.labels.set(label, acc);
      }
    }
    acc.add(record.duration, record.selfDuration, record.error !== undefined && record.error !== null);
  }

  /** Record a whole finished tree */
  addTree(root: ExecutionRecord): void {
    walkRecords(root, record => this.add(record));
  }

  get(label: string): LabelStats | undefined {
    return this.labels.get(label)?.snapshot();
  }

  all(): Record<string, LabelStats> {
    const out: Record<string, LabelStats> = {};
    this.labels.forEach((acc, label) => {
      out[label] = acc.snapshot();
    });
    return out;
  }

  reset(): void {
    this.labels = new Map();
  }
}

/** Render stats as a fixed-width text table, slowest total first */
export function formatStatsTable(stats: Record<string, LabelStats>): string {
  const rows = Object.keys(stats)
    .map(label => ({ label, ...stats[label] }))
    .sort((a, b) => b.total - a.total);
  if (rows.length === 0) return 'traceperf: no calls recorded';
  const head = ['label', 'calls', 'errors', 'total ms', 'mean', 'p50', 'p95', 'p99', 'max', 'self mean'];
  const body = rows.map(r => [
    r.label,
    String(r.count),
    String(r.errors),
    r.total.toFixed(1),
    r.mean.toFixed(3),
    r.p50.toFixed(3),
    r.p95.toFixed(3),
    r.p99.toFixed(3),
    r.max.toFixed(3),
    r.selfMean.toFixed(3),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(row => row[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [fmt(head), widths.map(w => '-'.repeat(w)).join('  '), ...body.map(fmt)].join('\n');
}

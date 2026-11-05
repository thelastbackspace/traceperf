/**
 * Prometheus / OpenMetrics exporter: a duration histogram and an error
 * counter per label, in the text exposition format.
 */
import { ExecutionRecord, TracePerfPlugin, walkRecords } from './records';

export interface PrometheusExporterOptions {
  /** Metric name prefix (default "traceperf") */
  prefix?: string;
  /** Histogram bucket upper bounds in seconds */
  buckets?: number[];
  /** Distinct labels before folding into "(other)" (default 1000) */
  maxLabels?: number;
  /** Only export top-level calls (e.g. requests), not nested ones (default false) */
  rootsOnly?: boolean;
}

export interface PrometheusExporter extends TracePerfPlugin {
  /** Current metrics in Prometheus text format */
  metrics(): string;
  /** HTTP handler for Node http / Express / Koa-style (req, res) servers */
  handler(req: unknown, res: { setHeader(name: string, value: string): unknown; end(body: string): unknown; statusCode?: number }): void;
  /** Clear all series */
  reset(): void;
}

export const DEFAULT_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Series {
  counts: number[];
  sum: number;
  count: number;
  errors: number;
}

const escapeLabel = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const formatNumber = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12))));

/**
 * Export call durations to Prometheus.
 *
 *   const prom = prometheusExporter();
 *   tp.use(prom);
 *   app.get('/metrics', prom.handler);
 */
export function prometheusExporter(options: PrometheusExporterOptions = {}): PrometheusExporter {
  const prefix = options.prefix ?? 'traceperf';
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(prefix)) throw new Error(`invalid Prometheus metric prefix "${prefix}"`);
  const buckets = (options.buckets ?? DEFAULT_BUCKETS).slice().sort((a, b) => a - b);
  const maxLabels = Math.max(1, options.maxLabels ?? 1000);
  let series = new Map<string, Series>();

  const seriesFor = (label: string): Series => {
    let s = series.get(label);
    if (!s) {
      const key = series.size >= maxLabels - 1 ? '(other)' : label;
      s = series.get(key);
      if (!s) {
        s = { counts: buckets.map(() => 0), sum: 0, count: 0, errors: 0 };
        series.set(key, s);
      }
    }
    return s;
  };

  const observe = (record: ExecutionRecord) => {
    const s = seriesFor(record.label);
    const seconds = record.duration / 1000;
    for (let i = 0; i < buckets.length; i++) {
      if (seconds <= buckets[i]) s.counts[i]++;
    }
    s.sum += seconds;
    s.count++;
    if (record.error !== undefined && record.error !== null) s.errors++;
  };

  const metrics = (): string => {
    const duration = `${prefix}_call_duration_seconds`;
    const errors = `${prefix}_call_errors_total`;
    const lines = [
      `# HELP ${duration} Duration of tracked calls.`,
      `# TYPE ${duration} histogram`,
    ];
    const labels = [...series.keys()].sort();
    for (const label of labels) {
      const s = series.get(label)!;
      const name = `name="${escapeLabel(label)}"`;
      buckets.forEach((bound, i) => lines.push(`${duration}_bucket{${name},le="${formatNumber(bound)}"} ${s.counts[i]}`));
      lines.push(`${duration}_bucket{${name},le="+Inf"} ${s.count}`);
      lines.push(`${duration}_sum{${name}} ${formatNumber(s.sum)}`);
      lines.push(`${duration}_count{${name}} ${s.count}`);
    }
    lines.push(`# HELP ${errors} Tracked calls that threw or rejected.`, `# TYPE ${errors} counter`);
    for (const label of labels) {
      lines.push(`${errors}{name="${escapeLabel(label)}"} ${series.get(label)!.errors}`);
    }
    return lines.join('\n') + '\n';
  };

  return {
    name: 'prometheus',
    onComplete(root) {
      if (options.rootsOnly) observe(root);
      else walkRecords(root, observe);
    },
    metrics,
    handler(_req, res) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(metrics());
    },
    reset() {
      series = new Map();
    },
  };
}

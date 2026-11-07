import * as http from 'http';
import { AddressInfo } from 'net';
import { createTracePerf, prometheusExporter } from '../index';
import { busyWait, useVirtualClock } from './helpers/console';

/** Minimal exposition-format parser: { 'metric{labels}': value } */
function parse(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][\w:]*(?:\{.*\})?) (\S+)$/.exec(line);
    if (!m) throw new Error(`invalid line: ${line}`);
    out[m[1]] = Number(m[2]);
  }
  return out;
}

test('histogram buckets, sum, count and errors per label', () => {
  const restore = useVirtualClock();
  try {
  const prom = prometheusExporter({ buckets: [0.02, 0.2] });
  const tp = createTracePerf({ silent: true, trackMemory: false, plugins: [prom] });
  const query = tp.createTrackable((ms: number) => busyWait(ms), { label: 'db.query' });
  tp.track(() => { query(0); query(40); }, { label: 'GET /x' });
  expect(() => tp.track(() => { throw new Error('x'); }, { label: 'job "a"\nb' })).toThrow();
  const m = parse(prom.metrics());
  expect(m['traceperf_call_duration_seconds_bucket{name="db.query",le="0.02"}']).toBe(1);
  expect(m['traceperf_call_duration_seconds_bucket{name="db.query",le="0.2"}']).toBe(2);
  expect(m['traceperf_call_duration_seconds_bucket{name="db.query",le="+Inf"}']).toBe(2);
  expect(m['traceperf_call_duration_seconds_count{name="db.query"}']).toBe(2);
  expect(m['traceperf_call_duration_seconds_sum{name="db.query"}']).toBeCloseTo(0.04, 6);
  expect(m['traceperf_call_duration_seconds_count{name="GET /x"}']).toBe(1);
  expect(m['traceperf_call_errors_total{name="job \\"a\\"\\nb"}']).toBe(1);
  expect(prom.metrics()).toMatch(/# TYPE traceperf_call_duration_seconds histogram/);
  } finally {
    restore();
  }
});

test('rootsOnly, label cap, reset, invalid prefix', () => {
  const prom = prometheusExporter({ rootsOnly: true, maxLabels: 3 });
  const tp = createTracePerf({ silent: true, plugins: [prom] });
  for (let i = 0; i < 5; i++) tp.track(() => tp.track(() => 1, { label: 'child' }), { label: `r${i}` });
  const m = parse(prom.metrics());
  expect(Object.keys(m).some(k => k.includes('child'))).toBe(false);
  expect(m['traceperf_call_duration_seconds_count{name="(other)"}']).toBe(3);
  prom.reset();
  expect(parse(prom.metrics())).toEqual({});
  expect(() => prometheusExporter({ prefix: 'bad-name' })).toThrow();
});

test('handler serves the exposition format over HTTP', async () => {
  const prom = prometheusExporter();
  const tp = createTracePerf({ silent: true, plugins: [prom] });
  tp.track(() => 1, { label: 'scraped' });
  const server = http.createServer((req, res) => prom.handler(req, res));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/metrics`);
    expect(res.headers.get('content-type')).toContain('version=0.0.4');
    expect(parse(await res.text())['traceperf_call_duration_seconds_count{name="scraped"}']).toBe(1);
  } finally {
    server.close();
  }
});

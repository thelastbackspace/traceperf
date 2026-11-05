#!/usr/bin/env node
/**
 * Compare per-call overhead with the alternatives people actually use.
 *
 *   npm run build && node scripts/compare.js            # table
 *   node scripts/compare.js --markdown                   # table for docs/benchmarks.md
 *
 * Each scenario wraps the same trivial function; numbers are the extra
 * cost per call (best of 5 runs). They measure overhead only, not features:
 * the alternatives record less (no tree, no stats) or more (full spans).
 */
'use strict';
const path = require('path');
const { performance, PerformanceObserver } = require('perf_hooks');
const api = require('@opentelemetry/api');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const { BasicTracerProvider, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { createTracePerf, openTelemetryExporter } = require(path.resolve(__dirname, '..', 'dist'));

const ITERATIONS = 100000;
const markdown = process.argv.includes('--markdown');

function add(a, b) {
  return a + b;
}

function measure(fn) {
  for (let i = 0; i < 10000; i++) fn(i, 1);
  let best = Infinity;
  for (let run = 0; run < 5; run++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < ITERATIONS; i++) fn(i, 1);
    best = Math.min(best, Number(process.hrtime.bigint() - start) / ITERATIONS);
  }
  return best;
}

// OpenTelemetry SDK with an exporter that discards spans (cheapest realistic setup)
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor({
  export: (_spans, done) => done({ code: 0 }),
  shutdown: () => Promise.resolve(),
})] });
api.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
api.trace.setGlobalTracerProvider(provider);
const tracer = api.trace.getTracer('bench');

const observer = new PerformanceObserver(list => { list.getEntries(); });
const timerified = performance.timerify(add);

const quiet = { silent: true };
const scenarios = [
  ['untracked function', () => add],
  ['Date.now() before/after', () => (a, b) => { const s = Date.now(); const r = add(a, b); void (Date.now() - s); return r; }],
  ['performance.now() before/after', () => (a, b) => { const s = performance.now(); const r = add(a, b); void (performance.now() - s); return r; }],
  ['performance.timerify (no observer)', () => timerified],
  ['performance.timerify + observer', () => { observer.observe({ entryTypes: ['function'] }); return timerified; }],
  ['OpenTelemetry startActiveSpan', () => (a, b) => tracer.startActiveSpan('add', span => { const r = add(a, b); span.end(); return r; })],
  ['traceperf disabled', () => createTracePerf({ ...quiet, enabled: false }).createTrackable(add)],
  ['traceperf sampleRate 0.01', () => createTracePerf({ ...quiet, sampleRate: 0.01 }).createTrackable(add)],
  ['traceperf, no memory, no nesting', () => createTracePerf({ ...quiet, trackMemory: false, enableNestedTracking: false }).createTrackable(add)],
  ['traceperf, no memory, nesting', () => createTracePerf({ ...quiet, trackMemory: false }).createTrackable(add)],
  ['traceperf default (memory + nesting)', () => createTracePerf(quiet).createTrackable(add)],
  ['traceperf + OTel live exporter', () =>
    createTracePerf({ ...quiet, trackMemory: false, plugins: [openTelemetryExporter(api, { live: true })] }).createTrackable(add)],
];

const results = scenarios.map(([name, factory]) => ({ name, ns: measure(factory()) }));
observer.disconnect();
const base = results[0].ns;

if (markdown) {
  console.log(`| Approach | Overhead per call |\n|---|---|`);
  for (const r of results.slice(1)) {
    const extra = r.ns - base;
    console.log(`| ${r.name} | ${extra >= 1000 ? `${(extra / 1000).toFixed(2)} µs` : `${Math.max(0, extra).toFixed(0)} ns`} |`);
  }
  console.log(`\nNode ${process.version}, ${require('os').cpus()[0].model}, best of 5 x ${ITERATIONS.toLocaleString()} calls.`);
} else {
  const width = Math.max(...results.map(r => r.name.length));
  console.log(`overhead per call vs. an untracked function (node ${process.version})\n`);
  for (const r of results) {
    console.log(`${r.name.padEnd(width)}  ${(r.ns - base).toFixed(0).padStart(7)} ns`);
  }
}

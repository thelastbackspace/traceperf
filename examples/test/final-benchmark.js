/**
 * TracePerf benchmark: overhead of each tracking mode
 *
 * Measures high-frequency calls of a trivial function, untracked and tracked
 * in each tracking mode (all silent so console I/O is not measured), plus the
 * effect of sampling. Also reports heap growth so leaks are visible.
 *
 * Run `npm run build` first, then:
 *   node examples/test/final-benchmark.js
 *   node --expose-gc examples/test/final-benchmark.js   # steadier heap numbers
 */

const { createTracePerf, TrackingMode } = require('../../dist');

const ITERATIONS = 100000;

function add(a, b) {
  return a + b;
}

function gc() {
  if (global.gc) global.gc();
}

function bench(name, fn) {
  // Warm up
  for (let i = 0; i < 1000; i++) fn(i, 1);
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) fn(i, 1);
  const elapsedNs = Number(process.hrtime.bigint() - start);
  gc();
  const heapAfter = process.memoryUsage().heapUsed;
  return {
    name,
    totalMs: elapsedNs / 1e6,
    nsPerCall: elapsedNs / ITERATIONS,
    heapDeltaKB: (heapAfter - heapBefore) / 1024,
  };
}

const results = [bench('untracked', add)];

for (const mode of [TrackingMode.PERFORMANCE, TrackingMode.BALANCED, TrackingMode.DETAILED]) {
  // enableNestedTracking: false so PERFORMANCE mode may skip wrapping entirely
  const tracker = createTracePerf({ trackingMode: mode, silent: true, enableNestedTracking: false });
  results.push(bench(`${mode} (no nesting)`, tracker.createTrackable(add)));
}

for (const mode of [TrackingMode.BALANCED, TrackingMode.DETAILED]) {
  const tracker = createTracePerf({ trackingMode: mode, silent: true, enableNestedTracking: true });
  results.push(bench(`${mode} (nesting)`, tracker.createTrackable(add)));
}

for (const sampleRate of [0.1, 0.01]) {
  const tracker = createTracePerf({ trackingMode: TrackingMode.BALANCED, silent: true, sampleRate });
  results.push(bench(`balanced, sampleRate ${sampleRate}`, tracker.createTrackable(add)));
}

console.log(`TracePerf benchmark - ${ITERATIONS.toLocaleString()} calls each${global.gc ? '' : ' (run with --expose-gc for steadier heap numbers)'}\n`);
console.table(
  results.map(r => ({
    mode: r.name,
    'total ms': r.totalMs.toFixed(1),
    'ns/call': r.nsPerCall.toFixed(0),
    'heap Δ KB': r.heapDeltaKB.toFixed(0),
  }))
);

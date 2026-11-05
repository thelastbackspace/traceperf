#!/usr/bin/env node
/**
 * Overhead benchmark for traceperf.
 *
 *   node scripts/bench.js            # print a table
 *   node scripts/bench.js --check    # fail if any scenario exceeds its budget
 *   node scripts/bench.js --json     # machine-readable output
 *
 * Measures the extra cost per call of a trivial function, so the numbers
 * are pure traceperf overhead. Budgets are deliberately generous (CI
 * machines are slow and noisy); they exist to catch regressions like the
 * 0.2.x memory tracking that cost ~50µs per call.
 * Requires a build (`npm run build`).
 */
'use strict';
const path = require('path');
const { createTracePerf, TrackingMode } = require(path.resolve(__dirname, '..', 'dist'));

const ITERATIONS = 200000;
const check = process.argv.includes('--check');
const json = process.argv.includes('--json');

function add(a, b) {
  return a + b;
}

function measure(fn) {
  // warm up, then take the best of 5 runs to reduce noise
  for (let i = 0; i < 20000; i++) fn(i, 1);
  let best = Infinity;
  for (let run = 0; run < 5; run++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < ITERATIONS; i++) fn(i, 1);
    best = Math.min(best, Number(process.hrtime.bigint() - start) / ITERATIONS);
  }
  return best;
}

const quiet = { silent: true };
const scenarios = [
  // [name, factory, budget ns/call]
  ['baseline (untracked)', () => add, Infinity],
  ['disabled (enabled: false)', () => createTracePerf({ ...quiet, enabled: false }).createTrackable(add), 200],
  ['sampled out (sampleRate: 0)', () => createTracePerf({ ...quiet, sampleRate: 0 }).createTrackable(add), 300],
  ['performance mode, no nesting', () => createTracePerf({ ...quiet, trackingMode: TrackingMode.PERFORMANCE, enableNestedTracking: false }).createTrackable(add), 200],
  ['tracked, no memory, no nesting', () => createTracePerf({ ...quiet, trackMemory: false, enableNestedTracking: false }).createTrackable(add), 6000],
  ['tracked, no memory, nesting', () => createTracePerf({ ...quiet, trackMemory: false }).createTrackable(add), 8000],
  ['tracked, memory + nesting (default)', () => createTracePerf(quiet).createTrackable(add), 15000],
  ['track(fn) per call (default)', () => {
    const tp = createTracePerf(quiet);
    return (a, b) => tp.track(() => add(a, b));
  }, 15000],
];

const results = scenarios.map(([name, factory, budget]) => {
  const ns = measure(factory());
  return { name, ns, budget };
});
const baseline = results[0].ns;
const failures = results.filter(r => r.ns - baseline > r.budget);

if (json) {
  console.log(JSON.stringify({ node: process.version, iterations: ITERATIONS, results }, null, 2));
} else {
  console.log(`traceperf overhead per call (node ${process.version}, best of 5 x ${ITERATIONS.toLocaleString()} calls)\n`);
  const width = Math.max(...results.map(r => r.name.length));
  for (const r of results) {
    const overhead = r.name.startsWith('baseline') ? '' : `  +${(r.ns - baseline).toFixed(0).padStart(6)} ns`;
    const budget = Number.isFinite(r.budget) ? `  (budget ${r.budget} ns)` : '';
    console.log(`${r.name.padEnd(width)}  ${r.ns.toFixed(0).padStart(6)} ns${overhead}${budget}`);
  }
}

// Size budget for the <script> build (gzipped), when it has been built
const fs = require('fs');
const zlib = require('zlib');
const minFile = path.resolve(__dirname, '..', 'dist', 'traceperf.browser.min.js');
const SIZE_BUDGET = 15 * 1024;
if (fs.existsSync(minFile)) {
  const gz = zlib.gzipSync(fs.readFileSync(minFile)).length;
  if (!json) console.log(`\nbrowser bundle: ${(gz / 1024).toFixed(1)} KB gzipped (budget ${SIZE_BUDGET / 1024} KB)`);
  if (gz > SIZE_BUDGET) failures.push({ name: 'browser bundle size' });
}

if (check) {
  if (failures.length) {
    console.error(`\nOverhead budget exceeded: ${failures.map(f => f.name).join(', ')}`);
    process.exitCode = 1;
  } else if (!json) {
    console.log('\nAll scenarios within budget.');
  }
}

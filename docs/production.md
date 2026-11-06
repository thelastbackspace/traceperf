# Running traceperf in production

traceperf is meant to stay on in production. This page covers safe settings, what each feature costs, and how to roll it out without surprises.

## Recommended settings

```javascript
const { createTracePerf, TrackingMode, prometheusExporter } = require('traceperf');

const metrics = prometheusExporter();
const tp = createTracePerf({
  trackingMode: TrackingMode.PERFORMANCE, // no console trees
  trackMemory: false,                     // the most expensive part, and only a hint
  sampleRate: Number(process.env.TRACEPERF_SAMPLE_RATE ?? 1),
  enabled: process.env.TRACEPERF_ENABLED !== '0',
  plugins: [metrics],
});
```

Or, with no code changes:

```bash
TRACEPERF_SILENT=1 TRACEPERF_SAMPLE_RATE=0.2 TRACEPERF_IGNORE='^/(health|ready|metrics)' \
TRACEPERF_OUTPUT=/var/log/app/traceperf.jsonl node --require traceperf/auto server.js
```

- **Silence the console.** Per-call trees are for development. In production, use statistics, Prometheus, OpenTelemetry or JSON lines.
- **Turn memory sampling off.** `trackMemory: false` (the default for `traceperf/auto`). Heap deltas cost ~2.4 µs per call and are only a hint.
- **Sample hot paths.** `sampleRate` decides per top-level call, so a sampled request is tracked completely and a skipped one costs almost nothing.
- **Keep a kill switch.** `enabled: false` / `tp.disable()` / `TRACEPERF_ENABLED=0` turns every tracked function into a plain call (~45 ns).
- **Ignore health checks.** `TRACEPERF_IGNORE` or `instrumentHttpServer(tp, { ignore })` keeps probes out of your statistics.

## What it costs

Measured on Node 24 (AMD EPYC). Reproduce with `npm run bench` and `npm run bench:compare`.

| Feature | Cost |
|---|---|
| `enabled: false`, or a call that is sampled out | ~45 ns per call |
| Tracked call, no memory, with nesting | ~1.5 µs per call |
| Tracked call with memory sampling (development default) | ~3.7 µs per call |
| Incoming request (`traceperf/auto`, `instrumentHttpServer`) | ~4.4 µs per request; ~1.4 µs when sampled out at 10% |
| Writing each request tree as JSON lines | ~5 µs more per request (`JSON.stringify` plus the write) |
| `profileSlowCalls` (V8 sampling profiler at 1 ms) | 0–6% CPU on CPU-bound code in our runs |
| `TRACEPERF_PROFILE_BLOCKING=1` (names blocking code) | the same sampling profiler; use while investigating |
| OpenTelemetry span via the live exporter | ~16 µs per call (mostly the OpenTelemetry SDK itself) |

A request that takes 1 ms pays well under 1% for full tracking. On a hello-world HTTP server running in a separate process, the difference with and without `traceperf/auto` was smaller than run-to-run noise.

**Memory** is bounded: each label keeps a 512-sample reservoir, labels past 1,000 are folded into `(other)`, finished trees are released as soon as hooks have run, and `traceperf/auto` keeps the last 1,000 trees for its exit summary.

**Labels must stay few.** Use route patterns, not raw URLs. `traceperf/auto` collapses ids (`/users/42` becomes `/users/:id`), and the framework integrations use the route pattern. Don't put user ids or other unbounded values in labels.

## Rolling it out

1. **Staging, full detail.** Run with `traceperf/auto` and `TRACEPERF_OUTPUT`. Read `traceperf explain calls.jsonl` and `traceperf report calls.jsonl --html report.html`.
2. **One production instance**, with `TRACEPERF_SAMPLE_RATE=0.1` or so. Compare its latency and CPU with the other instances for a day.
3. **Everywhere**, at the sample rate you are comfortable with. Export to Prometheus or OpenTelemetry for dashboards and alerts (`onSlow` for logging).
4. **In CI**, save a JSON-lines run of your benchmark or test suite and fail the build on regressions with `traceperf compare before.jsonl after.jsonl --fail`.

To investigate a CPU problem, turn on `profileSlowCalls` on one instance for a while, with a high threshold.

## Failure modes

- **traceperf never breaks your code.** Exceptions and return values pass through unchanged; a plugin that throws is reported once and ignored. Instrumentation that cannot load or patch a client is skipped.
- **Unpatching:** every `instrument*` function returns an uninstall function, and `autoInstrument(tp).uninstall()` removes everything.
- **Signals:** `traceperf/auto` prints its summary on exit. On SIGINT/SIGTERM it only exits by itself if your app doesn't handle the signal; if it does, the summary prints when your app exits.
- **Clock precision:** browsers and Cloudflare Workers coarsen timers on purpose, so very short durations there are approximate.

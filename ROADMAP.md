# Roadmap

What's planned, roughly in priority order. Comments and PRs are welcome on any of these. Items marked **good first issue** are self-contained and have a clear test.

## Next

- **More auto-instrumentation recipes**, each a few lines on top of `instrumentMethods`, with a test against the real library:
  - `mysql2`, `mongodb`/Mongoose, `ioredis`, `@aws-sdk` clients. **Good first issue**, one per library.
  - Koa and NestJS integrations (NestJS as an interceptor).
- **A browser DevTools view:** `performance.measure()` marks, so tracked calls show up in the DevTools Performance panel's Timings track with no export step.
- **Flame-chart HTML report:** `traceperf report trace.json --html` writes a single self-contained HTML file.
- **Threshold alerts:** `onSlow(threshold, fn)` sugar over `onComplete`, with per-label thresholds.
- **Prometheus/OpenMetrics exporter:** expose `getStats()` as histograms on a `/metrics` handler.

## Later

- **Allocation sampling:** an opt-in `v8` sampling heap profiler around a span, for real allocation numbers instead of heap deltas.
- **Regression mode:** compare stats between two runs (`traceperf compare before.jsonl after.jsonl`), e.g. in CI.
- **Cloudflare Workers / edge runtimes** in CI (they have `AsyncLocalStorage` behind a compatibility flag).
- **Live view:** `traceperf watch`, a terminal UI that tails JSON lines and shows top labels by p95.

## Good first issues

- `traceperf report --sort self` (sort by mean self time). The data is already there.
- `--min-duration` filter for `traceperf report`.
- A `labelFor` example for `pg` in `examples/`, tested with `pg-mem`.
- Translate the README quick start into `docs/index.html` (keep `verify:docs` passing).

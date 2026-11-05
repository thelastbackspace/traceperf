# Roadmap

Ideas, roughly in priority order. Comments and PRs are welcome on any of these. Items marked **good first issue** are self-contained and have a clear test.

## Shipped recently

Database/cloud client instrumentation, Koa/NestJS, the DevTools timeline, HTML reports, `traceperf compare`, `onSlow`, the Prometheus exporter, allocation profiling, edge runtimes and `traceperf watch` (all in 1.2). See CHANGELOG.md.

## Next

- **More clients:** `node-redis` v4, `@elastic/elasticsearch`, `kafkajs`, `undici` request/dispatcher, GraphQL resolvers (Apollo plugin).
- **Live OpenTelemetry for spans() and integrations by default:** one switch to turn every integration's spans into OTel spans.
- **`traceperf report` from Prometheus/OTel data:** read an OTLP JSON export.
- **Browser:** React Profiler integration (`<Profiler onRender>` to tracked records) and Web Vitals correlation.
- **Regression gate as a GitHub Action:** wrap `traceperf compare --fail` with PR comments.

## Good first issues

- `traceperf report --sort self` (sort by mean self time).
- `--min-duration` filter for `traceperf report` and `watch`.
- `traceperf watch` keyboard shortcuts to change the sort column.
- A `node-redis` v4 helper mirroring `instrumentRedis`.

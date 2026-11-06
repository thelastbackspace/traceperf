# Roadmap

Ideas, roughly in priority order. Comments and PRs are welcome on any of these. Items marked **good first issue** are self-contained and have a clear test.

## Shipped recently

- Next: `traceperf run` (one command: start, load, explain) and known-slow example apps that check `explain`.
- 1.3: zero-code `traceperf/auto`, `traceperf explain`, CPU hotspots for slow calls (`profileSlowCalls`), real-MySQL CI.
- 1.2: database/cloud client instrumentation, Koa/NestJS, the DevTools timeline, HTML reports, `traceperf compare`, `onSlow`, the Prometheus exporter, allocation profiling, edge runtimes and `traceperf watch`.

See CHANGELOG.md.

## Next

- **Real-world validation:** run traceperf on production services and publish case studies, including where it was wrong.
- **`traceperf/auto` for more servers and clients:** `http2`, `undici` dispatchers, `node-redis` v4, AWS SDK clients without per-client setup.
- **`explain` for untracked blocking:** combine the event-loop delay monitor with `profileSlowCalls` to name blocking code that isn't tracked.
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

# traceperf compared with other tools

An honest comparison: where traceperf is the better choice, and where something else is.

## At a glance

| | traceperf | clinic.js / 0x | `node --cpu-prof` | OpenTelemetry SDK | APM agents (Datadog, New Relic, ...) |
|---|---|---|---|---|---|
| What it shows | call trees and stats for tracked calls, plus causes | flame graphs, event-loop and GC diagnosis | a CPU profile | distributed traces | traces, metrics, dashboards |
| Setup | `--require traceperf/auto`, or one import | run the app under the tool | a flag | SDK, exporter, collector, backend | agent plus account |
| Async-aware request trees | yes | no | no | yes | yes |
| Explains why something was slow | yes (`explain`) | yes (Doctor) | no | no | partly |
| Line-level CPU detail | for slow calls (`profileSlowCalls`) | yes | yes | no | some (profiling add-on) |
| Meant for production | yes (sampling, kill switch, bounded memory) | no | no | yes | yes |
| Across services | no (exports to OTel for that) | no | no | yes | yes |
| Runs in browsers, Bun, Deno, edge | yes | no | no | partly | partly |
| Cost | free, no dependencies | free | free | free, plus a backend | paid |

## Choose traceperf when

- You want to know **why a request or function is slow**, and want the answer in your terminal in minutes, not after setting up a tracing backend.
- You want the same tool in **development, CI and production**: trees while you develop, `traceperf compare --fail` in CI, stats/Prometheus in production.
- You care about specific operations (a handler, a query, a job) and want **per-operation p50/p95/p99** without a backend.
- You run code in **several runtimes** (Node, Bun, Deno, Workers, browsers) and want one tool.

## Choose something else when

- **You have no idea where the time goes and it's CPU-bound:** start with `node --cpu-prof` or 0x. traceperf's `profileSlowCalls` covers this only around calls that were already slow.
- **The slowness is GC or memory pressure:** clinic.js Doctor/HeapProfiler and Chrome DevTools heap snapshots are better. traceperf's `profileAllocations` is a narrow tool for one function.
- **You need traces across many services:** use OpenTelemetry. traceperf can feed it (`openTelemetryExporter`), but it does not propagate context between processes.
- **You want hosted dashboards, alerting and retention without running anything:** an APM product does that; traceperf gives you Prometheus metrics and files.

## How it differs from OpenTelemetry

OpenTelemetry is a standard for collecting telemetry and sending it somewhere. traceperf is a tool that answers a question on the spot. The two work together: traceperf's call trees and stats are useful without a backend, and when you have one, `openTelemetryExporter` sends the same calls as spans. A traceperf span costs about a sixth of an OpenTelemetry SDK span (1.5 µs vs ~10 µs, see [benchmarks](benchmarks.md)).

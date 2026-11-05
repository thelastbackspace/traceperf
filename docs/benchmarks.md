# Overhead compared with the alternatives

Extra cost per call of wrapping a trivial function. Reproduce with `npm run build && npm run bench:compare`.

| Approach | Overhead per call | What you get |
|---|---|---|
| `performance.now()` before/after | 135 ns | one number, by hand |
| `Date.now()` before/after | 239 ns | one number, ms resolution |
| `performance.timerify` (no observer) | 520 ns | nothing until you observe |
| `performance.timerify` + observer | 795 ns | a flat list of entries |
| **traceperf disabled** (`enabled: false`) | **42 ns** | kill switch: nothing |
| **traceperf `sampleRate: 0.01`** | **114 ns** | stats and trees for 1% of calls |
| **traceperf, no memory, no nesting** | **870 ns** | timing, stats, hooks, exporters |
| **traceperf, no memory, nesting** | **1.92 µs** | plus the call tree, across `await` |
| **traceperf default** (memory + nesting) | **4.34 µs** | plus the heap delta per call |
| OpenTelemetry `startActiveSpan` (SDK, discarding exporter) | 18.13 µs | a span with context propagation |
| traceperf + OTel live exporter | 25.21 µs | traceperf plus a real OTel span per call |

Node v24.15.0, AMD EPYC, best of 5 × 100,000 calls.

## How to read this

- **A bare timer is cheapest, but it's only a number.** traceperf in full mode costs a few microseconds more, because it builds the tree, keeps statistics and samples the heap.
- **traceperf is about 4× cheaper than an OpenTelemetry span** and needs no SDK. If you already run OpenTelemetry, the exporter adds traceperf's spans to it.
- **Memory sampling is the most expensive part** (~2.4 µs per call, two V8 heap reads). Turn it off with `trackMemory: false` in production.
- **For hot paths**, use `sampleRate` (114 ns at 1%) or `enabled: false` (42 ns).
- **Rule of thumb:** for anything that takes a millisecond or more (requests, queries, file and network I/O), the default overhead is under 0.5%.

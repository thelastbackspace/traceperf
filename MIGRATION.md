# Migrating to traceperf 1.0

1.0 removes the pre-0.2 logging API, which had been undocumented since 0.2.0 ("Simplified logging API in favor of performance focused monitoring"). It also removes two standalone browser helper classes. The tracking API (`track`, `createTrackable`, `registerModule`, `trackObject`, `start`, `traced`, stats, hooks, exporters, integrations, `BrowserLogger`) is unchanged from 0.3.

If you only use what the README documents, you don't need to change anything.

## Removed exports

| Removed | Use instead |
|---|---|
| `Logger` (`info`/`warn`/`error`/`debug`/`group`/`track`) | `createTracePerf()` for tracking; your application logger (or `console`) for log messages. In the browser, `BrowserLogger` still has `info`/`warn`/`error`/`debug`/`group`. |
| `ConfigManager`, `DEFAULT_CONFIG`, `LOG_LEVEL_PRIORITY`, `MODE_MIN_LEVELS` | `createTracePerf(config)` / `setConfig(config)` with `TracePerfConfig` |
| `ILogger`, `ILoggerConfig`, `IFormatter`, `ITransport`, `LogMeta`, `IExecutionTracker`, `IPerformanceMonitor`, `ITrackOptions` | `TracePerfConfig`, `TrackOptions`, `TrackCallOptions`, `ModuleTrackOptions`, `ExecutionRecord`, `TracePerfPlugin` |
| `COLORS`, `LEVEL_COLORS`, `LEVEL_ICONS`, `BOX_CHARS`, `PERFORMANCE_ICONS` | Not needed; use `formatTree(record)` or a custom `reporter` to control output. |
| `BrowserExecutionTracker`, `BrowserPerformanceMonitor` (from `traceperf/browser`) | `createTracePerf()` from `traceperf/browser`. Use `getStats()`, `onComplete()` or `startTrace()` for the data `generateFlowChart()` / `isBottleneck()` used to give you. |

`LogLevel` and `LogMode` are still exported from `traceperf/browser` for `BrowserLogger`'s `setMode()`.

## Common replacements

```js
// 0.x
const { Logger } = require('traceperf');
const logger = new Logger({ performanceThreshold: 100 });
logger.track(() => work(), { label: 'work' });

// 1.0
const { createTracePerf } = require('traceperf');
const tp = createTracePerf();
tp.track(() => work(), { label: 'work' });
```

```js
// 0.x: read the execution flow afterwards
const tracker = new BrowserExecutionTracker();
tracker.track(fn, { label: 'fn' });
console.log(tracker.generateFlowChart());

// 1.0: get every finished tree as data
import { createTracePerf } from 'traceperf/browser';
const tp = createTracePerf({ onComplete: (root) => console.log(root.label, root.duration) });
tp.track(fn, { label: 'fn' });
```

## Type-only changes

- `ITracePerfConfig` and `PerformanceMonitorOptions` remain as aliases of `TracePerfConfig`, but they are deprecated.
- `IBrowserTracePerfConfig` no longer extends the old `ILoggerConfig`. It is `TracePerfConfig` plus `mode`, `performanceThreshold` and `logger`. The old logger fields (`level`, `colorize`, `timestamp`, `indentSize`, `autoTracking`, `transports`, `formatters`) never affected browser tracking and are no longer accepted.

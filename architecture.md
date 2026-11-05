# traceperf architecture

## One core, two entry points

```
src/index.ts     (traceperf)          src/browser.ts  (traceperf/browser)
  default instance + createTracePerf     BrowserLogger extends OptimizedPerformanceMonitor
  integrations (Express/Fastify/Hono)    (+ info/warn/error/debug/group, browser output format)
            \                                   /
             \                                 /
          src/core/optimized-performance-monitor.ts
            OptimizedPerformanceMonitor   public API: track, createTrackable, registerModule,
                                          trackObject, traced, start, use/onComplete, stats,
                                          startTrace, enable/disable, setConfig
            OptimizedExecutionTracker     the engine: timing, nesting context, sampling,
                                          building records, dispatch
```

Both entries share the same engine, so behaviour (nesting, thresholds, sampling, statistics, hooks, exporters) is identical. Only the default console format differs.

## Life of a tracked call

1. **Wrap or call:** `createTrackable(fn)` returns a regular function that calls `_invoke`. `track(fn)` calls `_invoke` directly, without building a wrapper per call.
2. **Fast exits:** if the instance is disabled, or the call is sampled out, `fn` is called directly (~40–60 ns).
3. **Start:** `startTimer` records the start time and, when memory tracking is on, the heap via `v8.getHeapStatistics()`. It resolves per-call options against the current config and notifies plugins' `onStart`.
4. **Parent lookup:** the parent is the "current execution" from the execution context. On Node.js that is `AsyncLocalStorage`, loaded at runtime with `process.getBuiltinModule` or an indirect `require`, so browser bundles don't pull it in. Elsewhere it is a synchronous stack.
5. **Run:** `fn` runs inside the context as the current execution, so tracked calls inside it become its children.
6. **Finish:** for a native promise, the end of the synchronous part is marked and the timer ends when the promise settles. Other thenables are returned untouched.
7. **Report:** a finished child whose parent is still running waits in `executionTree`. When a top-level call (or an orphan) finishes, the tracker:
   - builds one `ExecutionRecord` tree (ms; self time from the union of child intervals; sync time);
   - releases the internal tree, so nothing grows with call count;
   - adds every record to `StatsCollector`;
   - prints with the reporter, unless silent, in `PERFORMANCE` mode, or under threshold (default `formatTree`, `BrowserLogger.formatFlow` in the browser, or a custom `reporter`);
   - calls plugins' `onComplete` (exporters, `onComplete` listeners). Errors are isolated.

## Modules

| File | Responsibility |
|---|---|
| `core/optimized-performance-monitor.ts` | engine and public API |
| `core/records.ts` | `ExecutionRecord`, `TracePerfPlugin`, `formatTree`, interval maths |
| `core/stats.ts` | per-label statistics: exact counters, reservoir percentiles, label cap |
| `core/exporters.ts` | Chrome/Perfetto trace (lane assignment for overlapping work), OpenTelemetry, JSON lines |
| `core/event-loop.ts` | `monitorEventLoop()` on top of `perf_hooks.monitorEventLoopDelay` |
| `core/env.ts` | bundler-safe loading of Node built-ins |
| `integrations.ts` | Express / Fastify / Hono / fetch-handler helpers built on spans |
| `types/options.ts` | public option and config types |

## Build outputs

| Output | Built by |
|---|---|
| `dist/*.js` (CommonJS, `main`/`require`) | `tsc` |
| `dist/esm/*.js` (ESM, `import`) | `tsc -p tsconfig.esm.json`, then `scripts/postbuild-esm.js` (adds `.js` extensions, `"type": "module"` scope, strips the CommonJS shim between `// <cjs-compat>` markers) |
| `dist/traceperf.browser(.min).js` (`<script>`, global `TracePerf`) | `scripts/build-browser-global.js` (esbuild IIFE) |

## Guarantees and how they are checked

| Guarantee | Check |
|---|---|
| Installs and works as CJS, ESM, TypeScript (node10/nodenext/bundler), bundled, `<script>` | `scripts/verify-package.js`, publint, are-the-types-wrong |
| Works on Node.js 14–24 | CI runtime matrix (`verify-package.js --runtime`) |
| Works in Chromium, Firefox, WebKit | Playwright (`test/browser`) |
| README examples run and print what they show | `scripts/check-docs.js` |
| Overhead and bundle size don't regress | `scripts/bench.js --check` |
| Tracking never changes behaviour (`this`, return values, errors, name/length) | `src/__tests__/tracking-*.test.ts` |

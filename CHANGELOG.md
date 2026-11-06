# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Prisma 4 and 5** are tracked too (their tracing hook only runs with a preview feature, so their client's request method is used); 6 and 7 keep using the hook.
- **Express route labels:** requests are labelled by their route, `GET /api/articles/:slug`, instead of the URL (slugs and names no longer make one label per article or user).

### Changed (from running it on the RealWorld "Conduit" API: Prisma 4, Express, Postgres)
- A call that is far slower than it usually is gets "usually 5 ms (median), so the slow ones were waiting, not working: check the pool size, locks, GC…" instead of "check the query plan".
- The rare-occurrence rule covers blocking too (warm-up in a router), except blocks of 100 ms or more.

### Fixed
- `traceperf run` could still leave a tsx app running: tsx's child ignores SIGTERM and `npx` exiting looked like the app exiting. `run` now waits for the whole process group to be gone, then SIGKILLs what is left (also when `run` itself is terminated).
- CI: the browser job has a 15-minute limit (a hung Playwright download held a release for 20 minutes).

## [1.5.0] - 2026-11-06

### Added
- **Prisma without code changes (5, 6 and 7):** `traceperf/auto` and `traceperf run` track every Prisma Client call (`prisma.User.findMany`, raw queries as `prisma.raw.queryRaw`) through Prisma's own tracing hook, so it works with clients generated anywhere (Prisma 7's `prisma-client`), `$extends` and driver adapters, and keeps `@prisma/instrumentation` (OpenTelemetry) working. `instrumentPrisma(tp)` does it by hand; `prismaExtension` steps aside when it is active.
- **better-sqlite3, and so Drizzle on SQLite:** `instrumentBetterSqlite3`; auto-detected. Drizzle on pg or mysql2 was already covered through those drivers.
### Changed (from running it on Prisma's REST example, not just the planted apps)
- **Grouped findings show the typical case**, not the worst: one cold start no longer makes every request look slow. The worst is mentioned (`typical shown; worst 191 ms`), and a finding seen in under 5% of 20+ requests is dropped as noise; otherwise its share is given (`in 1 of 172 GET /feed`).
- "X took 97% of the request" is no longer said of a request that makes a single call, unless that call takes 100 ms or more.
- Sequential or repeated calls made *inside* a driver or ORM call (Prisma's `include` runs two queries) are not reported: the app can't reorder them.
- Blocking inside a dependency or Node.js internals gets "the time is inside pg (library code)…" instead of "move it to a worker thread".
- `traceperf run`: queueing with nothing blocking is described as the app's throughput limit, with what to do about it.
- SQL labels read quoted names: `"public"."Post"` → `SELECT public.Post` (was `SELECT public`).

### Fixed
- `traceperf run -- npx tsx app.ts` hung after the load and left the app running: only `npx` was stopped. The app now runs in its own process group, which is stopped as a whole (also on Ctrl-C and when `run` itself is terminated).

- N+1 fixes name the Prisma (`include`, `where: { id: { in } }`) and Drizzle (`inArray`) way.

## [1.4.0] - 2026-11-06

### Added
- **`traceperf run`:** starts an app with `traceperf/auto`, sends concurrent traffic (`--path`, `-c`, `-d`/`-n`, `--method`; warm-up requests first), then prints statistics and explanations. Without `--path`, use the app yourself and press Ctrl-C. Works with a script (`traceperf run server.js`) or any command (`traceperf run -- npm start`). `--html`, `--output`, `--json`.
- **Fix suggestions:** findings now say what to change (`fix` in `explain()` / `--json`, a `fix:` line in text, under each finding in HTML): `Promise.all` for sequential awaits, `WHERE id IN (...)` / DataLoader for N+1, the async API for `pbkdf2Sync`, `readFileSync` and Sync zlib, a worker thread or chunking for hot loops, `EXPLAIN ANALYZE` for a dominant query.
- **Evidence links in the HTML report:** the report now opens with the findings ("Why it was slow"); click one to highlight its time range on the flame chart (no scripts, works from disk). Each finding carries `evidence: { start, end, labels }` in `explain()` and `--json` output.
- **Known-slow example apps** (`examples/slow-apps/`): one planted cause each; a test checks that `explain` names it.
- **Blocking code is named even when untracked:** `traceperf run` (and `TRACEPERF_PROFILE_BLOCKING=1` with `traceperf/auto`) samples the CPU during the synchronous part of blocking calls, and `explain` names the function and line (`CPU time: buildReport (server.js:10) 100%`). Native work is named by the calling app function (`hashPassword → pbkdf2Sync`), code V8 inlined into its caller is credited to the inlined function, and garbage-collection pauses are reported as such.
- `traceperf run` reports **queueing the app can't see**: clients' latency compared with the app's own timings, per path.
- `blockingRanges(root)`, `blockingHotspots(entries)`, `explain(roots, { hotspots })`; `profileSlowCalls({ select, mergeInlined })`; `summariseProfile(..., { mergeInlined })`; `Hotspot.hotLine`; `Finding.call`.
- JSON lines include `startMs` (sub-millisecond start time); `traceperf explain` uses it when present.

### Changed
- `explain`: an N+1 pattern is reported once, not also as sequential awaits; sequential awaits in one parent are one finding; errors are listed first; "X in X" no longer appears when the blocking call is the top-level call.

## [1.3.0] - 2026-11-06

### Added
- **Zero-code instrumentation:** `node --require traceperf/auto app.js` (or `--import` for ESM). Every incoming HTTP request is a top-level call with outgoing `http`/`fetch` calls and `pg`, `mysql2`, MongoDB/Mongoose and `ioredis` queries nested under it; database clients are instrumented only when the app's `package.json` lists them. Configured with `TRACEPERF_*` environment variables; prints statistics and explanations on exit. In code: `autoInstrument(tp)`.
- `instrumentHttpServer(tp)`: incoming-request tracking for any Node `http`/`https` server, without framework middleware. `normalizePath()` collapses ids (`/users/42` becomes `/users/:id`).
- **`explain(roots)` and `traceperf explain <file>`:** plain-English causes of slow calls. It reports calls delayed by blocking code elsewhere (naming the function that blocked), sequential awaits that could run in parallel, N+1 repeated calls, dominant children and errors.
- `profileSlowCalls({ threshold, onProfile })`: V8 sampling-profiler hotspots (function, file:line, self time, plus idle and GC time) for every slow top-level call.
- docs: production guide (`docs/production.md`, with measured costs) and comparison with other tools (`docs/comparison.md`).

### Fixed
- `instrumentMysql2`: `pool.query()` and `pool.promise().query()` threw "You have tried to call .then() ... on the result of query that is not a promise". Driver command objects are no longer treated as promises, and streaming queries now get their real duration instead of 0 ms.

- ESM apps on Node.js < 20.16 started with `--import traceperf/auto` get request tracking and nesting across `await` (the entry point imports Node built-ins statically).

### Changed
- The default instance (`require('traceperf')` / `import tp from 'traceperf'`) is now shared between the CommonJS and ESM builds, so calls tracked through either nest in the same trees.

### Development
- CI runs a MySQL 8.4 service for the driver tests. The packed-package check runs `node --require traceperf/auto` on every Node version from 14 to 24.

## [1.2.0] - not published separately (released in 1.3.0)

### Added
- **Database and cloud clients:** `instrumentPg`, `instrumentMysql2`, `instrumentMongo` (also works for Mongoose via `mongoose.mongo`), `instrumentRedis` (ioredis) and `instrumentAwsClient` (AWS SDK v3). Labels look like `pg SELECT users` or `aws S3.GetObject`. `sqlLabel()` builds low-cardinality SQL labels.
- **Frameworks:** `koaMiddleware` and `nestInterceptor` (no dependency on Nest or rxjs).
- `performanceTimeline()`: tracked calls appear on a custom track in the Chrome DevTools Performance panel (User Timing everywhere else).
- **`traceperf report --html`:** a self-contained flame-chart report.
- **`traceperf compare before after [--fail]`:** label-by-label regression check for CI.
- **`traceperf watch calls.jsonl`:** a live, top-style terminal view.
- `onSlow(threshold | { label: ms, '*': ms }, listener)`: slow-call alerts.
- `prometheusExporter()`: a duration histogram and an error counter per label, with an HTTP handler.
- `profileAllocations(fn)`: real allocated bytes and top allocation sites via V8's sampling heap profiler. Includes collected objects on Node 20+.
- **Edge runtimes:** `AsyncLocalStorage` is detected as a global, and a new `asyncLocalStorage` option accepts the class explicitly. Verified on Cloudflare Workers (workerd) and Vercel Edge (edge-runtime).
- `traceperf/browser` also exports `performanceTimeline`, `instrumentFetch`, the exporters and `formatTree`.

### Development
- CI runs Postgres and MongoDB service containers for the driver tests, plus Cloudflare workerd and edge-runtime jobs.

## [1.1.0] - not published separately (released in 1.3.0)

### Added
- **OpenTelemetry live mode:** `openTelemetryExporter(api, { live: true })` opens each span when the call starts and keeps it active while the call runs (across `await`). Spans from other instrumentation (database drivers, HTTP clients) then nest under traceperf's spans.
- `wrap(execution, run)` plugin hook, to run tracked code inside a context. A `wrap` that throws is reported once and skipped.
- **Auto-instrumentation** (each idempotent, each returns an uninstall function):
  - `instrumentFetch(tp)`: every `fetch()` call;
  - `instrumentHttp(tp)`: Node `http`/`https` `request` and `get`, which covers axios and got;
  - `instrumentMethods(tp, target, methods?, { prefix, labelFor })`: any client, e.g. `pg.Client.prototype.query`, with per-call labels;
  - `prismaExtension(tp)`: Prisma client extension.
- **`traceperf` CLI:** `npx traceperf report <trace.json | calls.jsonl> [--top N] [--sort ...] [--json]` prints per-label statistics and the slowest calls with their call path.
- **Bun and Deno** support, verified by a runtime smoke test in CI (nesting across `await` works on both).
- `docs/benchmarks.md`: overhead compared with `performance.now()`, `timerify` and OpenTelemetry spans (`npm run bench:compare`).
- `examples/playground`: an Express app with a deliberate N+1 query problem, with a StackBlitz link.
- Exported `TracedDecorator` and `Uninstall` types.

### Fixed
- The real `@opentelemetry/api` didn't type-check against `openTelemetryExporter` (also fixed in 0.3.0).

### Development
- CI publishes on `v*` tags with npm provenance, after every job passes, and checks that the tag matches `package.json` (see RELEASING.md).
- CI type-checks explicitly (`npm run typecheck`) and builds the TypeDoc API reference with warnings as errors (`npm run docs:api`).
- Added issue and PR templates, plus a public ROADMAP.md.

## [1.0.0] - not published separately (released in 1.3.0)

Breaking release that removes the legacy logging API. See [MIGRATION.md](MIGRATION.md). The tracking API is unchanged from 0.3.

### Removed
- The pre-0.2 logging layer, undocumented since 0.2.0: `Logger`, `ConfigManager`, the CLI/JSON/ASCII formatters, the old `ExecutionTracker`/`PerformanceMonitor` trackers, the color/timing/stack/string utilities, `DEFAULT_CONFIG`, `LOG_LEVEL_PRIORITY`, `MODE_MIN_LEVELS`, `COLORS`, `LEVEL_COLORS`, `LEVEL_ICONS`, `BOX_CHARS`, `PERFORMANCE_ICONS`, and the interfaces `ILogger`, `ILoggerConfig`, `IFormatter`, `ITransport`, `LogMeta`, `IExecutionTracker`, `IPerformanceMonitor`, `ITrackOptions`.
- The standalone `BrowserExecutionTracker` and `BrowserPerformanceMonitor` classes from `traceperf/browser`. Use `createTracePerf()` from `traceperf/browser` instead; `BrowserLogger` is unchanged.

### Changed
- `IBrowserTracePerfConfig` is `TracePerfConfig` plus `mode`, `performanceThreshold` and `logger`. It no longer accepts the old logger fields, which had no effect on tracking.
- `ITracePerfConfig` and `PerformanceMonitorOptions` are deprecated aliases of `TracePerfConfig`.
- The browser bundle is smaller (8.0 KB gzipped, down from 9.3 KB).
- `architecture.md` describes the current design.

## [0.3.0] - not published separately (released in 1.3.0)

### Added
- **Results API:** `onComplete(listener)` and `use(plugin)` (`onStart`/`onComplete` hooks) receive every finished call tree as an `ExecutionRecord` (ms: duration, self time, sync time, heap delta, error, args, children). A plugin that throws is reported once and never breaks the tracked code. A `reporter` option replaces console output, and `formatTree()` renders the default output.
- **Statistics:** `getStats()`, `printStats()`, `formatStats()`, `resetStats()`. Per label: count, errors, total, mean, min, max, p50/p95/p99 and mean self time. Memory is bounded (a 512-sample reservoir per label; at most 1,000 labels, the rest folded into `(other)`). Configure with `stats: { reservoirSize, maxLabels }`, or turn off with `stats: false`.
- **Exporters:**
  - `startTrace()` / `toChromeTrace()`: Perfetto / `chrome://tracing` / DevTools traces. Concurrent async work is placed on separate tracks.
  - `openTelemetryExporter(api)`: spans with real times, parent links and error status, parented to the active OpenTelemetry context. No dependency on `@opentelemetry/api`.
  - `jsonLinesExporter()`.
- **Self and sync time:** self time uses the union of child intervals, so concurrent children aren't double-counted. Async calls report the synchronous part that blocked the event loop. `DETAILED` output shows both and flags calls whose sync part reaches `blockingThreshold` (default 50 ms).
- `monitorEventLoop()`: event-loop delay percentiles (Node.js).
- **Spans:** `start(label)` with `run()`, `setLabel()` and `end()` for work that isn't a single function call.
- `@traced()` method decorator, for both TypeScript 5 standard decorators and legacy `experimentalDecorators`. There is also a `traced` export bound to the default instance.
- `trackObject(obj)`: a proxy that tracks methods, including prototype methods, while keeping state (even `#private` fields) on the original object.
- **Framework integrations:** `expressMiddleware`, `fastifyPlugin`, `honoMiddleware` and `withTracing` (for Next.js / fetch-style route handlers). Each gives one tree per request, labelled by route pattern.
- `enabled` option plus `enable()`, `disable()` and `isEnabled()`. When disabled, tracked functions are plain pass-through calls (~40 ns).
- `getTrackingMode()`.
- `dist/traceperf.browser.min.js`: the minified script-tag build (~9 KB gzipped).
- `typesVersions`, so `traceperf/browser` has types under `moduleResolution: "node"`.

### Changed
- The browser entry now runs on the same core as Node.js (`BrowserLogger` extends `OptimizedPerformanceMonitor`), so nesting, thresholds, sampling, statistics, hooks, exporters, `registerModule` and `setConfig` behave identically. The browser output format is unchanged, but browser calls in `PERFORMANCE` mode no longer print (as in Node.js). An explicit `threshold: 0` no longer marks every browser call `[SLOW]`.
- Options are strictly typed (`TrackOptions`, `TrackCallOptions`, `ModuleTrackOptions`, `TracePerfConfig`), and `trackingMode` only accepts the four mode names. Code that passed misspelled or unknown options now fails to type-check. Runtime behaviour is unchanged.
- In `PERFORMANCE` mode, calls now feed statistics and hooks; console output stays off.
- A negative heap delta is printed with `(gc)`.
- Per-call overhead is roughly halved. `track(fn)` no longer builds a wrapper per call: a tracked call without memory sampling now costs ~0.8 µs (was ~1.6 µs).
- No runtime dependencies (`uuid` removed).

### Fixed
- `require('traceperf')` threw a `SyntaxError` on Node.js 14/15 (the `uuid@11` dependency uses `??=`), despite `engines: >=14`.

### Development
- CI installs the packed tarball into fresh CJS, ESM, TypeScript (node10/nodenext/bundler) and esbuild projects (`npm run verify:package`), on Node 14–24 for the runtime checks.
- CI runs every README/docs example and compares its output (`npm run verify:docs`).
- CI runs publint and are-the-types-wrong (`npm run lint:package`), plus Playwright tests in Chromium, Firefox and WebKit (`npm run test:browser`).
- CI enforces overhead and bundle-size budgets (`npm run bench:check`), and lint fails on warnings.

## [0.2.2] - not published separately (released in 1.3.0)

### Fixed
- `import 'traceperf'` (ESM) failed with `ERR_MODULE_NOT_FOUND`. The ESM build is now real ESM (explicit `.js` extensions, `"type": "module"` scope) and no longer contains a `module.exports` shim that bundlers reject.
- TypeScript users on `moduleResolution: node16/nodenext` saw the default export as the whole module (`tp.track` did not type-check). The `exports` map now lists `types` first, with separate typings for `import` and `require`.
- `require('traceperf')` was missing most named exports declared in the type definitions (`getTimestamp`, `getMemoryUsage`, `OptimizedExecutionTracker`, `Logger`, ...).
- The documented `<script>` build `dist/traceperf.browser.js` (global `TracePerf`) did not exist. It is now built.
- `threshold` (instance or per call) did nothing: every call was printed. Calls shorter than their threshold (in ms) are now not reported. `threshold: 0` was also silently replaced by 100.
- Per-call `silent`, `trackMemory` and `trackingMode` options were ignored, including `registerModule(mod, { silent: true })`.
- `setSampleRate()` and `setConfig()` did not affect functions created earlier with `createTrackable()`/`registerModule()`.
- Nested tracked calls were never linked to their caller: each one printed separately, children before parents. Nested calls now form one tree, printed once when the outermost call finishes. On Node.js this also works across `await`.
- Tree output drew grandchildren as if they hung off the root; `│` connectors are now drawn.
- Memory leak: every finished execution and its return value were kept forever. Finished trees are now released.
- Tracked functions lost the caller's `this` (methods tracked via `createTrackable`/`registerModule` saw the internal tracker as `this`).
- Returning a non-promise thenable crashed with `Cannot read properties of undefined (reading 'catch')`; such values are now returned untouched.
- `captureArgs: true` threw on null-prototype objects. Arguments are now rendered safely and shown in the output, e.g. `getUser(123, {"cache":true})` (issue #1).
- Memory tracking added ~50µs per call by calling `process.memoryUsage()` twice; it now reads the V8 heap directly (~4.5µs per tracked call).
- Browser: async functions were timed only until they returned a promise; every `track()` reprinted the whole history (which also grew forever); nested `createTrackable` children printed before their parent finished; the documented `silent`, `trackMemory`, `threshold` and `logger` options were ignored and rejected by TypeScript; in SSR/workers each call emitted a `console.warn`.
- Example scripts in `examples/test/` loaded files that no longer exist, and the nested example in `examples/optimized-tracking-example.js` did not nest.
- `npm run lint` failed with 7 errors.

### Changed
- The default `threshold` is now 0 (report every call). The previous default of 100 was never applied, so output is unchanged for users who did not set a threshold.

## [0.2.0] - 2024-03-18

### Added
- New optimized performance monitoring implementation
- `TrackingMode` enum for balancing performance with detail level
- Memory usage tracking with detailed statistics
- Configurable sampling rate for production environments
- Custom threshold detection for identifying slow functions
- Enhanced tracking of nested function calls
- New `createTracePerf` factory function for creating customized instances
- Improved browser compatibility

### Changed
- Completely refactored the internal architecture for better performance
- Updated the API to focus on function execution tracking
- Enhanced visualization of execution flows
- Improved error handling and propagation
- Better TypeScript type definitions
- Optimized memory usage during tracking

### Removed
- Simplified logging API in favor of performance focused monitoring

## [0.1.6] - 2025-03-18

### Fixed
- Fixed memory tracking to never show negative values
- Improved memory usage calculation and display
- Fixed browser memory tracking in Chrome-based browsers
- Updated nested function tracking implementation
- Added comprehensive examples for memory tracking
- Added proper error handling for environments where memory tracking is not available

### Added
- Added memory tracking documentation to README
- Added memoryReleased field to better track memory behavior
- Added comprehensive test suite for memory tracking in different environments

### Changed
- Improved browser compatibility for memory tracking
- Enhanced formatMemorySize method for better human-readable output

## [0.1.5] - 2023-12-10

### Fixed
- Fixed implementation of nested function tracking
- Added proper support for the `createTrackable` method to reliably track nested function calls
- Improved code to maintain references to tracked functions
- Updated README.md with clearer examples of proper nested function tracking
- Removed misleading references to automatic tracking of nested function calls

### Added
- Added comprehensive test examples in `examples/test/` directory
- Added test for browser module CommonJS compatibility
- Added test for object methods tracking with proper `this` context
- Added example for disabling nested tracking with `enableNestedTracking` option

### Changed
- Clarified that `createTrackable` approach requires explicitly replacing function references
- Updated examples to show the most reliable patterns for nested function tracking
- Simplified API documentation for nested tracking options
- Renamed auto-tracking-example.js to nested-function-example.js to better reflect its purpose
- Updated README.md to reference the new example files

### Removed
- Removed unsupported `autoTracking` functionality that wasn't fully implemented
- Cleaned up unnecessary and redundant example files from the repository
- Removed redundant nested-tracking.js and execution-flow.js examples in favor of the more comprehensive nested-function-example.js

## [0.1.4] - 2025-03-16

### Added
- New `createTrackable` method for creating tracked versions of functions
- Improved nested function tracking with a simpler, more reliable approach
- Updated documentation with examples of nested function tracking
- New example file demonstrating nested function tracking

### Changed
- Simplified the execution tracking implementation
- Removed the experimental proxy-based tracking approach
- Updated the README with clearer examples and documentation

## [0.1.3] - 2025-03-16

### Added
- Automatic tracking of nested function calls without manual instrumentation
- New `autoTracking` option to control automatic function detection
- Source code analysis to identify and track nested function calls

### Enhanced
- Improved nested function detection with regex-based source code analysis
- Better handling of global scope functions in both Node.js and browser environments

## [0.1.2] - 2025-03-16

### Added
- Automatic tracking of nested function calls without manual instrumentation
- New `autoTracking` option to control automatic function detection
- Source code analysis to identify and track nested function calls
- Support for tracking nested function calls with two recommended approaches
- New `enableNestedTracking` option in `ITrackOptions` interface
- Comprehensive documentation for nested function tracking in README
- Example script demonstrating different approaches to nested function tracking

### Fixed
- Fixed issue with nested function calls not being properly tracked in execution flow
- Improved parent-child relationship tracking in execution records
- Enhanced flow chart visualization for nested function calls

## [0.1.1] - 2025-03-16

### Added
- Improved module compatibility for both CommonJS and ESM environments
- Added explicit CommonJS support in browser module
- Enhanced TypeScript configuration for better module interoperability

### Changed
- Updated browser module to use CommonJS format for better compatibility
- Improved export structure to support both `require()` and `import` syntax

### Fixed
- Fixed module resolution issues in different JavaScript environments
- Resolved potential compatibility issues with older bundlers

## [0.1.0] - 2025-03-16

### Added
- Initial release of TracePerf
- Core logging functionality with `info()`, `warn()`, `error()`, and `debug()` methods
- Execution flow tracking with ASCII visualization
- Performance monitoring with bottleneck detection
- Conditional logging modes (development, staging, production)
- Nested logging with group support
- Production optimization features
- Multiple output formats (CLI, JSON)
- Transport system for flexible output handling
- Comprehensive documentation and examples
- Browser support for frontend applications (React, Next.js)
- Comprehensive test suite with high coverage

### Changed
- N/A (initial release)

### Deprecated
- N/A (initial release)

### Removed
- N/A (initial release)

### Fixed
- N/A (initial release)

### Security
- N/A (initial release) 
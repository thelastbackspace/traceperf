# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - Unreleased

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

## [0.2.2] - Unreleased

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
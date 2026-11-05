# TracePerf

**See where the time goes in your code.** It prints the call tree while you develop, keeps cheap per-function statistics in production, and exports to Perfetto or OpenTelemetry when you need more.

[![npm version](https://img.shields.io/npm/v/traceperf.svg)](https://www.npmjs.com/package/traceperf)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

- **Call trees, not just timers.** Tracked calls inside tracked calls nest automatically, including across `await` on Node.js.
- **Honest numbers.** You get total, self and synchronous time for each call. Detailed mode flags calls that blocked the event loop.
- **Production-ready.** Stats are bounded per label (p50/p95/p99), sampling is built in, and `enabled: false` makes tracking a pass-through costing ~40 ns.
- **Gets data out.** Chrome/Perfetto traces, OpenTelemetry spans, JSON lines, or your own `onComplete` hook.
- **Fits your stack.** Express, Fastify, Hono, Next.js route handlers, decorators, CommonJS, ESM, TypeScript, browsers, Node.js 14+. There are no runtime dependencies.

> Upgrading from 0.x? The tracking API is unchanged; only the old undocumented logging classes were removed. See [MIGRATION.md](MIGRATION.md).

## Install

```bash
npm install traceperf
```

## Quick start

```javascript
const { createTracePerf } = require('traceperf');
const tp = createTracePerf();

const fetchUser = tp.createTrackable(async (id) => {
  await new Promise(r => setTimeout(r, 20)); // pretend this is a database call
  return { id };
}, { label: 'fetchUser' });

const render = tp.createTrackable((user) => `<h1>${user.id}</h1>`, { label: 'render' });

await tp.track(async () => render(await fetchUser(42)), { label: 'handleRequest' });
```

Prints one tree when the outermost call finishes:

```
└─ handleRequest: 26.412 ms 📊 +83.34 KB
  ├─ fetchUser: 20.312 ms 📊 +28.79 KB
  └─ render: 0.314 ms 📊 +1.53 KB
```

`📊` is the change in V8 heap during the call. A negative value is marked `(gc)`, because it means a garbage collection ran during the call.

ES modules work the same way:

```javascript
import tp, { createTracePerf, TrackingMode } from 'traceperf';

tp.track(() => JSON.parse('{"a":1}'), { label: 'parse' }); // the default instance
```

## Ways to track

```javascript
const { createTracePerf } = require('traceperf');
const tp = createTracePerf();

// 1. Wrap a function once, call it as usual (keeps `this`, name and length)
const add = tp.createTrackable((a, b) => a + b, { label: 'add' });
add(2, 3);

// 2. Track a single call
const total = tp.track(() => [1, 2, 3].reduce((a, b) => a + b), { label: 'sum' });

// 3. Track every method of an object or class instance (a proxy; state stays on the original)
class Cart {
  items = [];
  add(item) { this.items.push(item); return this.items.length; }
}
const cart = tp.trackObject(new Cart());
cart.add('book'); // reported as "Cart.add"

// 4. Track work that is not one function call (a "span")
const span = tp.start('import batch');
span.run(() => add(1, 1)); // tracked calls inside become children
span.end();
```

With TypeScript (or any decorator-capable build), methods can be decorated. Both TypeScript 5 standard decorators and legacy `experimentalDecorators` are supported:

```ts
import { traced } from 'traceperf';

class UserService {
  @traced()                       // label: "UserService.getUser"
  async getUser(id: string) { /* ... */ }

  @traced({ threshold: 50 })      // only report slow calls
  async search(q: string) { /* ... */ }
}
```

`registerModule(obj)` is still available. It returns a copy of a plain object with its own methods tracked; `trackObject` is usually the better choice.

## Nested tracking

Any tracked call made while another tracked call is running becomes its child. You don't need to pass anything through:

```javascript
const { createTracePerf } = require('traceperf');
const traceperf = createTracePerf({ trackMemory: false });

async function fetchData() {
  return traceperf.track(async () => {
    await new Promise(r => setTimeout(r, 10));
    return [1, 2, 3];
  }, { label: 'fetchData' });
}

function transformData(data) {
  return traceperf.track(() => data.map(x => x * 2), { label: 'transformData' });
}

async function processData() {
  return traceperf.track(async () => transformData(await fetchData()), { label: 'processData' });
}

processData();
```

```
└─ processData: 11.912 ms
  ├─ fetchData: 11.217 ms
  └─ transformData: 0.075 ms
```

On Node.js this uses `AsyncLocalStorage`, so children started after an `await` are attached correctly and concurrent requests never get mixed up. In browsers, nesting follows the synchronous call stack: calls made after the first `await` of a tracked async function become separate trees.

## Configuration

```javascript
const { createTracePerf, TrackingMode } = require('traceperf');

const tp = createTracePerf({
  trackingMode: TrackingMode.BALANCED, // PERFORMANCE | BALANCED (default) | DETAILED | DEBUG
  silent: false,            // no console output (stats, hooks and exporters still run)
  trackMemory: true,        // heap delta per call
  enableNestedTracking: true,
  threshold: 0,             // only report calls taking at least this many ms
  sampleRate: 1,            // fraction of calls to track (0..1)
  enabled: true,            // false: tracked functions are plain pass-through calls
  blockingThreshold: 50,    // DETAILED: flag calls whose sync part runs >= 50 ms
  stats: true,              // per-label statistics ({ reservoirSize, maxLabels } to tune)
});
```

Every option except `stats`, `plugins` and `reporter` can also be passed per call to `track`/`createTrackable` as `{ label, silent, trackMemory, trackingMode, threshold, sampleRate, captureArgs, enableNestedTracking }`. Anything you leave out follows the instance's current settings, so `tp.setConfig()`, `tp.enableSilentMode()` and `tp.setSampleRate()` also apply to functions wrapped earlier.

Options are strictly typed: `{ treshold: 50 }` doesn't compile.

### Tracking modes

| Mode | Console output | Memory | Use for |
|---|---|---|---|
| `PERFORMANCE` | none | no | production: stats, hooks and exporters only |
| `BALANCED` (default) | tree with duration and heap delta | yes | everyday development |
| `DETAILED` / `DEBUG` | adds self time, sync time, event-loop blocking and error messages | yes | finding the actual bottleneck |

`DETAILED` separates waiting from working:

```javascript
const { createTracePerf, TrackingMode } = require('traceperf');
const tp = createTracePerf({ trackingMode: TrackingMode.DETAILED, trackMemory: false });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const parseConfig = tp.createTrackable(() => {
  const start = Date.now();
  while (Date.now() - start < 60) {} // CPU-bound work
}, { label: 'parseConfig' });

await tp.track(async () => {
  parseConfig();
  await Promise.all([
    tp.track(() => sleep(30), { label: 'loadA' }),
    tp.track(() => sleep(30), { label: 'loadB' }),
  ]);
}, { label: 'startup' });
```

```
└─ startup: 93.880 ms (self 0.533 ms, sync 60.720 ms) ⚠ blocked event loop 60.720 ms
  ├─ parseConfig: 59.891 ms ⚠ blocked event loop 59.891 ms
  ├─ loadA: 29.756 ms (sync 0.200 ms)
  └─ loadB: 33.208 ms (sync 0.059 ms)
```

- **self**: time not covered by tracked children. Overlapping children (as with `Promise.all`) are counted once.
- **sync**: for async calls, the part that ran before the first `await`. That part blocks everything else.

### Thresholds

```javascript
const { createTracePerf } = require('traceperf');
const tracker = createTracePerf({ threshold: 50 }); // calls under 50 ms print nothing

tracker.track(slowFunction, { label: 'slowFunction' });        // reported if >= 50 ms
tracker.track(criticalFunction, { threshold: 10 });            // stricter for a hot path
tracker.track(backgroundTask, { threshold: 200 });             // looser for background work
```

```
└─ slowFunction: 60.950 ms 📊 +144.98 KB
```

### Logging arguments

```javascript
const { createTracePerf } = require('traceperf');
const tp = createTracePerf({ trackMemory: false });

const getUser = tp.createTrackable((id, opts) => ({ id }), { label: 'getUser', captureArgs: true });
getUser(123, { cache: true });
```

```
└─ getUser(123, {"cache":true}): 0.051 ms
```

Arguments are rendered safely and kept short. Circular, huge or exotic values never throw and never get walked in full.

## Statistics

Every tracked call (including in `PERFORMANCE` mode and when silent) feeds per-label statistics with bounded memory:

```javascript
const { createTracePerf } = require('traceperf');
const tp = createTracePerf({ silent: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const query = tp.createTrackable(async (ms) => sleep(ms), { label: 'db.query' });
const handler = tp.createTrackable(async () => { await query(2); await query(3); }, { label: 'GET /users' });

for (let i = 0; i < 20; i++) await handler();

tp.printStats();
console.log(tp.getStats('db.query').p95); // ms
```

```
label       calls  errors  total ms   mean    p50    p95    p99    max  self mean
----------  -----  ------  --------  -----  -----  -----  -----  -----  ---------
GET /users     20       0     119.6  5.979  5.761  7.207  8.257  8.257      0.134
db.query       40       0     116.9  2.922  3.124  4.189  4.782  4.782      2.922
```

`count`, `errors`, `total`, `min` and `max` are exact. Percentiles come from a 512-sample reservoir per label. Past 1,000 distinct labels, new labels are folded into `(other)`. `resetStats()` starts a new window.

## Getting data out

### Perfetto / Chrome trace

```javascript
const fs = require('fs');
const { createTracePerf } = require('traceperf');
const tp = createTracePerf({ silent: true });

const recording = tp.startTrace();
await tp.track(async () => {
  await Promise.all([1, 2, 3].map(i => tp.track(() => new Promise(r => setTimeout(r, 10 * i)), { label: `job ${i}` })));
}, { label: 'batch' });
fs.writeFileSync('trace.json', JSON.stringify(recording.stop()));
```

Open `trace.json` in [ui.perfetto.dev](https://ui.perfetto.dev), `chrome://tracing`, or the DevTools Performance panel. Concurrent async calls are put on separate tracks, so the flame chart stays valid.

### OpenTelemetry

<!-- docs:skip -->
```javascript
const otel = require('@opentelemetry/api');
const { createTracePerf, openTelemetryExporter } = require('traceperf');

const tp = createTracePerf({ silent: true, plugins: [openTelemetryExporter(otel)] });
```

Each finished tree becomes spans with the real start and end times, parent/child links, error status and `traceperf.*` attributes. Top-level spans are parented to the OpenTelemetry context that was active when the call started, so they join your existing request traces in Jaeger, Honeycomb, Datadog or Grafana. traceperf doesn't depend on `@opentelemetry/api`; you pass in the one your app uses.

### Hooks, JSON lines and custom output

```javascript
const { createTracePerf, jsonLinesExporter, formatTree } = require('traceperf');

const tp = createTracePerf({
  silent: true,
  plugins: [jsonLinesExporter(line => {})],          // one JSON document per finished tree
  onComplete: (root) => {                             // every finished top-level call
    if (root.duration > 100) console.warn(`slow: ${root.label}`);
  },
});

tp.use({ name: 'my-sink', onStart: (e) => {}, onComplete: (root) => {} }); // returns an unsubscribe function

// Replace console output entirely, e.g. to route it through your logger
const custom = createTracePerf({ reporter: (root) => console.log(formatTree(root)) });
custom.track(() => 1, { label: 'viaCustomReporter' });
```

Records (`ExecutionRecord`) contain `label`, `duration`, `selfDuration`, `syncDuration`, `async`, `memoryDelta`, `error`, `args`, `startEpochMs` and `children`, all in milliseconds. A plugin that throws is reported once and never breaks your code.

## Frameworks

One tree per request, labelled by route pattern, with everything tracked during the request nested under it. Responses with status ≥ 500 and thrown errors mark the request as failed.

<!-- docs:skip -->
```javascript
const { createTracePerf, expressMiddleware, fastifyPlugin, honoMiddleware, withTracing } = require('traceperf');
const tp = createTracePerf({ threshold: 100 }); // print only slow requests

app.use(expressMiddleware(tp));                      // Express / Connect
await fastify.register(fastifyPlugin(tp));           // Fastify
app.use('*', honoMiddleware(tp));                    // Hono
export const GET = withTracing(tp, async (req) => {  // Next.js route handlers, any fetch-style handler
  return Response.json(await loadUsers());
});
```

```
└─ GET /users/:id: 14.218 ms
  ├─ db.findUser: 6.021 ms
  └─ db.findPosts: 7.902 ms
```

## Production

```javascript
const { createTracePerf, TrackingMode } = require('traceperf');

const tp = createTracePerf(process.env.NODE_ENV === 'production'
  ? { trackingMode: TrackingMode.PERFORMANCE, sampleRate: 0.1 } // stats and exporters, no console
  : { trackingMode: TrackingMode.DETAILED });

tp.disable(); // kill switch: tracked functions become plain calls
tp.enable();
```

Overhead per call of a trivial function on Node 24 (`npm run bench`). CI fails the build if any of these regress past generous budgets.

| Scenario | Overhead |
|---|---|
| `enabled: false` / sampled out | ~40–60 ns |
| `PERFORMANCE` mode without nesting | ~0 (the function is returned as is) |
| tracked, no memory sampling, no nesting | ~0.8 µs |
| tracked, no memory sampling, with nesting | ~1.4 µs |
| tracked with memory sampling and nesting (default) | ~3.5–4.5 µs |

That's fine for request handlers, database calls and anything else that takes milliseconds. For tight loops called millions of times, track the loop rather than each iteration, or use `sampleRate`.

### Event-loop delay

```javascript
const { monitorEventLoop } = require('traceperf');

const loop = monitorEventLoop();
setTimeout(() => {
  console.log(loop.stats()); // { min, max, mean, stddev, p50, p90, p99 } in ms
  loop.stop();
}, 100);
```

A tracked call tells you how long *it* took. Event-loop delay tells you whether something blocked everything else. This is Node.js only; elsewhere `supported` is `false`.

## Browser

```javascript
import { createTracePerf } from 'traceperf/browser';

const tracker = createTracePerf({ threshold: 16 }); // only calls longer than a frame

tracker.track(() => {
  document.getElementById('output').textContent = 'Updated';
}, { label: 'updateDOM' });
```

The browser entry shares the core with Node.js, so options, nesting, statistics, hooks and exporters all work the same. It adds `info`/`warn`/`error`/`debug`/`group` logging methods and prints in a browser-friendly format:

```
Execution Flow:
→ updateDOM (21.14ms)
```

Without a bundler, use the script-tag build (`dist/traceperf.browser.min.js`, about 9 KB gzipped), which defines a global `TracePerf`:

```html
<script src="https://unpkg.com/traceperf/dist/traceperf.browser.min.js"></script>
<script>
  const { createTracePerf, TrackingMode } = TracePerf;
  const browserTracker = createTracePerf({ trackingMode: TrackingMode.BALANCED });

  browserTracker.track(() => {
    document.getElementById('output').textContent = 'Updated';
  }, { label: 'domOperation' });
</script>
```

Memory deltas are shown only where the browser exposes `performance.memory` (Chromium).

## How it compares

| | Call tree | Async-aware nesting | Per-label stats | Production use | Export | Setup |
|---|---|---|---|---|---|---|
| `console.time` | no | no | no | no | no | none |
| `performance.timerify` (Node) | no | no | via observer | yes | no | some |
| clinic.js / 0x | sampled flame graph | n/a | no | no (offline profiling) | own UI | run app under the tool |
| OpenTelemetry SDK | yes (spans) | yes | via backend | yes | everywhere | SDK + exporter + collector |
| **traceperf** | yes | yes (Node) | yes | yes (sampling, kill switch) | Perfetto, OTel, JSON | one import |

Use a sampling profiler (clinic.js, `--cpu-prof`) when you don't know where to look. Use traceperf when you want to measure specific functions, requests or spans continuously, in development and in production. If you already run OpenTelemetry, traceperf can feed it.

## Compatibility

- **Node.js** 14+ (tested on 14, 16, 18, 20, 22 and 24), plus current Chromium, Firefox and WebKit.
- **Module formats:** CommonJS (`require`), ESM (`import`), TypeScript (`node10`, `node16`/`nodenext` and `bundler` resolution), bundlers (esbuild, webpack, Vite, ...), and `<script>`.
- **Runtime dependencies:** none.

## Limitations

- In browsers (and ESM on Node < 20.16), nesting doesn't survive `await`, because there is no `AsyncLocalStorage`.
- The heap delta is the V8 heap difference across the call. Other concurrent work and GC affect it, so treat it as a hint, not an allocation profile.
- `require('traceperf')` and `import 'traceperf'` each have their own default instance. Instances you create with `createTracePerf()` are unaffected.
- OpenTelemetry spans are created when the top-level call finishes. They are linked to the active context at the start, but downstream auto-instrumented spans don't see a live traceperf span as their parent.

## Examples

- `examples/optimized-tracking-example.js`: the basics.
- `examples/stats-and-export.js`: statistics, spans, a Perfetto trace and JSON lines in a production-style setup.
- `examples/browser-example.html` / `.js`: browser usage.
- `examples/test/edge-case-tests.js`: deep async nesting, memory churn, sampling, error propagation.
- `examples/test/final-benchmark.js`: overhead by tracking mode.

## Contributing

`npm ci && npm run build:all && npm test && npm run lint` covers the basics. CI also runs:

- `npm run verify:package`: installs the packed tarball into fresh CJS, ESM, TypeScript and bundler projects.
- `npm run verify:docs`: runs every example in this README and checks its output.
- `npm run test:browser`: Playwright tests in Chromium, Firefox and WebKit.
- `npm run bench:check`: overhead and bundle-size budgets.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

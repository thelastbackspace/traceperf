# TracePerf

**See where the time goes in your code.** It prints the call tree while you develop, keeps cheap per-function statistics in production, and exports to Perfetto or OpenTelemetry when you need more.

[![npm version](https://img.shields.io/npm/v/traceperf.svg)](https://www.npmjs.com/package/traceperf)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

![traceperf output: a request's call tree with self and sync time, a blocked-event-loop warning and a stats table](docs/assets/terminal.svg)

- **No code changes needed.** `node --require traceperf/auto app.js` tracks every request, outgoing call and database query, and tells you why slow requests were slow when the process exits.
- **Explains, not just measures.** `traceperf explain` points out blocked event loops (and which function blocked it), awaits that could run in parallel and N+1 queries.
- **Call trees, not just timers.** Tracked calls inside tracked calls nest automatically, including across `await` on Node.js.
- **Honest numbers.** You get total, self and synchronous time for each call. Detailed mode flags calls that blocked the event loop.
- **Production-ready.** Stats are bounded per label (p50/p95/p99), sampling is built in, and `enabled: false` makes tracking a pass-through costing ~40 ns.
- **Gets data out.** Chrome/Perfetto traces, OpenTelemetry spans, JSON lines, or your own `onComplete` hook.
- **Zero-effort coverage.** One line tracks every `fetch`, HTTP request or query, for pg, mysql2, mysql, MongoDB/Mongoose, ioredis, node-redis, Prisma, better-sqlite3 (and Drizzle, Sequelize and Knex on any of these drivers) and the AWS SDK.
- **Built for teams.** It feeds Prometheus, catches regressions in CI (`traceperf compare --fail`), shows up in Chrome DevTools, and produces HTML flame-chart reports.
- **Fits your stack.** Express, Fastify, Hono, Koa, NestJS, Next.js route handlers, decorators, CommonJS, ESM, TypeScript, browsers, Node.js 14+, Bun, Deno, Cloudflare Workers and Vercel Edge. There are no runtime dependencies.

Try it in the browser: [the playground](examples/playground) is an Express API with a hidden N+1 query problem.

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

## Why is my API slow? `traceperf run`

One command, no code changes. It starts your app with tracking on, sends it concurrent traffic, and tells you why requests were slow:

```bash
npx traceperf run server.js --path /report --path /users
```

```
traceperf: sending 5 s of traffic to /report, /users on port 3000, 10 at a time

load: 230 requests in 5.0 s (46/s), 230× 200
...per-route and per-query p50/p95/p99...

Why it was slow:
🔥 GET /report ran 48 ms of synchronous code, blocking everything else in the process for that long; CPU time: buildReport (server.js:10) 100%
⏳ GET /users waited ~165 ms (95% of its 174 ms) while GET /report blocked the event loop, in buildReport (server.js:10)
● SELECT * FROM users took 100% of GET /users (174 ms of 174 ms), but ~165 ms of that was waiting for blocking code elsewhere
```

The database was fast; `buildReport` was blocking it. That only shows up when requests overlap, which is why `run` sends concurrent traffic.

- **The blocking function is named even though nothing tracks it:** `run` samples the CPU (the V8 profiler) during the synchronous part of each blocking call. Native work is named by the app function that called it (`hashPassword → pbkdf2Sync`), code V8 inlined is credited to the inlined function, and garbage-collection pauses are reported as such. `--no-profile` turns this off.
- **Queueing the app can't see:** a request that arrives while the event loop is blocked waits in the socket before its handler starts. `run` compares what its clients waited with the app's own timings and reports the difference.
- **What each request costs:** `run` measures how busy the event loop was during the load and where the CPU went. When requests are expensive it says what that means and what helps, for the libraries it recognises (Mongoose, TypeORM, Sequelize, Prisma, Express, class-validator…):

  ```
  🔥 Each request keeps the event loop busy ~10.7 ms, so one process tops out near 94 requests/s … CPU time went to:
     getProperty (node_modules/mongoose/lib/helpers/get.js:63) 19%, cloneObject (…/clone.js:120) 17%, (garbage collection) 15%
     fix: Mongoose is building full documents: add .lean() to read-only queries … and .select() only the fields you send
  ```
- **Timings you can trust:** after the warm-up, `run` sends a few requests one at a time (`--probe`) and takes the per-request findings (a call taking most of a request, sequential awaits, N+1) from those. Under concurrent load every `await` also waits for the busy event loop, which makes fast queries look slow.
- **Wrong setup is said first:** "2117 of 2117 responses failed (most: 401 Unauthorized)…" instead of timings of error pages.

Checked on real apps, not only on the planted ones: Prisma's REST example, the RealWorld API (Express + Prisma), an Express + Mongoose boilerplate and a NestJS + TypeORM app.

- `--path /x` (repeatable): what to request. Without `--path`, use the app yourself and press Ctrl-C for the report.
- `-c 10` concurrency, `-d 5s` duration or `-n 500` requests, `--method POST`, `--port 3000` (detected by default).
- `-H "Authorization: Bearer $TOKEN"` (repeatable): request headers, for APIs behind a login.
- `--probe 10`: requests per path sent one at a time before the load (0 for none).
- `--html report.html`, `--output calls.jsonl` (keep the trees), `--json`.
- `--warmup 3`: untimed requests per path first, so cold-start work doesn't look like a problem.
- `--no-profile`: don't sample the CPU.
- Any start command works: `npx traceperf run -- npm start`.
- `--config file.json`: read the options from a file (`traceperf.config.json` is read automatically when present). Options given on the command line win.

**Config file and login.** Put the routes in `traceperf.config.json` so the command is just `npx traceperf run`. A `login` step runs once before the traffic, and its token (or cookie) is sent with every request, so an expired token can't silently turn the run into a benchmark of 401 pages. `${NAME}` is read from the environment:

<!-- docs:skip -->
```json
{
  "app": "dist/server.js",
  "paths": ["/api/articles", "/api/user"],
  "login": {
    "path": "/api/users/login",
    "body": { "user": { "email": "${TEST_EMAIL}", "password": "${TEST_PASSWORD}" } },
    "token": "user.token",
    "prefix": "Token "
  }
}
```

`token` is the dotted path of the token in the JSON response, sent as `authorization: Bearer <token>` unless `header` / `prefix` say otherwise. Leave `token` out to use the cookies the login sets. `method` defaults to POST.

### In CI: fail a PR that adds queries

Timings are too noisy to gate a PR on (the same run can be twice as fast on an idle machine), but how many queries a route makes per request is exact. Save a baseline once, commit it, and compare on every PR:

<!-- docs:skip -->
```bash
npx traceperf run server.js --path /orders --path /users/1 --save-baseline perf-baseline.json
npx traceperf run server.js --path /orders --path /users/1 --baseline perf-baseline.json   # exit 1 on regressions
```

```
Compared with perf-baseline.json:
  ✖ GET /orders: pg SELECT items 1 → 12 per request (an N+1?)
  ✖ new problem: N+1 in GET /orders
```

It fails when a route makes more calls of any kind per request (database queries, HTTP calls, Redis commands) or an N+1 or error appears; fewer calls are reported as improvements. Counts come from the one-at-a-time requests, so they don't depend on the machine. In GitHub Actions, with a service container for the database:

<!-- docs:skip -->
```yaml
- run: npm ci && npm run db:seed
- run: npx traceperf run dist/server.js --path /orders --path /users/1 --baseline perf-baseline.json
```

`examples/slow-apps/` has 20 small apps: 12 with one planted problem each (blocking in your code and in built-ins, sequential awaits, N+1 over SQL and over HTTP, a slow or flaky dependency, failing requests…) and 8 clean ones where the right answer is "no issues". `npm run eval` scores `run` on them, and CI fails on a missed problem or a false alarm.

The same naming works without `run`: `TRACEPERF_PROFILE_BLOCKING=1 node --require traceperf/auto server.js` adds the function names to the exit summary (sampling costs a few percent CPU, so use it while investigating). In code: `profileSlowCalls({ select: root => blockingRanges(root), mergeInlined: true, onProfile })`, then `explain(roots, { hotspots })`.

## No code changes: `traceperf/auto`

Start your app with traceperf preloaded. Every incoming HTTP request becomes a tree, with the outgoing `http`/`fetch` calls and the `pg`, `mysql2`, `mysql`, MongoDB/Mongoose, `ioredis`, `redis`, Prisma and `better-sqlite3` queries it made nested under it (Drizzle, Sequelize and Knex run on these drivers, so their queries show up too):

<!-- docs:skip -->
```bash
node --require traceperf/auto server.js            # CommonJS or ESM apps
node --import traceperf/auto server.mjs            # ESM, Node.js >= 18.19
NODE_OPTIONS="--require traceperf/auto" npm start  # through any script
```

```
traceperf: tracking server, http, fetch, pg
└─ GET /users/:id: 84.112 ms
  ├─ pg SELECT users: 12.331 ms
  └─ fetch GET billing.internal/invoices: 70.950 ms
```

When the process exits (including Ctrl-C), it prints the statistics table and an explanation of what made calls slow (see [`traceperf explain`](#why-was-it-slow-traceperf-explain)). Ids in paths are collapsed (`/users/42` becomes `/users/:id`), so labels stay few.

Database clients are only instrumented when your `package.json` lists them. Configure it with environment variables:

| Variable | Effect |
|---|---|
| `TRACEPERF_OUTPUT=calls.jsonl` | Append every request tree as JSON lines (for `traceperf report`, `explain`, `compare`, `watch`). Console trees are then off. |
| `TRACEPERF_THRESHOLD=50` | Only report calls taking at least 50 ms |
| `TRACEPERF_SAMPLE_RATE=0.1` | Track 10% of requests |
| `TRACEPERF_IGNORE=^/health` | Regular expression of request paths not to track |
| `TRACEPERF_DISABLE=http,fetch` | Skip targets: `server`, `http`, `fetch`, `pg`, `mysql2`, `mongodb`, `ioredis`, `prisma`, `better-sqlite3`, `mysql`, `redis` |
| `TRACEPERF_SILENT=1` / `TRACEPERF_SUMMARY=0` / `TRACEPERF_QUIET=1` | No per-request trees / no exit summary / no startup line |
| `TRACEPERF_ENABLED=0` | Load nothing |

Your own `tp.track(...)` calls (with `require('traceperf')` or `import tp from 'traceperf'`) nest inside the request trees too. In code, the same thing is `autoInstrument(tp)`, and request tracking alone is `instrumentHttpServer(tp)`. Don't combine it with a framework middleware from [Frameworks](#frameworks), or each request is tracked twice.

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

## Auto-instrumentation

Track I/O without wrapping each call. Every `instrument*` call patches in place, is safe to call twice, and returns an uninstall function.

```javascript
const { createTracePerf, instrumentFetch, instrumentHttp, instrumentMethods } = require('traceperf');
const tp = createTracePerf({ trackMemory: false });

instrumentFetch(tp);   // every fetch(): "fetch GET api.example.com/users"
instrumentHttp(tp);    // node http/https (axios, got, ...): "http GET api.example.com/users"

// Any client: patch its prototype, with per-call labels
class Db { async query(sql) { return []; } }
instrumentMethods(tp, Db.prototype, ['query'], {
  labelFor: (_method, [sql]) => `db ${String(sql).trim().split(/\s+/)[0]}`, // "db SELECT"
});

await tp.track(async () => { await new Db().query('SELECT * FROM users'); }, { label: 'handler' });
```

```
└─ handler: 0.112 ms
  └─ db SELECT: 0.031 ms
```

Ready-made helpers for popular clients. Pass the module you already use; traceperf doesn't depend on any of them:

<!-- docs:skip -->
```javascript
const { instrumentPg, instrumentMysql2, instrumentMysql, instrumentMongo, instrumentRedis, instrumentAwsClient, instrumentPrisma, instrumentBetterSqlite3, prismaExtension } = require('traceperf');

instrumentPg(tp, require('pg'));                    // "pg SELECT users" (Pool.query included)
instrumentMysql2(tp, require('mysql2'));            // "mysql UPDATE orders" (callback and promise APIs)
instrumentMysql(tp, require('mysql'));              // the classic driver: connections and pools
instrumentMongo(tp, require('mongodb'));            // "mongo find users", "mongo insertOne users"
instrumentMongo(tp, require('mongoose').mongo);     // Mongoose uses its own copy of the driver
instrumentRedis(tp, require('ioredis'));            // "redis GET"
instrumentNodeRedis(tp, require('redis'));          // "redis GET" (node-redis 4/5, MULTI/pipeline commands one by one)
instrumentPrisma(tp, require('@prisma/client'));    // "prisma.User.findMany" (every client, $extends included)
instrumentBetterSqlite3(tp, require('better-sqlite3')); // "sqlite SELECT users" (synchronous: slow ones show as blocking)
instrumentAwsClient(tp, s3Client);                  // "aws S3.GetObject"
const prisma = new PrismaClient().$extends(prismaExtension(tp)); // "prisma.User.findMany"
```

SQL labels are the verb plus the first table (`sqlLabel()`), never the values, so stats stay grouped. These are tested against the real client libraries, with Postgres and MongoDB running for real.

`fetch` timing ends when the response headers arrive. `http` timing ends when the body has been read. Responses with status ≥ 500 mark the call failed.

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

## Why was it slow? `traceperf explain`

`explain()` reads finished trees and says, in plain English, what probably made them slow:

```javascript
const { createTracePerf, explain, formatFindings } = require('traceperf');
const roots = [];
const tp = createTracePerf({ silent: true, onComplete: r => roots.push(r) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getUser = tp.createTrackable(() => sleep(20), { label: 'getUser' });
const getOrders = tp.createTrackable(() => sleep(30), { label: 'getOrders' });
const getPrice = tp.createTrackable(() => sleep(2), { label: 'pg SELECT prices' });

await tp.track(async () => {
  await getUser();
  await getOrders();
  for (let i = 0; i < 10; i++) await getPrice();
}, { label: 'GET /dashboard' });

console.log(formatFindings(explain(roots)));
```

```
⇉ GET /dashboard awaited 12 calls one after another (getUser, getOrders, pg SELECT prices, pg SELECT prices, ...: 78 ms); if they are independent, Promise.all could save up to ~47 ms
🔁 GET /dashboard called pg SELECT prices 10 times (27 ms total); batching them into one call may help (N+1 pattern)
```

It looks for:

- **Blocked event loop:** "req2 waited ~60 ms while `cpu` in req1, req3 blocked the event loop". Synchronous work in one request delays every other request, and it names the function that did it.
- **Sequential awaits** that could run in parallel, with the most time `Promise.all` could save.
- **Repeated calls** under one parent (N+1 queries).
- **A dominant child**, or time spent outside any tracked call.
- **Errors**, reported once, where they happened.

The same works on saved data: `traceperf explain calls.jsonl` (or a Chrome trace, or `-` for stdin), with `--json`, `--max N`, `--blocking ms` and `--min ms`. Findings are heuristics with their numbers, so check them against the tree before acting on them.

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

**Live mode** (`openTelemetryExporter(otel, { live: true })`) opens each span when the call starts and makes it the active context while the call runs, across `await`. Spans created by your other instrumentation (pg, http, Redis) then appear inside traceperf's spans.

### Prometheus

```javascript
const { createTracePerf, prometheusExporter } = require('traceperf');

const prom = prometheusExporter();
const tp = createTracePerf({ silent: true, plugins: [prom] });
tp.track(() => JSON.stringify({ ok: true }), { label: 'serialize' });

// app.get('/metrics', prom.handler);
console.log(prom.metrics().split('\n').filter(l => l.includes('_count')).join('\n'));
```

```
traceperf_call_duration_seconds_count{name="serialize"} 1
```

This exposes a `traceperf_call_duration_seconds` histogram and a `traceperf_call_errors_total` counter per label. Use `rootsOnly: true` for request-level metrics only.

### Slow-call alerts

```javascript
const { createTracePerf } = require('traceperf');
const tp = createTracePerf({ silent: true });

tp.onSlow({ 'db.query': 50, '*': 500 }, (call, root) => {
  console.warn(`slow: ${call.label} took ${call.duration.toFixed(0)} ms (in ${root.label})`);
});
```

`onSlow` checks every call in each finished tree, nested ones included, in every mode.

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
const { createTracePerf, expressMiddleware, fastifyPlugin, honoMiddleware, koaMiddleware, nestInterceptor, withTracing } = require('traceperf');
const tp = createTracePerf({ threshold: 100 }); // print only slow requests

app.use(expressMiddleware(tp));                      // Express / Connect
await fastify.register(fastifyPlugin(tp));           // Fastify
app.use('*', honoMiddleware(tp));                    // Hono
app.use(koaMiddleware(tp));                          // Koa
nestApp.useGlobalInterceptors(nestInterceptor(tp));  // NestJS
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

Overhead per call of a trivial function on Node 24 (`npm run bench`). CI fails the build if any of these regress past generous budgets. For a comparison with `performance.now()`, `timerify` and OpenTelemetry spans, see [docs/benchmarks.md](docs/benchmarks.md).

| Scenario | Overhead |
|---|---|
| `enabled: false` / sampled out | ~40–60 ns |
| `PERFORMANCE` mode without nesting | ~0 (the function is returned as is) |
| tracked, no memory sampling, no nesting | ~0.8 µs |
| tracked, no memory sampling, with nesting | ~1.4 µs |
| tracked with memory sampling and nesting (default) | ~3.5–4.5 µs |

That's fine for request handlers, database calls and anything else that takes milliseconds. For tight loops called millions of times, track the loop rather than each iteration, or use `sampleRate`.

Safe settings, what each feature costs and how to roll traceperf out to a service are in [docs/production.md](docs/production.md).

### Analyzing saved data: `traceperf report`

```bash
npx traceperf report trace.json          # from startTrace().stop()
npx traceperf report calls.jsonl --top 5 --sort p95   # from jsonLinesExporter()
```

```
120 calls, 3 labels (sorted by total)

label         calls  errors  total ms   mean    p50    p95    p99    max  self mean
...
Slowest 5 calls:
  95.212 ms  GET /users > db.query
```

Add `--json` for machine-readable output. A file of `-` reads stdin.

### Comparing runs: `traceperf compare`

Record a JSON-lines log before and after a change (or on `main` and on a PR), then:

```bash
npx traceperf compare before.jsonl after.jsonl --metric p95 --threshold 10 --fail
```

```
label       before p95  after p95  change  status
----------  ----------  ---------  ------  ---------
db.query         4.741      8.795  +85.5%  regressed
render           1.886      1.966   +4.2%  unchanged
```

`--fail` exits with code 1 when anything regressed, so it can gate CI. Changes under `--min-delta` (0.5 ms by default) are ignored, so tiny functions don't fail builds on noise.

### Reports and live view

```bash
npx traceperf report trace.json --html report.html   # one self-contained file: findings linked to the flame chart, stats, slowest calls
npx traceperf watch calls.jsonl                      # live top-style view while the app writes the log
```

### Allocation profiling

The `📊` heap delta is a hint. For real numbers, profile the allocations of a function:

```javascript
const { profileAllocations } = require('traceperf');

const { allocatedBytes, sites } = await profileAllocations(() => {
  const rows = [];
  for (let i = 0; i < 10000; i++) rows.push({ id: i, label: `row ${i}` });
  return rows.length;
});
console.log(allocatedBytes > 0, typeof sites[0].functionName); // allocated bytes and the top allocation sites
```

```
true string
```

This uses V8's sampling heap profiler through `node:inspector` and counts objects that were collected again (on Node 20+, see `countsCollected`).

### CPU hotspots for slow calls

Tracking shows *which call* was slow; `profileSlowCalls` shows *which lines* were busy during it, including code you never wrapped. It runs the V8 sampling profiler and, for every top-level call over the threshold, reports the functions that used the CPU:

<!-- docs:skip -->
```javascript
const { createTracePerf, profileSlowCalls, formatHotspots } = require('traceperf');
const tp = createTracePerf();
tp.use(profileSlowCalls({
  threshold: 200,                                      // ms
  onProfile: (call, profile) => console.log(`${call.label}\n${formatHotspots(profile)}`),
}));
```

```
POST /import: 438 ms
    315.0 ms  parseRows  /app/src/csv.js:18
    121.1 ms  hashRow  /app/src/hash.js:4
  cpu 436.0 ms, idle 0.0 ms, gc 2.4 ms
```

`idle` is time spent waiting for I/O or timers, so a slow call with a high idle time is waiting on something rather than computing. Results arrive when the profiler window closes (`window`, default 2 s; `flush()` forces it). Samples are process-wide, so concurrent work during the call shows up too. Sampling costs a few percent of CPU: turn it on while investigating, or on some instances only. Node.js only; `profiler.available` is false elsewhere.

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

### In Chrome DevTools

```javascript
import { createTracePerf, performanceTimeline } from 'traceperf/browser';

const tp = createTracePerf({ silent: true, plugins: [performanceTimeline()] });
tp.track(() => [3, 1, 2].sort(), { label: 'sortItems' });
```

Every tracked call becomes a `performance.measure()` entry. In Chrome 129+ these appear on a **traceperf** track in the Performance panel, with failed calls in red and duration, self and sync time in the tooltip. Elsewhere (including Node.js) they appear as User Timing entries. Entries are cleared after emitting, so long-running pages don't accumulate them; DevTools recordings still capture them.

### Edge runtimes

Cloudflare Workers and Vercel Edge work as-is. Nesting across `await` uses `AsyncLocalStorage`, which traceperf detects automatically where it is a global (Next.js Edge, Workers with `nodejs_compat`). Anywhere else, pass it in:

<!-- docs:skip -->
```javascript
import { AsyncLocalStorage } from 'node:async_hooks';
const tp = createTracePerf({ asyncLocalStorage: AsyncLocalStorage });
```

Workers deliberately coarsen timers (time only advances on I/O), so durations there are only approximate.

## How it compares

| | Call tree | Async-aware nesting | Per-label stats | Production use | Export | Setup |
|---|---|---|---|---|---|---|
| `console.time` | no | no | no | no | no | none |
| `performance.timerify` (Node) | no | no | via observer | yes | no | some |
| clinic.js / 0x | sampled flame graph | n/a | no | no (offline profiling) | own UI | run app under the tool |
| OpenTelemetry SDK | yes (spans) | yes | via backend | yes | everywhere | SDK + exporter + collector |
| **traceperf** | yes | yes (Node) | yes | yes (sampling, kill switch) | Perfetto, OTel, Prometheus, JSON | none (`--require traceperf/auto`) or one import |

Use a sampling profiler (clinic.js, `--cpu-prof`) when you don't know where to look, or let `profileSlowCalls` run one only around slow calls. Use traceperf when you want to measure specific functions, requests or spans continuously, in development and in production. If you already run OpenTelemetry, traceperf can feed it. A longer, honest comparison is in [docs/comparison.md](docs/comparison.md).

## Compatibility

- **Node.js** 14+ (tested on 14, 16, 18, 20, 22 and 24), **Bun**, **Deno**, **Cloudflare Workers** (workerd) and **Vercel Edge** (edge-runtime). Nesting across `await` works on all of them. Also tested in current Chromium, Firefox and WebKit.
- **Module formats:** CommonJS (`require`), ESM (`import`), TypeScript (`node10`, `node16`/`nodenext` and `bundler` resolution), bundlers (esbuild, webpack, Vite, ...), and `<script>`.
- **Runtime dependencies:** none.

## Limitations

- In browsers (and ESM on Node < 20.16), nesting doesn't survive `await`, because there is no `AsyncLocalStorage`. On those Node versions, starting with `--import traceperf/auto` fixes it.
- The heap delta is the V8 heap difference across the call. Other concurrent work and GC affect it, so treat it as a hint, not an allocation profile.
- `traceperf/auto` tracks Node's `http`/`https` servers (which Express, Fastify, Koa, Nest and most frameworks use), not `http2` or uWebSockets.js servers. AWS SDK clients still need `instrumentAwsClient(tp, client)`.
- `explain()` only sees tracked calls: it can say a request was delayed by blocking code, but names the function only if that function is tracked. `profileSlowCalls` finds untracked hot code.
- In the default OpenTelemetry mode, spans are created when the top-level call finishes. Use `{ live: true }` if other instrumentation's spans should nest inside traceperf's.
- `fetch` instrumentation times the request until the response headers arrive, not the time spent reading the body.

## Examples

- `examples/slow-apps/`: five small apps, one planted performance problem each; try `npx traceperf run examples/slow-apps/n-plus-one/server.js --path /orders`.
- `examples/playground/`: an Express app with a hidden N+1 query problem.
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
- `npm run test:runtimes`: smoke tests on Bun and Deno.
- `npm run docs:api`: the API reference (TypeDoc).

What's planned is in [ROADMAP.md](ROADMAP.md).

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

# Known-slow apps

Each app has one planted performance problem. `traceperf run` should name it:

| App | Planted problem | Try |
|---|---|---|
| `blocking/` | `GET /report` runs ~40 ms of synchronous code; other requests wait for it | `npx traceperf run examples/slow-apps/blocking/server.js --path /report --path /users` |
| `blocking-native/` | `JSON.stringify` of a big object and `crypto.pbkdf2Sync` block `GET /ping`; the profiler names the calling functions | `... blocking-native/server.js --path /export --path /login --path /ping` |
| `sequential/` | three independent queries awaited one after another | `... sequential/server.js --path /dashboard` |
| `n-plus-one/` | one query per order instead of one batched query | `... n-plus-one/server.js --path /orders` |
| `slow-dependency/` | one downstream call takes nearly all the time | `... slow-dependency/server.js --path /checkout` |
| `errors/` | one in three payment calls fails | `... errors/server.js --path /pay` |
| `blocking-zlib/` | `zlib.gzipSync` of 10 MB blocks `GET /health` | `... blocking-zlib/server.js --path /backup --path /health` |
| `cpu-json/` | ~15 ms of JSON work per request | `... cpu-json/server.js --path /catalogue` |
| `http-n-plus-one/` | one `fetch` per product to a pricing service | `... http-n-plus-one/server.js --path /products` |
| `parallel-n-plus-one/` | one query per user, fired with `Promise.all` | `... parallel-n-plus-one/server.js --path /team` |
| `failing-route/` | every request fails, so timings describe the error path | `... failing-route/server.js --path /invoices` |
| `flaky-dependency/` | one call in four to a dependency takes 120 ms | `... flaky-dependency/server.js --path /quote` |
| `clean-*/` (8 apps) | nothing: CRUD, batched, `Promise.all`, auth middleware, dependent queries, cached, static, fast loop | |

Apps named `clean-*` have no problem: the right answer is "no issues", and any finding there is a false alarm.

`npm run eval` scores every app: planted problems found, clean apps with no findings, and false alarms (findings that match no expectation). CI fails on any miss or false alarm. `allow` in `cases.json` lists findings that are true but not the point of the case (`note` says why).

`cases.json` lists what each app should produce; `src/__tests__/run.test.ts` runs every app and fails if `explain` misses the planted cause. When you improve `explain`, add an app here first.

`db.js` stands in for a database client with tracked async calls; real apps get the same trees from `traceperf/auto`'s pg, mysql2, MongoDB and Redis instrumentation.

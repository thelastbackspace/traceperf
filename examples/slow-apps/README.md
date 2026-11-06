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

`cases.json` lists what each app should produce; `src/__tests__/run.test.ts` runs every app and fails if `explain` misses the planted cause. When you improve `explain`, add an app here first.

`db.js` stands in for a database client with tracked async calls; real apps get the same trees from `traceperf/auto`'s pg, mysql2, MongoDB and Redis instrumentation.

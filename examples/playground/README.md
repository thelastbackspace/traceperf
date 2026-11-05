# traceperf playground

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/thelastbackspace/traceperf/tree/main/examples/playground?file=server.js)

An Express API with a hidden performance problem. Run it, open `/orders`, and read the tree traceperf prints.

```bash
npm install
npm start
```

`GET /orders` prints:

```
└─ GET /orders: 59.912 ms (self 1.204 ms, sync 0.512 ms)
  ├─ db.listOrders: 8.931 ms (sync 0.061 ms)
  ├─ db.getCustomer: 8.402 ms (sync 0.030 ms)
  ├─ db.getCustomer: 8.317 ms (sync 0.028 ms)
  ├─ db.getCustomer: 8.288 ms (sync 0.027 ms)
  ├─ db.getCustomer: 8.302 ms (sync 0.026 ms)
  ├─ db.getCustomer: 8.297 ms (sync 0.027 ms)
  └─ db.getCustomer: 8.311 ms (sync 0.026 ms)
```

That's one customer query per order, run one after another: the "N+1 queries" problem. `GET /orders?fast=1` loads all customers in one batch:

```
└─ GET /orders: 19.340 ms (self 1.050 ms, sync 0.498 ms)
  ├─ db.listOrders: 8.866 ms (sync 0.058 ms)
  └─ db.getCustomers: 9.402 ms (sync 0.029 ms)
```

`GET /stats` shows the per-label statistics table.

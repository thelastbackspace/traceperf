/**
 * traceperf playground: an Express API with a hidden performance problem.
 *
 *   npm install && npm start
 *   open http://localhost:3000/orders          (slow)
 *   open http://localhost:3000/orders?fast=1   (fixed)
 *   open http://localhost:3000/stats           (per-label statistics)
 *
 * The console prints one tree per request. The slow version shows a
 * db.getCustomer call for every order, one after the other (the classic
 * "N+1 queries" problem); the fast version loads them in one batch.
 */
const express = require('express');
const { createTracePerf, expressMiddleware, TrackingMode } = require('traceperf');

const tp = createTracePerf({ trackingMode: TrackingMode.DETAILED, trackMemory: false });

// A pretend database: every query costs ~8ms of network round trip
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const db = tp.trackObject({
  async listOrders() {
    await sleep(8);
    return Array.from({ length: 6 }, (_, i) => ({ id: i + 1, customerId: (i % 3) + 1 }));
  },
  async getCustomer(id) {
    await sleep(8);
    return { id, name: `Customer ${id}` };
  },
  async getCustomers(ids) {
    await sleep(9);
    return ids.map(id => ({ id, name: `Customer ${id}` }));
  }
}, { prefix: 'db.' });

const app = express();
app.use(expressMiddleware(tp));

app.get('/orders', async (req, res) => {
  const orders = await db.listOrders();
  if (req.query.fast) {
    const customers = await db.getCustomers([...new Set(orders.map(o => o.customerId))]);
    const byId = new Map(customers.map(c => [c.id, c]));
    return res.json(orders.map(o => ({ ...o, customer: byId.get(o.customerId) })));
  }
  const result = [];
  for (const order of orders) {
    result.push({ ...order, customer: await db.getCustomer(order.customerId) }); // one query per order
  }
  res.json(result);
});

app.get('/stats', (_req, res) => {
  res.type('text/plain').send(tp.formatStats());
});

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`traceperf playground on http://localhost:${port}/orders  (try ?fast=1, and /stats)`);
  if (process.env.SELF_TEST) {
    // Used by CI/docs: hit both endpoints once and exit
    (async () => {
      await fetch(`http://localhost:${port}/orders`);
      await fetch(`http://localhost:${port}/orders?fast=1`);
      server.close();
    })();
  }
});

// A small API and its tests, for `traceperf test`. ORDERS_N_PLUS_ONE=1 plants
// an N+1 in GET /orders (one items query per order instead of one for all).
const http = require('http');
const { query } = require('../slow-apps/db');

async function orders() {
  const list = await query('SELECT * FROM orders LIMIT 8', 2, Array.from({ length: 8 }, (_, id) => ({ id })));
  if (process.env.ORDERS_N_PLUS_ONE === '1') {
    for (const order of list) order.items = await query('SELECT * FROM items WHERE order_id = ?', 1);
  } else {
    await query('SELECT * FROM items WHERE order_id IN (?)', 2);
  }
  return list;
}

module.exports = function createServer() {
  return http.createServer(async (req, res) => {
    const id = /^\/orders\/(\d+)$/.exec(req.url);
    if (req.url === '/orders') return res.end(JSON.stringify(await orders()));
    if (id) return res.end(JSON.stringify(await query('SELECT * FROM orders WHERE id = ?', 1, { id: Number(id[1]) })));
    res.statusCode = 404;
    res.end();
  });
};

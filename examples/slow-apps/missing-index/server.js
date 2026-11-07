// Planted cause: orders are looked up by customer_id, which has no index:
// every request makes Postgres read all 60,000 rows. Needs TRACEPERF_PG_URL.
const serve = require('../serve');
const setup = require('./setup');

setup('traceperf_eval_orders', false).then(pool => {
  let n = 0;
  serve({
    '/orders': async () => (await pool.query('SELECT * FROM traceperf_eval_orders WHERE customer_id = $1', [n++ % 5000])).rows,
  });
});

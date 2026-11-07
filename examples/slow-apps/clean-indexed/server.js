// Clean: the fixed version of missing-index (customer_id is indexed). Needs TRACEPERF_PG_URL.
const serve = require('../serve');
const setup = require('../missing-index/setup');

setup('traceperf_eval_orders_indexed', true).then(pool => {
  let n = 0;
  serve({
    '/orders': async () => (await pool.query('SELECT * FROM traceperf_eval_orders_indexed WHERE customer_id = $1', [n++ % 5000])).rows,
  });
});

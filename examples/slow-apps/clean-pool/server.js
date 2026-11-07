// Clean: the fixed version of pool-exhaustion (pool of 20 for 10 concurrent requests). Needs TRACEPERF_PG_URL.
const pg = require('pg');
const serve = require('../serve');

const pool = new pg.Pool({ connectionString: process.env.TRACEPERF_PG_URL, max: 20 });

serve({
  '/report': async () => (await pool.query('SELECT pg_sleep(0.015), now() AS at')).rows,
});

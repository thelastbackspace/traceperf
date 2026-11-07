// Planted cause: a pg pool of 2 connections serving 10 concurrent requests,
// each holding its connection for a ~15 ms query: most of every request is
// waiting for a free connection, not querying. Needs TRACEPERF_PG_URL.
const pg = require('pg');
const serve = require('../serve');

const pool = new pg.Pool({ connectionString: process.env.TRACEPERF_PG_URL, max: 2 });

serve({
  '/report': async () => (await pool.query('SELECT pg_sleep(0.015), now() AS at')).rows,
});

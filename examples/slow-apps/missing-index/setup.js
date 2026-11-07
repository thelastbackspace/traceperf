// A 60,000-row orders table (created once), with or without an index on customer_id
const pg = require('pg');

module.exports = async function setup(table, indexed) {
  const pool = new pg.Pool({ connectionString: process.env.TRACEPERF_PG_URL, max: 10 });
  await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (id int PRIMARY KEY, customer_id int, total numeric, created_at timestamptz)`);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
  if (rows[0].n === 0) {
    await pool.query(`INSERT INTO ${table} SELECT g, g % 5000, g * 1.5, now() - g * interval '1 minute' FROM generate_series(1, 60000) g`);
  }
  if (indexed) await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_customer ON ${table} (customer_id)`);
  await pool.query(`ANALYZE ${table}`);
  return pool;
};

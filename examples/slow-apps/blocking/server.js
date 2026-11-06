// Planted cause: GET /report builds a large report synchronously (~40 ms of
// CPU). Under concurrent traffic, every other request waits for it, so
// GET /health and the database call look slow although they are not.
const serve = require('../serve');
const { query } = require('../db');

function buildReport() {
  const rows = [];
  const until = Date.now() + 40;
  while (Date.now() < until) rows.push({ id: rows.length, total: Math.sqrt(rows.length) });
  return rows.length;
}

serve({
  '/report': async () => ({ rows: buildReport() }),
  '/users': async () => query('SELECT * FROM users', 15),
});

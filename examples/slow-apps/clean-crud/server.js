// Clean: one indexed lookup per request. traceperf should report no issues.
const serve = require('../serve');
const { query } = require('../db');

serve({
  '/user': async () => query('SELECT * FROM users WHERE id = ?', 2, [{ id: 1 }]),
});

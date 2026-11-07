// Planted cause: every request fails (a missing config value), so all the
// timings describe the error path, not the real work.
const serve = require('../serve');
const { query } = require('../db');

serve({
  '/invoices': async () => {
    await query('SELECT * FROM invoices LIMIT 20', 3);
    if (!process.env.INVOICE_API_KEY) throw new Error('INVOICE_API_KEY is not set');
    return [];
  },
});

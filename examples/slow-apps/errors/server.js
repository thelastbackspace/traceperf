// Planted cause: one in three GET /pay requests fails inside the payment
// call (a timeout from the provider), which shows up as 500s.
const serve = require('../serve');
const tp = require('traceperf');
const { query, sleep } = require('../db');

let n = 0;
const charge = () => tp.track(async () => {
  await sleep(20);
  if (n++ % 3 === 0) throw new Error('payment provider timed out');
  return { ok: true };
}, { label: 'POST payments.example/charge' });

serve({
  '/pay': async () => {
    await query('SELECT * FROM carts WHERE id = ?', 3);
    return charge();
  },
});

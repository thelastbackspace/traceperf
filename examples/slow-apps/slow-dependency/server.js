// Planted cause: GET /checkout spends nearly all its time in one slow
// downstream call (the payment provider, ~80 ms); everything else is quick.
const serve = require('../serve');
const { query } = require('../db');

serve({
  '/checkout': async () => {
    const cart = await query('SELECT * FROM carts WHERE id = ?', 3);
    const payment = await query('POST payments.example/charge', 80);
    return { cart, payment };
  },
});

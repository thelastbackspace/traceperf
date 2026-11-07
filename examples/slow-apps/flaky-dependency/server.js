// Planted cause: the shipping API is usually quick (5 ms) but one call in
// four takes 120 ms, so the route's tail latency comes from that one call.
const serve = require('../serve');
const { query } = require('../db');

let n = 0;
serve({
  '/quote': async () => {
    const cart = await query('SELECT * FROM carts WHERE id = ?', 2);
    const quote = await query('GET shipping.example/quote', ++n % 4 === 0 ? 120 : 5);
    return { cart, quote };
  },
});

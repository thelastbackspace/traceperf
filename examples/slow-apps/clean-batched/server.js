// Clean: the fixed version of n-plus-one, two queries (orders, then all
// their items with one IN query). No issues expected.
const serve = require('../serve');
const { query } = require('../db');

serve({
  '/orders': async () => {
    const orders = await query('SELECT * FROM orders LIMIT 12', 5, Array.from({ length: 12 }, (_, id) => ({ id })));
    await query('SELECT * FROM items WHERE order_id IN (?)', 4);
    return orders;
  },
});

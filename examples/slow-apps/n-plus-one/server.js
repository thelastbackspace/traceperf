// Planted cause: GET /orders loads 12 orders, then their items with one
// query per order (the N+1 pattern) instead of one WHERE order_id IN (...).
const serve = require('../serve');
const { query } = require('../db');

serve({
  '/orders': async () => {
    const orders = await query('SELECT * FROM orders LIMIT 12', 5, Array.from({ length: 12 }, (_, id) => ({ id })));
    for (const order of orders) {
      order.items = await query('SELECT * FROM items WHERE order_id = ?', 3);
    }
    return orders;
  },
});

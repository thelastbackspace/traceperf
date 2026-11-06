// Planted cause: GET /dashboard awaits three independent queries one after
// another (3 x 25 ms) when Promise.all could run them together (~25 ms).
const serve = require('../serve');
const { query } = require('../db');

serve({
  '/dashboard': async () => {
    const user = await query('SELECT * FROM users WHERE id = ?', 25);
    const orders = await query('SELECT * FROM orders WHERE user_id = ?', 25);
    const alerts = await query('SELECT * FROM alerts WHERE user_id = ?', 25);
    return { user, orders, alerts };
  },
});

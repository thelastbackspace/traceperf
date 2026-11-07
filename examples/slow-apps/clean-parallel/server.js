// Clean: the fixed version of sequential, three independent queries run
// together with Promise.all. No issues expected.
const serve = require('../serve');
const { query } = require('../db');

serve({
  '/dashboard': async () => {
    const [user, orders, alerts] = await Promise.all([
      query('SELECT * FROM users WHERE id = ?', 10),
      query('SELECT * FROM orders WHERE user_id = ?', 10),
      query('SELECT * FROM alerts WHERE user_id = ?', 10),
    ]);
    return { user, orders, alerts };
  },
});

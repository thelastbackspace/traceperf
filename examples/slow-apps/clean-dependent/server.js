// Clean: two queries where the second needs the first's result (look up the
// account, then its plan). They cannot run in parallel, and both are fast.
const serve = require('../serve');
const { query } = require('../db');

serve({
  '/billing': async () => {
    const [account] = await query('SELECT * FROM accounts WHERE id = ?', 2, [{ planId: 3 }]);
    const plan = await query('SELECT * FROM plans WHERE id = ?', 2, [{ id: account.planId }]);
    return { account, plan };
  },
});

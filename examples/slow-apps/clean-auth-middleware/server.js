// Clean: every route first loads the session (auth middleware), then does
// its own single query. The session lookup followed by the route's query is
// not "sequential calls that could run in parallel".
const serve = require('../serve');
const { query } = require('../db');

const withSession = handler => async req => {
  const session = await query('SELECT * FROM sessions WHERE token = ?', 6);
  return handler(req, session);
};

serve({
  '/profile': withSession(async () => query('SELECT * FROM users WHERE id = ?', 6)),
  '/settings': withSession(async () => query('SELECT * FROM settings WHERE user_id = ?', 6)),
});

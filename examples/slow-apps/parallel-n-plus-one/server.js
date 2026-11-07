// Planted cause: one query per user, but fired in parallel with Promise.all.
// Still an N+1: 15 round trips and 15 pooled connections instead of one IN query.
const serve = require('../serve');
const { query } = require('../db');

serve({
  '/team': async () => {
    const users = await query('SELECT * FROM users WHERE team_id = ?', 3, Array.from({ length: 15 }, (_, id) => ({ id })));
    await Promise.all(users.map(async u => { u.avatar = await query('SELECT * FROM avatars WHERE user_id = ?', 4); }));
    return users;
  },
});

// Clean: the first request loads the config (slow), later ones read the
// in-memory cache. Warm-up absorbs the first; no issues expected.
const serve = require('../serve');
const { query } = require('../db');

let cached;
serve({
  '/config': async () => (cached ??= await query('SELECT * FROM config', 80)),
});

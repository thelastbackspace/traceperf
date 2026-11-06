// Planted cause: blocking inside Node/V8 built-ins rather than your own
// loops. GET /export serialises a large object with JSON.stringify and
// GET /login hashes a password with crypto.pbkdf2Sync; both block every
// other request (GET /ping) while they run.
const crypto = require('crypto');
const serve = require('../serve');

const catalog = Array.from({ length: 20000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b', 'c'], price: i * 1.5 }));

// Each runs for ~25 ms on any machine (repeating the work), so the example
// behaves the same on a fast CI runner and a slow laptop
function exportCatalog() {
  let bytes = 0;
  const until = Date.now() + 25;
  do bytes = JSON.stringify(catalog).length; while (Date.now() < until);
  return bytes;
}

function hashPassword(password) {
  let hash;
  const until = Date.now() + 25;
  do hash = crypto.pbkdf2Sync(password, 'salt', 5000, 32, 'sha256'); while (Date.now() < until);
  return hash.toString('hex');
}

serve({
  '/export': async () => ({ bytes: exportCatalog() }),
  '/login': async () => ({ hash: hashPassword('hunter2').slice(0, 8) }),
  '/ping': async () => ({ ok: true }),
});

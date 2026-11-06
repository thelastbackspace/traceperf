// Planted cause: blocking inside Node/V8 built-ins rather than your own
// loops. GET /export serialises a large object with JSON.stringify and
// GET /login hashes a password with crypto.pbkdf2Sync; both block every
// other request (GET /ping) while they run.
const crypto = require('crypto');
const serve = require('../serve');

const catalog = Array.from({ length: 60000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b', 'c'], price: i * 1.5 }));

function exportCatalog() {
  return JSON.stringify(catalog).length;
}

function hashPassword(password) {
  return crypto.pbkdf2Sync(password, 'salt', 80000, 32, 'sha256').toString('hex');
}

serve({
  '/export': async () => ({ bytes: exportCatalog() }),
  '/login': async () => ({ hash: hashPassword('hunter2').slice(0, 8) }),
  '/ping': async () => ({ ok: true }),
});

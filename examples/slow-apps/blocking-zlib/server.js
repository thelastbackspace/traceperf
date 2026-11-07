// Planted cause: GET /backup gzips ~10 MB synchronously (zlib.gzipSync),
// blocking the event loop; GET /health waits behind it.
const zlib = require('zlib');
const serve = require('../serve');

const data = Buffer.alloc(10 * 1024 * 1024, 'traceperf backup row\n');

function compressBackup() {
  return zlib.gzipSync(data, { level: 9 }).length;
}

serve({
  '/backup': async () => ({ bytes: compressBackup() }),
  '/health': async () => ({ ok: true }),
});

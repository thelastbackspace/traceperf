// node --test examples/test-mode/app.test.js   (counting queries: npx traceperf test -- node --test examples/test-mode/app.test.js)
const test = require('node:test');
const assert = require('node:assert');
const createServer = require('./app');

async function get(server, path) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

test('orders', async t => {
  const server = createServer().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const list = await get(server, '/orders');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.length, 8);
  assert.strictEqual((await get(server, '/orders/3')).body.id, 3);
  assert.strictEqual((await get(server, '/missing')).status, 404);
});

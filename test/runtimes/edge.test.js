// Vercel Edge runtime (official edge-runtime VM). Run with:
//   node test/runtimes/edge.test.js        (after npm run build:all)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { buildSync } = require('esbuild');
const { EdgeVM } = require('@edge-runtime/vm');

const root = path.resolve(__dirname, '..', '..');
const bundle = buildSync({
  entryPoints: [path.join(root, 'dist/esm/index.js')],
  bundle: true, format: 'iife', globalName: 'TP', platform: 'neutral',
  mainFields: ['module', 'main'], write: false, logLevel: 'error',
}).outputFiles[0].text;

const scenario = `
  globalThis.result = (async () => {
    const roots = [];
    const opts = globalThis.__explicit ? { asyncLocalStorage: globalThis.__explicit } : {};
    const tp = TP.createTracePerf({ silent: true, onComplete: r => roots.push(r), ...opts });
    await tp.track(async () => {
      await new Promise(r => setTimeout(r, 5));
      await tp.track(() => new Promise(r => setTimeout(r, 5)), { label: 'child' });
    }, { label: 'root' });
    tp.track(() => 1, { label: 'sync' });
    return { trees: roots.map(r => [r.label, r.children.map(c => c.label)]), stats: tp.getStats('sync').count };
  })();`;

async function run(name, extend, expected) {
  const vm = new EdgeVM({ extend });
  assert.strictEqual(vm.evaluate('typeof process'), 'undefined');
  vm.evaluate(bundle);
  vm.evaluate(scenario);
  const out = await vm.evaluate('result');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), expected);
  console.log(`ok   edge-runtime: ${name}`);
}

(async () => {
  const nested = { trees: [['root', ['child']], ['sync', []]], stats: 1 };
  // Next.js Edge exposes AsyncLocalStorage as a global
  await run('global AsyncLocalStorage -> nesting across await', ctx => Object.assign(ctx, { AsyncLocalStorage }), nested);
  // Cloudflare/Vercel style: imported class passed explicitly
  await run('explicit asyncLocalStorage option', ctx => Object.assign(ctx, { __explicit: AsyncLocalStorage }), nested);
  // No AsyncLocalStorage at all: documented sync-stack fallback
  await run('no AsyncLocalStorage -> sync fallback', undefined, { trees: [['child', []], ['root', []], ['sync', []]], stats: 1 });
  console.log('edge-runtime: all passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

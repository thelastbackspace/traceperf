#!/usr/bin/env node
/**
 * Verify the package the way users consume it: pack the tarball, install it
 * into throwaway projects and exercise every supported entry point.
 *
 *   node scripts/verify-package.js            # full matrix (needs devDependencies)
 *   node scripts/verify-package.js --runtime  # CJS + ESM only; runs on every Node in `engines`
 *
 * Requires an up-to-date build (`npm run build:all`).
 * Written for Node 14 compatibility on purpose.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeOnly = process.argv.includes('--runtime');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd, opts) {
  return execFileSync(cmd, args, Object.assign({ cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts));
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'traceperf-verify-'));
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push([name, true]);
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push([name, false]);
    const detail = String(error.stderr || error.stdout || error.message).trim().split('\n').slice(0, 12).join('\n');
    console.log(`FAIL ${name}\n${detail.replace(/^/gm, '     ')}`);
  }
}

function project(name, type) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir);
  const pkg = { name: `verify-${name}`, version: '1.0.0', private: true };
  if (type) pkg.type = type;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  run(npm, ['install', '--no-audit', '--no-fund', '--silent', tarball], dir);
  return dir;
}

// 1. pack
// Pack inside the package dir (`npm pack <dir>` runs "prepare" even with
// --ignore-scripts on newer npm) and move it out (npm 6 has no --pack-destination)
const packOut = run(npm, ['pack', '--ignore-scripts', '--silent'], root).trim().split('\n').pop();
const tarball = path.join(work, packOut);
fs.copyFileSync(path.join(root, packOut), tarball); // not rename: work may be on another device
fs.unlinkSync(path.join(root, packOut));
console.log(`packed ${path.basename(tarball)} (node ${process.version})`);

// 2. CommonJS consumer
check('CommonJS require()', () => {
  const dir = project('cjs');
  fs.writeFileSync(path.join(dir, 'index.js'), `
const assert = require('assert');
const tp = require('traceperf');
const { createTracePerf, TrackingMode, getTimestamp } = require('traceperf');
assert.strictEqual(tp.track(() => 1, { silent: true }), 1);
assert.strictEqual(tp.default, tp);
assert.strictEqual(typeof createTracePerf, 'function');
assert.strictEqual(typeof getTimestamp, 'function');
assert.strictEqual(TrackingMode.BALANCED, 'balanced');
const browser = require('traceperf/browser');
assert.strictEqual(typeof browser.createTracePerf, 'function');
const t = createTracePerf({ silent: true });
const inner = t.createTrackable(function inner() { return 2; });
assert.strictEqual(t.track(() => inner()), 2);
`);
  run(process.execPath, ['index.js'], dir);
});

// 3. ESM consumer
check('ESM import', () => {
  const dir = project('esm', 'module');
  fs.writeFileSync(path.join(dir, 'index.js'), `
import assert from 'assert';
import tp, { createTracePerf, TrackingMode } from 'traceperf';
import logger, { createTracePerf as createBrowser } from 'traceperf/browser';
assert.strictEqual(tp.track(() => 1, { silent: true }), 1);
assert.strictEqual(typeof createTracePerf, 'function');
assert.strictEqual(TrackingMode.BALANCED, 'balanced');
assert.strictEqual(typeof createBrowser, 'function');
assert.strictEqual(typeof logger.track, 'function');
const value = await createTracePerf({ silent: true }).track(async () => 3);
assert.strictEqual(value, 3);
`);
  run(process.execPath, ['index.js'], dir);
});

check('traceperf CLI (npx traceperf report)', () => {
  const dir = path.join(work, 'cjs');
  fs.writeFileSync(path.join(dir, 'make-log.js'), `
const { createTracePerf, jsonLinesExporter } = require('traceperf');
const lines = [];
const tp = createTracePerf({ silent: true, plugins: [jsonLinesExporter(l => lines.push(l))] });
for (let i = 0; i < 3; i++) tp.track(() => tp.track(() => i, { label: 'child' }), { label: 'parent' });
require('fs').writeFileSync('calls.jsonl', lines.join('\\n'));
`);
  run(process.execPath, ['make-log.js'], dir);
  const out = run(isWin ? 'npx.cmd' : 'npx', ['--no-install', 'traceperf', 'report', 'calls.jsonl'], dir);
  if (!/6 calls, 2 labels/.test(out)) throw new Error(`unexpected CLI output:\n${out}`);
});

check('node --require traceperf/auto (zero-code request tracking)', () => {
  const dir = path.join(work, 'cjs');
  fs.writeFileSync(path.join(dir, 'server.js'), `
const http = require('http');
const server = http.createServer((req, res) => setTimeout(() => res.end('ok'), 5)).listen(0, '127.0.0.1', () => {
  http.get('http://127.0.0.1:' + server.address().port + '/users/42', res => {
    res.resume();
    res.on('end', () => server.close());
  });
});
`);
  const out = path.join(dir, 'auto.jsonl');
  execFileSync(process.execPath, ['--require', 'traceperf/auto', 'server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { TRACEPERF_OUTPUT: out, TRACEPERF_QUIET: '1' }),
    stdio: 'pipe',
  });
  const labels = fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l).label);
  if (labels.indexOf('GET /users/:id') === -1) throw new Error(`no request tree in ${JSON.stringify(labels)}`);
});

if (!runtimeOnly) {
  const tsc = path.join(root, 'node_modules', '.bin', isWin ? 'tsc.cmd' : 'tsc');
  const esbuild = path.join(root, 'node_modules', '.bin', isWin ? 'esbuild.cmd' : 'esbuild');
  const tsSource = `
import tp, { createTracePerf, TrackingMode, OptimizedPerformanceMonitor } from 'traceperf';
import { createTracePerf as createBrowser, BrowserLogger } from 'traceperf/browser';
const t: OptimizedPerformanceMonitor = createTracePerf({ trackingMode: TrackingMode.DETAILED, silent: true });
const n: number = t.track(() => 1, { label: 'x' });
const p: Promise<string> = t.track(async () => 'a');
const add = t.createTrackable((a: number, b: number) => a + b);
const s: number = add(1, 2);
tp.track(() => 2, { silent: true });
const b = createBrowser({ silent: true, trackMemory: true, threshold: 0 });
b.track(() => 3);
new BrowserLogger();
void p;
console.log(n + s);
`;
  const variants = [
    ['TypeScript nodenext (CJS project)', 'nodenext', 'nodenext', undefined, true],
    ['TypeScript nodenext (ESM project)', 'nodenext', 'nodenext', 'module', true],
    ['TypeScript bundler', 'esnext', 'bundler', 'module', false],
    ['TypeScript node10 ("moduleResolution": "node")', 'commonjs', 'node', undefined, true],
  ];
  for (const [name, mod, resolution, type, execute] of variants) {
    check(name, () => {
      const dir = project(`ts-${resolution}-${type || 'cjs'}`, type);
      fs.writeFileSync(path.join(dir, 'index.ts'), tsSource);
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true, module: mod, moduleResolution: resolution, target: 'es2020',
          outDir: 'out', types: [], lib: ['es2020', 'dom'], esModuleInterop: true, skipLibCheck: false,
        },
        files: ['index.ts'],
      }));
      run(tsc, ['-p', '.'], dir);
      if (execute) run(process.execPath, ['out/index.js'], dir);
    });
  }

  const vm = require('vm');
  const runInBrowserLikeContext = (code) => {
    const logs = [];
    const sandbox = { console: { log: (...a) => logs.push(a.join(' ')), info() {}, warn() {}, error() {}, debug() {} }, performance, setTimeout };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    return { sandbox, logs };
  };

  for (const [name, source] of [
    ['esbuild browser bundle of traceperf/browser', `import { createTracePerf } from 'traceperf/browser'; globalThis.out = createTracePerf().track(() => 5, { label: 'bundled' });`],
    ['esbuild browser bundle of traceperf', `import { createTracePerf } from 'traceperf'; globalThis.out = createTracePerf().track(() => 6, { label: 'bundledMain' });`],
  ]) {
    check(name, () => {
      const dir = project(`bundle-${results.length}`, 'module');
      fs.writeFileSync(path.join(dir, 'in.js'), source);
      run(esbuild, ['in.js', '--bundle', '--platform=browser', '--format=iife', '--outfile=out.js', '--log-level=warning'], dir);
      const { sandbox, logs } = runInBrowserLikeContext(fs.readFileSync(path.join(dir, 'out.js'), 'utf8'));
      if (typeof sandbox.out !== 'number') throw new Error(`bundle returned ${sandbox.out}`);
      if (!/bundled/.test(logs.join('\n'))) throw new Error(`no tracking output: ${logs.join('\n')}`);
    });
  }

  check('<script> build defines window.TracePerf', () => {
    const dir = path.join(work, 'cjs');
    const file = path.join(dir, 'node_modules', 'traceperf', 'dist', 'traceperf.browser.js');
    const { sandbox, logs } = runInBrowserLikeContext(fs.readFileSync(file, 'utf8'));
    const { createTracePerf, TrackingMode } = sandbox.TracePerf;
    createTracePerf({ trackingMode: TrackingMode.BALANCED }).track(() => 1, { label: 'scriptTag' });
    if (!/scriptTag/.test(logs.join('\n'))) throw new Error('no output from script-tag build');
  });
}

fs.rmSync ? fs.rmSync(work, { recursive: true, force: true }) : fs.rmdirSync(work, { recursive: true });
const failed = results.filter(r => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} consumer checks passed`);
process.exitCode = failed.length ? 1 : 0;

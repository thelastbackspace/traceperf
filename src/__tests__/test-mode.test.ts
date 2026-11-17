import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { parseTestArgs, requestTrees, routeTable, runTests, TestArgs } from '../test-mode';
import { parseTrees } from '../cli';
import { baselineOf } from '../run';
import { hookJest } from '../test-runners';
import { createTracePerf } from '../index';
import type { ExecutionRecord } from '../core/records';
import { loadNodeBuiltin } from '../core/env';

const ROOT = path.join(__dirname, '..', '..');
const REGISTER = path.join(ROOT, 'dist', 'register.js');

describe('parseTestArgs', () => {
  it('reads options before -- and the command after it', () => {
    expect(parseTestArgs(['--baseline', 'b.json', '--save-baseline', 's.json', '--markdown', 'm.md', '--output', 'o.jsonl', '--json', '--max', '3', '--', 'npm', 'test', '--', '-t', 'x'])).toEqual({
      command: ['npm', 'test', '--', '-t', 'x'], baseline: 'b.json', saveBaseline: 's.json', markdown: 'm.md', output: 'o.jsonl', json: true, max: 3,
    });
  });

  it('explains what is wrong', () => {
    expect(parseTestArgs([])).toMatch(/after --/);
    expect(parseTestArgs(['npm', 'test'])).toMatch(/unknown option npm/);
    expect(parseTestArgs(['--baseline', '--', 'npm', 'test'])).toMatch(/--baseline needs a value/);
    expect(parseTestArgs(['--baseline'])).toMatch(/--baseline needs a value/);
    expect((parseTestArgs(['--max', 'x', '--', 'a']) as TestArgs).max).toBe(10);
  });
});

describe('requestTrees and routeTable', () => {
  const node = (label: string, children: any[] = []) => ({ label, children });
  it('drops the test client\'s own outgoing calls and tabulates calls per request', () => {
    const trees = requestTrees([
      node('GET /users', [node('pg SELECT'), node('pg SELECT'), node('redis GET')]),
      node('http GET 127.0.0.1:4000/users'),
      node('fetch GET localhost/users'),
      node('GET /health'),
    ]);
    expect(trees.map(t => t.label)).toEqual(['GET /users', 'GET /health']);
    const table = routeTable(baselineOf(trees, []));
    expect(table).toContain('GET /users');
    expect(table).toMatch(/GET \/users\s+1\s+3\s+pg SELECT ×2, redis GET/);
    expect(table).toMatch(/GET \/health\s+1\s+0/);
    expect(routeTable({ version: 1, routes: {}, problems: [] })).toBe('');
  });
});

/** A fake test command: writes request trees where traceperf/auto would, then exits */
function fakeRunner(trees: object[], code: number | null, signal: string | null = null) {
  const calls: any[] = [];
  return {
    calls,
    spawn(cmd: string, args: string[], options: any) {
      calls.push({ cmd, args, options });
      const child = new EventEmitter();
      setImmediate(() => {
        fs.appendFileSync(options.env.TRACEPERF_OUTPUT, trees.map(t => JSON.stringify(t) + '\n').join(''));
        child.emit('exit', code, signal);
      });
      return child;
    },
  };
}

const tree = (label: string, calls: string[]) => ({
  label, startMs: 0, durationMs: 10, selfMs: 1,
  children: calls.map((c, i) => ({ label: c, startMs: i, durationMs: 1, selfMs: 1, children: [] })),
});

describe('runTests', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceperf-test-mode-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (args: Partial<TestArgs>, runner: ReturnType<typeof fakeRunner>) => {
    const out: string[] = [];
    const err: string[] = [];
    const done = runTests({ command: ['npm', 'test'], json: false, max: 10, ...args }, {
      childProcess: runner, fs, os, path, registerPath: REGISTER, parseTrees, libraries: ['sequelize'],
      out: t => out.push(t), err: t => err.push(t),
    });
    return done.then(code => ({ code, out: out.join('\n'), err: err.join('\n') }));
  };

  it('preloads traceperf/auto in the test command, reports calls per route and the N+1 with ORM advice', async () => {
    const runner = fakeRunner([tree('GET /orders', Array(6).fill('pg SELECT orders')), tree('http GET 127.0.0.1:1/orders', []), tree('GET /orders', Array(6).fill('pg SELECT orders'))], 0);
    const saved = path.join(dir, 'base.json');
    const r = await run({ saveBaseline: saved, markdown: path.join(dir, 'r.md') }, runner);
    expect(r.code).toBe(0);
    const env = runner.calls[0].options.env;
    expect(env.NODE_OPTIONS).toContain(`--require ${JSON.stringify(REGISTER)}`);
    expect(env.TRACEPERF_TEST).toBe('1');
    expect(runner.calls[0].cmd).toBe('npm');
    expect(r.out).toContain('2 requests during the tests');
    expect(r.out).toMatch(/GET \/orders\s+2\s+6/);
    expect(r.out).toContain('N+1');
    expect(r.out).toContain('in Sequelize');
    expect(JSON.parse(fs.readFileSync(saved, 'utf8')).routes['GET /orders'].calls['pg SELECT orders']).toBe(6);
    expect(fs.readFileSync(path.join(dir, 'r.md'), 'utf8')).toContain('traceperf');
  });

  it('fails on more calls per request than the baseline, and says what changed', async () => {
    const base = path.join(dir, 'base.json');
    fs.writeFileSync(base, JSON.stringify(baselineOf([{ label: 'GET /orders', children: [{ label: 'pg SELECT', children: [] }] }], [])));
    const r = await run({ baseline: base }, fakeRunner([tree('GET /orders', ['pg SELECT', 'pg SELECT', 'pg SELECT', 'pg SELECT', 'pg SELECT'])], 0));
    expect(r.code).toBe(1);
    expect(r.out).toContain('✖ GET /orders: pg SELECT 1 → 5 per request');
    const same = await run({ baseline: base }, fakeRunner([tree('GET /orders', ['pg SELECT'])], 0));
    expect(same.code).toBe(0);
    expect(same.out).toContain('same calls per request on every route');
  });

  it('JSON output, and the tests\' own failure wins', async () => {
    const r = await run({ json: true, output: path.join(dir, 'calls.jsonl') }, fakeRunner([tree('GET /a', ['pg SELECT'])], 3));
    expect(r.code).toBe(3);
    expect(JSON.parse(r.out)).toMatchObject({ testExitCode: 3, requests: 1, routes: { 'GET /a': { calls: { 'pg SELECT': 1 } } } });
    expect(r.err).toContain('the tests failed (exit 3)');
    expect(fs.existsSync(path.join(dir, 'calls.jsonl'))).toBe(true);
    const killed = await run({}, fakeRunner([], null, 'SIGTERM'));
    expect(killed.code).toBe(1);
  });

  it('says why nothing was counted, and reports a baseline it cannot read', async () => {
    const r = await run({ baseline: path.join(dir, 'missing.json') }, fakeRunner([], 0));
    expect(r.out).toContain('made no HTTP requests');
    expect(r.err).toContain('could not read the baseline');
    expect(r.code).toBe(1);
  });

  it('reports a command that cannot start', async () => {
    const runner = {
      spawn() {
        const child = new EventEmitter();
        setImmediate(() => child.emit('error', new Error('ENOENT')));
        return child;
      },
    };
    const r = await run({}, runner as any);
    expect(r.code).toBe(127);
    expect(r.err).toContain('could not start npm');
  });

  it('end to end: a test script that requests its own server is counted', async () => {
    const script = path.join(dir, 'suite.js');
    fs.writeFileSync(script, `
      const http = require('http');
      const server = http.createServer((req, res) => res.end('ok')).listen(0, () => {
        const port = server.address().port;
        let left = 3;
        for (let i = 0; i < 3; i++) http.get({ port, path: '/items/' + (i + 1) }, r => { r.resume(); r.on('end', () => { if (--left === 0) server.close(); }); });
      });
    `);
    const out: string[] = [];
    const code = await runTests({ command: [process.execPath, script], json: true, max: 10 }, {
      childProcess, fs, os, path, registerPath: REGISTER, parseTrees, out: t => out.push(t), err: () => undefined,
    });
    expect(code).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ requests: 3, routes: { 'GET /items/:id': { requests: 3 } } });
  }, 60000);
});

describe('hookJest', () => {
  let dir: string;
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceperf-jest-hook-'));
    write('package.json', '{"name":"app"}');
    // A Jest runtime whose sandbox loads modules with plain require
    write('node_modules/jest-runtime/package.json', '{"name":"jest-runtime","main":"index.js"}');
    write('node_modules/jest-runtime/index.js', `
      class Runtime { requireModuleOrMock(from, name) { return require(require('module').createRequire(from).resolve(name)); } }
      exports.default = Runtime;
    `);
    // A driver with a query method, and a file inside it that is not its entry point
    write('node_modules/pg/package.json', '{"name":"pg","main":"lib/index.js"}');
    write('node_modules/pg/lib/index.js', `
      class Client { query(text, cb) { setImmediate(() => cb(null, { rows: [] })); } }
      module.exports = { Client };
    `);
    write('node_modules/pg/lib/other.js', 'module.exports = { other: true };');
    write('src/app.js', '');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('instruments drivers loaded through Jest\'s runtime, once per module object', async () => {
    const roots: ExecutionRecord[] = [];
    const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
    expect(hookJest(tp, dir)).toBe(true);
    expect(hookJest(tp, dir)).toBe(true); // already hooked
    // The require hookJest used (Node's own, as in a Jest worker), not this test's sandboxed one
    const Runtime = loadNodeBuiltin('module').createRequire(__filename)(path.join(dir, 'node_modules/jest-runtime/index.js')).default;
    const runtime = new Runtime();
    const from = path.join(dir, 'src/app.js');
    const pg = runtime.requireModuleOrMock(from, 'pg');
    expect(runtime.requireModuleOrMock(from, 'pg')).toBe(pg);
    expect(runtime.requireModuleOrMock(from, 'pg/lib/other.js')).toEqual({ other: true });
    expect(typeof runtime.requireModuleOrMock(from, 'path').join).toBe('function');
    expect(() => runtime.requireModuleOrMock(from, 'missing-module')).toThrow();
    await tp.track(() => new Promise(resolve => new pg.Client().query('SELECT 1 FROM users', resolve)), { label: 'job' });
    expect(roots.find(r => r.label === 'job')!.children.map(c => c.label)).toEqual(['pg SELECT users']);
  });

  it('returns false when there is no Jest', () => {
    const tp = createTracePerf({ silent: true });
    expect(hookJest(tp, os.tmpdir())).toBe(false);
  });
});

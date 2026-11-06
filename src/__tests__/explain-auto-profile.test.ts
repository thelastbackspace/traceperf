/**
 * explain(), traceperf explain, incoming-request tracking, autoInstrument,
 * traceperf/auto and profileSlowCalls.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { AddressInfo } from 'net';
import {
  autoInstrument,
  createTracePerf,
  ExecutionRecord,
  explain,
  ExplainNode,
  formatFindings,
  instrumentHttpServer,
  jsonLinesExporter,
  normalizePath,
  profileSlowCalls,
  SlowCallProfile,
  summariseProfile,
} from '../index';
import { main, parseTrees } from '../cli';

const node = (label: string, startTime: number, duration: number, extra: Partial<ExplainNode> = {}): ExplainNode => ({
  label, startTime, duration, selfDuration: duration, async: true, syncDuration: 0, children: [], ...extra,
});
const busy = (ms: number) => { const end = Date.now() + ms; while (Date.now() < end); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('explain()', () => {
  test('a call delayed by blocking code in another call is explained', () => {
    const cpu = node('cpu', 50, 30, { async: false, syncDuration: 30 });
    const req1 = node('req1', 0, 100, { children: [node('db', 0, 50), cpu], selfDuration: 20 });
    const req2 = node('req2', 0, 100, { children: [node('db', 0, 80)], selfDuration: 20 });
    const findings = explain([req1, req2]);
    const blocked = findings.find(f => f.kind === 'blocked')!;
    expect(blocked.root).toBe('req2');
    expect(blocked.ms).toBeCloseTo(30);
    expect(blocked.message).toMatch(/req2 waited ~30 ms .* while cpu in req1 blocked the event loop/);
    expect(findings.find(f => f.kind === 'blocking')!.message).toMatch(/^cpu ran 30 ms of synchronous code/);
    // req1's db was not delayed by its own cpu() (the cpu ran after it)
    expect(findings.filter(f => f.kind === 'blocked').map(f => f.root)).toEqual(['req2']);
  });

  test('each finding points at the time range and calls that show it', () => {
    const cpu = node('cpu', 50, 30, { async: false, syncDuration: 30 });
    const req1 = node('req1', 0, 100, { children: [node('db', 0, 50), cpu], selfDuration: 20 });
    const req2 = node('req2', 10, 100, { children: [node('db', 10, 80)], selfDuration: 20 });
    const findings = explain([req1, req2]);
    expect(findings.find(f => f.kind === 'blocking')!.evidence).toEqual({ start: 50, end: 80, labels: ['cpu'] });
    expect(findings.find(f => f.kind === 'blocked')!.evidence).toEqual({ start: 10, end: 110, labels: ['req2', 'cpu'] });
    const seq = node('page', 0, 30, { children: [node('a', 0, 10), node('b', 10, 10), node('c', 20, 10)] });
    expect(explain([seq]).find(f => f.kind === 'sequential')!.evidence).toEqual({ start: 0, end: 30, labels: ['a', 'b', 'c'] });
    const n1 = node('list', 0, 60, { children: Array.from({ length: 6 }, (_, i) => node('q', 5 + i * 9, 9)) });
    expect(explain([n1]).find(f => f.kind === 'repeated')!.evidence).toEqual({ start: 5, end: 59, labels: ['q'] });
  });

  test('findings carry a concrete fix that matches the cause', () => {
    const seq = node('page', 0, 30, { children: [node('loadUser', 0, 10), node('loadOrders', 10, 10)] });
    expect(explain([seq]).find(f => f.kind === 'sequential')!.fix).toBe("if they don't depend on each other, start them together: await Promise.all([loadUser(), loadOrders()])");
    const n1 = node('list', 0, 60, { children: Array.from({ length: 6 }, (_, i) => node('pg SELECT items', 5 + i * 9, 9)) });
    expect(explain([n1]).find(f => f.kind === 'repeated')!.fix).toMatch(/IN \(\.\.\.\)/);
    const rest = node('list', 0, 60, { children: Array.from({ length: 6 }, (_, i) => node('fetchUser', 5 + i * 9, 9)) });
    expect(explain([rest]).find(f => f.kind === 'repeated')!.fix).toMatch(/DataLoader/);
    const hash = node('login', 0, 30, { async: false, syncDuration: 30 });
    const hotspots = { login: [{ functionName: 'hashPassword → pbkdf2Sync', location: 'a.js:3', ms: 28 }, { functionName: '(garbage collection)', location: '', ms: 2 }] };
    const blocking = explain([hash], { hotspots }).find(f => f.kind === 'blocking')!;
    expect(blocking.fix).toMatch(/^hashPassword: use the async version/);
    expect(formatFindings([blocking])).toMatch(/\n {3}fix: hashPassword/);
    expect(explain([hash]).find(f => f.kind === 'blocking')!.fix).toMatch(/worker_threads/);
    expect(explain([node('boom', 0, 10, { error: new Error('x') })])[0].fix).toBeUndefined();
    const lib = { login: [{ functionName: 'submit → Writable.uncork', location: 'node_modules/pg/lib/query.js:177', ms: 16 }] };
    expect(explain([hash], { hotspots: lib }).find(f => f.kind === 'blocking')!.fix).toMatch(/^the time is inside pg \(library code\)/);
  });

  test("a library's own sequential or repeated calls are not reported", () => {
    const include = node('GET /feed', 0, 40, { children: [
      node('prisma.Post.findMany', 0, 40, { children: [node('pg SELECT public.Post', 0, 20), node('pg SELECT public.User', 20, 20)] }),
    ] });
    expect(explain([include]).filter(f => f.kind === 'sequential' || f.kind === 'repeated')).toEqual([]);
  });

  test('blocking is attributed to the deepest call that did it', () => {
    const inner = node('parseJson', 0, 40, { async: false, syncDuration: 40 });
    const outer = node('handler', 0, 42, { async: false, syncDuration: 42, children: [inner] });
    const other = node('other', 0, 50);
    const blocked = explain([outer, other]).filter(f => f.kind === 'blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].message).toMatch(/while parseJson in handler blocked/);
  });

  test('sequential awaits, N+1 calls, dominant children and errors', () => {
    const seq = [node('a', 0, 20), node('b', 20, 30), node('c', 50, 10)];
    const page = node('page', 0, 60, { children: seq, selfDuration: 0 });
    const queries = Array.from({ length: 6 }, (_, i) => node('pg SELECT items', i * 2, 2));
    const list = node('list', 0, 20, { children: queries, selfDuration: 8 });
    const slow = node('report', 0, 100, { children: [node('render', 0, 90), node('cache.get', 90, 5)], selfDuration: 5 });
    const failed = node('save', 0, 3, { children: [node('pg INSERT', 0, 2, { error: new Error('duplicate key') })], error: new Error('duplicate key') });
    const findings = explain([page, list, slow, failed]);
    const by = (kind: string) => findings.filter(f => f.kind === kind);
    expect(by('sequential')[0].message).toMatch(/page awaited 3 calls one after another \(a, b, c: 60 ms\).*save up to ~30 ms/);
    expect(by('repeated')[0].message).toMatch(/list called pg SELECT items 6 times/);
    expect(by('dominant')[0].message).toMatch(/render took 90% of report/);
    // the error is reported once, where it happened
    expect(by('error').map(f => f.message)).toEqual(['pg INSERT in save failed after 2.0 ms: duplicate key']);
  });

  test('overlapping (parallel) children are not reported as sequential', () => {
    const page = node('page', 0, 30, { children: [node('a', 0, 30), node('b', 1, 29)] });
    expect(explain([page]).filter(f => f.kind === 'sequential')).toEqual([]);
  });

  test('identical findings across many requests are grouped', () => {
    const roots = Array.from({ length: 5 }, () => node('GET /users/:id', 0, 60, {
      children: [node('a', 0, 30), node('b', 30, 30)],
    }));
    const seq = explain(roots).filter(f => f.kind === 'sequential');
    expect(seq).toHaveLength(1);
    expect(seq[0].message).toMatch(/seen 5 times, typical shown\)$/);
  });

  test('grouped findings show the typical case: one cold start does not make every request look slow', () => {
    // A request that makes one call is always mostly that call: not worth saying unless it is slow
    expect(explain([node('GET /a', 0, 21, { selfDuration: 1, children: [node('db', 0, 20)] })])).toEqual([]);
    expect(explain([node('GET /a', 0, 151, { selfDuration: 1, children: [node('db', 0, 150)] })])[0].kind).toBe('dominant');
    // 9 requests where the query is 4 ms of 5 ms, one where the first connection made it 110 ms
    const roots = [110, ...Array(9).fill(4)].map(ms => node('GET /users', 0, ms + 1, { selfDuration: 0.5, children: [node('db', 0, ms), node('auth', ms, 0.5)] }));
    const [once] = explain(roots).filter(f => f.kind === 'dominant');
    expect(once.message).toMatch(/\(in 1 of 10 GET \/users\)$/);
    // ... and once in 40 requests is noise
    const many = [110, ...Array(39).fill(4)].map(ms => node('GET /users', 0, ms + 1, { selfDuration: 0.5, children: [node('db', 0, ms), node('auth', ms, 0.5)] }));
    expect(explain(many).filter(f => f.kind === 'dominant')).toEqual([]);
    const slowRoots = [110, 40, 42, 41, 39].map(ms => node('GET /users', 0, ms + 1, { selfDuration: 0.5, children: [node('db', 0, ms), node('auth', ms, 0.5)] }));
    const [f] = explain(slowRoots).filter(x => x.kind === 'dominant');
    expect(f.ms).toBe(41);
    expect(f.message).toMatch(/\(41 ms of 42 ms\) \(seen 5 times, typical shown; worst 110 ms\)$/);
  });

  test('nothing to say', () => {
    expect(formatFindings(explain([node('fast', 0, 1)]))).toMatch(/^No issues found/);
  });

  test('works on real records: concurrent requests and a blocking function', async () => {
    const roots: ExecutionRecord[] = [];
    const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
    const db = tp.createTrackable(async () => { await sleep(30); }, { label: 'db' });
    const cpu = tp.createTrackable(() => busy(25), { label: 'cpu' });
    const handler = (id: number) => tp.track(async () => { await db(); cpu(); await sleep(5); }, { label: `req${id}` });
    await Promise.all([handler(1), handler(2)]);
    const findings = explain(roots);
    expect(findings.find(f => f.kind === 'blocking')!.message).toMatch(/^cpu ran \d+ ms of synchronous code.*\(in req1, req2\)/);
    const blocked = findings.filter(f => f.kind === 'blocked');
    expect(blocked.length).toBeGreaterThan(0);
    blocked.forEach(f => expect(f.ms).toBeGreaterThanOrEqual(15));
  });
});

describe('traceperf explain', () => {
  const run = (argv: string[], files: Record<string, string>) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, {
      readFile: p => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]; },
      readStdin: () => files['-'] ?? '',
      out: t => out.push(t),
      err: t => err.push(t),
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  test('same findings from JSON lines and from a Chrome trace', async () => {
    const lines: string[] = [];
    const tp = createTracePerf({ silent: true, trackMemory: false, plugins: [jsonLinesExporter(l => lines.push(l))] });
    const recorder = tp.startTrace();
    const cpu = tp.createTrackable(() => busy(25), { label: 'cpu' });
    const job = (id: number) => tp.track(async () => { await sleep(10); cpu(); await sleep(5); }, { label: `job${id}` });
    await Promise.all([job(1), job(2)]);
    const trace = JSON.stringify(recorder.stop());
    for (const file of [lines.join('\n'), trace]) {
      const { code, out } = run(['explain', 'f'], { f: file });
      expect(code).toBe(0);
      expect(out).toMatch(/cpu ran \d+ ms of synchronous code/);
      expect(out).toMatch(/waited ~\d+ ms .* while cpu in job/);
      expect(out).not.toMatch(/awaited/); // a sync child is not an "await"
    }
    const json = JSON.parse(run(['explain', 'f', '--json'], { f: trace }).out);
    expect(json[0]).toEqual(expect.objectContaining({ kind: expect.any(String), message: expect.any(String), ms: expect.any(Number) }));
    expect(parseTrees(trace).map(r => r.label).sort()).toEqual(['job1', 'job2']);
  });

  test('argument errors', () => {
    expect(run(['explain'], {}).code).toBe(1);
    expect(run(['explain', 'f', '--max', 'x'], { f: '' }).err).toMatch(/--max expects a number/);
    expect(run(['explain', 'missing'], {}).err).toMatch(/ENOENT/);
    expect(run(['explain', 'f'], { f: 'nope' }).err).toMatch(/line 1 is not JSON/);
  });
});

describe('normalizePath', () => {
  test.each([
    ['/users/42', '/users/:id'],
    ['/users/42/orders/7?x=1', '/users/:id/orders/:id'],
    ['/o/3f2b8a9c-1d2e-4f5a-8b9c-0d1e2f3a4b5c', '/o/:id'],
    ['/blob/0123456789abcdef0123', '/blob/:id'],
    ['/t/abcDEF1234567890xyzQW', '/t/:id'],
    ['/api/v2/health', '/api/v2/health'],
    ['', '/'],
  ])('%p -> %p', (input, out) => expect(normalizePath(input)).toBe(out));
});

describe('instrumentHttpServer', () => {
  test('each incoming request is a top-level call with its work nested under it', async () => {
    const roots: ExecutionRecord[] = [];
    const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
    const uninstall = instrumentHttpServer(tp, { ignore: req => req.url === '/health' });
    const lookup = tp.createTrackable(async () => { await sleep(5); return 'ada'; }, { label: 'lookup' });
    const server = http.createServer(async (req, res) => {
      if (req.url === '/health') { res.end('ok'); return; }
      if (req.url === '/boom') { res.statusCode = 503; res.end(); return; }
      if (req.url === '/hang') { req.socket.destroy(); return; }
      res.end(await lookup());
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const get = (p: string) => new Promise<void>(resolve => {
      http.get(base + p, res => { res.resume(); res.on('end', () => resolve()); }).on('error', () => resolve());
    });
    try {
      await Promise.all([get('/users/1'), get('/users/2'), get('/health')]);
      await get('/boom');
      await get('/hang');
      await sleep(20);
    } finally {
      uninstall();
      server.close();
    }
    const labels = roots.map(r => r.label).sort();
    expect(labels).toEqual(['GET /boom', 'GET /hang', 'GET /users/:id', 'GET /users/:id']);
    roots.filter(r => r.label === 'GET /users/:id').forEach(r => {
      expect(r.children.map(c => c.label)).toEqual(['lookup']);
      expect(r.duration).toBeGreaterThanOrEqual(r.children[0].duration);
      expect(r.error).toBeUndefined();
    });
    expect(String(roots.find(r => r.label === 'GET /boom')!.error)).toMatch(/HTTP 503/);
    expect(String(roots.find(r => r.label === 'GET /hang')!.error)).toMatch(/closed before the response/);
    // uninstalled: nothing more is tracked
    expect(Object.prototype.hasOwnProperty.call(http.Server.prototype, 'emit')).toBe(false);
  });
});

describe('autoInstrument', () => {
  test('instruments the server, http and fetch, plus only the database clients the app depends on', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-auto-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '*' } }));
      const tp = createTracePerf({ silent: true });
      const a = autoInstrument(tp, { cwd: dir, disable: ['http'] });
      a.uninstall();
      expect(a.instrumented).toEqual(['server', ...(typeof fetch === 'function' ? ['fetch'] : [])]);

      // This repository depends on pg, mysql2, mongodb and ioredis (dev dependencies)
      const b = autoInstrument(tp, { cwd: path.resolve(__dirname, '..', '..') });
      b.uninstall();
      expect(b.instrumented).toEqual(expect.arrayContaining(['server', 'http', 'pg', 'mysql2', 'mongodb', 'ioredis']));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      expect((require('pg').Client.prototype.query as any)[Symbol.for('traceperf.instrumented')]).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('traceperf/auto (real node process)', () => {
  const root = path.resolve(__dirname, '..', '..');
  // dist/ is built by the Jest global setup

  const appSource = `
const http = require('http');
const busy = ms => { const e = Date.now() + ms; while (Date.now() < e); };
const upstream = http.createServer((req, res) => setTimeout(() => res.end('ok'), 20)).listen(0, '127.0.0.1', () => {
  const up = 'http://127.0.0.1:' + upstream.address().port;
  const get = url => new Promise(r => http.get(url, res => { res.resume(); res.on('end', r); }));
  const app = http.createServer(async (req, res) => {
    if (req.url === '/health') return res.end('ok');
    await get(up + '/a'); await get(up + '/b'); busy(5); res.end('done');
  }).listen(0, '127.0.0.1', async () => {
    const base = 'http://127.0.0.1:' + app.address().port;
    await get(base + '/users/1'); await get(base + '/health');
    app.close(); upstream.close();
  });
});`;

  test.each([
    ['--require', 'app.js'],
    ['--import', 'app.mjs'],
  ])('node %s traceperf/auto %s', (flag, file) => {
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const nodeMinor = Number(process.versions.node.split('.')[1]);
    if (flag === '--import' && (nodeMajor < 18 || (nodeMajor === 18 && nodeMinor < 19))) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-register-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ private: true }));
      fs.mkdirSync(path.join(dir, 'node_modules'));
      fs.symlinkSync(root, path.join(dir, 'node_modules', 'traceperf'), 'dir');
      const source = file.endsWith('.mjs') ? appSource.replace("const http = require('http');", "import http from 'http';") : appSource;
      fs.writeFileSync(path.join(dir, file), source);
      const out = path.join(dir, 'calls.jsonl');
      const stderr = execFileSync(process.execPath, [flag, 'traceperf/auto', file], {
        cwd: dir,
        env: { ...process.env, TRACEPERF_OUTPUT: out, TRACEPERF_IGNORE: '^/health$' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      void stderr;
      const trees = fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      const request = trees.find(t => t.label === 'GET /users/:id');
      expect(request).toBeDefined();
      expect(request.children.map((c: any) => c.label)).toEqual([
        expect.stringMatching(/^http GET 127\.0\.0\.1:\d+\/a$/),
        expect.stringMatching(/^http GET 127\.0\.0\.1:\d+\/b$/),
      ]);
      expect(trees.some(t => t.label === 'GET /health')).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  test('exit summary with stats and explanations on stderr', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-register-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ private: true }));
      fs.mkdirSync(path.join(dir, 'node_modules'));
      fs.symlinkSync(root, path.join(dir, 'node_modules', 'traceperf'), 'dir');
      fs.writeFileSync(path.join(dir, 'app.js'), appSource);
      const result = spawnSync(process.execPath, ['--require', 'traceperf/auto', 'app.js'], {
        cwd: dir, env: { ...process.env, TRACEPERF_SILENT: '1' }, encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/^traceperf: tracking server, http/);
      expect(result.stderr).toMatch(/traceperf summary/);
      expect(result.stderr).toMatch(/GET \/users\/:id\s+1/);
      expect(result.stderr).toMatch(/GET \/users\/:id awaited 2 calls one after another/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe('profileSlowCalls', () => {
  test('summariseProfile counts samples inside the window only', () => {
    const profile = {
      startTime: 1000_000, // µs
      nodes: [
        { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 } },
        { id: 2, callFrame: { functionName: 'parse', url: 'file:///app/a.js', lineNumber: 9, columnNumber: 2 } },
        { id: 3, callFrame: { functionName: '(idle)', url: '', lineNumber: -1, columnNumber: -1 } },
        { id: 4, callFrame: { functionName: 'hash', url: 'file:///app/b.js', lineNumber: 0, columnNumber: 0 } },
      ],
      // one sample per ms from t=1001 ms
      samples: [2, 2, 2, 3, 3, 4, 2, 2],
      timeDeltas: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    };
    const all = summariseProfile(profile, 1000, 1010);
    expect(all.hotspots.map(h => [h.functionName, h.line, h.selfMs])).toEqual([['parse', 10, 4], ['hash', 1, 1]]);
    expect(all.idleMs).toBe(2);
    const part = summariseProfile(profile, 1004, 1006);
    expect(part.samples).toBe(3);
    expect(part.hotspots.map(h => h.functionName)).toEqual(['hash']);
  });

  test('reports the functions that used the CPU during a slow call', async () => {
    const tp = createTracePerf({ silent: true, trackMemory: false });
    const got: Array<{ label: string; profile: SlowCallProfile }> = [];
    const profiler = profileSlowCalls({ threshold: 40, window: 300, onProfile: (call, profile) => got.push({ label: call.label, profile }) });
    expect(profiler.available).toBe(true);
    tp.use(profiler);
    function crunchNumbers() { let s = 0; for (let i = 0; i < 2e8; i++) { s += i % 7; if (s < 0) break; } return s; }
    try {
      await sleep(30);
      const start = Date.now();
      tp.track(() => { while (Date.now() - start < 80) crunchNumbers(); }, { label: 'heavy' });
      tp.track(() => 1, { label: 'fast' });
      await profiler.flush();
    } finally {
      await profiler.stop();
    }
    expect(got.map(g => g.label)).toEqual(['heavy']);
    const { profile } = got[0];
    expect(profile.cpuMs).toBeGreaterThan(40);
    expect(profile.hotspots[0].functionName).toBe('crunchNumbers');
    expect(profile.hotspots[0].url).toMatch(/explain-auto-profile\.test\.ts$/);
  }, 30000);
});

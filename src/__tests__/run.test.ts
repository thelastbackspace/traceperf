/**
 * traceperf run, and the known-slow example apps: each app has one planted
 * cause, and explain() must name it (examples/slow-apps/cases.json).
 */
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { explain, ExplainNode } from '../core/explain';
import { parseRunArgs, runApp, sendLoad, RunArgs } from '../run';
import { parseTrees, report } from '../cli';

process.env.QUIET = '1';
process.env.TRACEPERF_QUIET = '1';
const ROOT = path.join(__dirname, '..', '..');
const APPS = path.join(ROOT, 'examples', 'slow-apps');
const REGISTER = path.join(ROOT, 'dist', 'register.js');

function deps(out: string[], err: string[] = []) {
  return {
    childProcess, fs, http, os, path,
    registerPath: REGISTER,
    report, parseTrees,
    out: (t: string) => out.push(t),
    err: (t: string) => err.push(t),
  };
}

describe('parseRunArgs', () => {
  it('reads options before and after the app, and passes the rest to the app', () => {
    const args = parseRunArgs(['-c', '4', 'server.js', '--path', '/a', '--path', '/b', '-d', '500ms', 'app-arg', '--json']) as RunArgs;
    expect(args.command).toEqual(['server.js', 'app-arg']);
    expect(args.paths).toEqual(['/a', '/b']);
    expect(args.concurrency).toBe(4);
    expect(args.durationMs).toBe(500);
    expect(args.json).toBe(true);
  });

  it('passes everything after -- to the command unchanged', () => {
    const args = parseRunArgs(['--path', '/x', '--', 'npm', 'start', '--path', '/y']) as RunArgs;
    expect(args.command).toEqual(['npm', 'start', '--path', '/y']);
    expect(args.paths).toEqual(['/x']);
  });

  it.each([
    [[], 'run expects an app'],
    [['--path', 'x', 'a.js'], '--path expects'],
    [['-c', '0', 'a.js'], 'positive number'],
    [['-d', 'soon', 'a.js'], 'duration'],
    [['--warmup', '-1', 'a.js'], '--warmup'],
    [['--nope', 'a.js'], 'unknown option'],
  ])('rejects %j', (argv, message) => {
    expect(parseRunArgs(argv as string[])).toEqual(expect.stringContaining(message));
  });

  it('parses durations in s and m', () => {
    expect((parseRunArgs(['a.js', '-d', '2s']) as RunArgs).durationMs).toBe(2000);
    expect((parseRunArgs(['a.js', '-d', '1m']) as RunArgs).durationMs).toBe(60000);
  });
});

describe('sendLoad', () => {
  it('sends the requested number of requests and counts statuses', async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = req.url === '/bad' ? 500 : 200;
      res.end('ok');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const args = parseRunArgs(['a.js', '--path', '/ok', '--path', '/bad', '-n', '20', '-c', '4']) as RunArgs;
      const result = await sendLoad(http, args, port);
      expect(result.requests).toBe(20);
      expect(result.statuses).toEqual({ 200: 10, 500: 10 });
      expect(result.errors).toBe(0);
    } finally {
      server.close();
    }
  });

  it('sends the headers given with -H / --header', async () => {
    const seen: Array<string | undefined> = [];
    const server = http.createServer((req, res) => {
      seen.push(`${req.headers.authorization}|${req.headers['x-tenant']}`);
      res.end('ok');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const args = parseRunArgs(['a.js', '--path', '/', '-n', '2', '-c', '1', '-H', 'Authorization: Bearer a:b', '--header', 'X-Tenant:  7']) as RunArgs;
      expect(args.headers).toEqual({ authorization: 'Bearer a:b', 'x-tenant': '7' });
      await sendLoad(http, args, port);
      expect(seen).toEqual(['Bearer a:b|7', 'Bearer a:b|7']);
    } finally {
      server.close();
    }
    expect(parseRunArgs(['a.js', '-H', 'no-colon'])).toBe('--header expects "Name: value"');
  });

  it('counts connection failures as errors', async () => {
    const args = parseRunArgs(['a.js', '--path', '/', '-n', '3', '-c', '1']) as RunArgs;
    const result = await sendLoad(http, args, 1);
    expect(result.errors).toBe(3);
  });
});

describe('explain on a known N+1 tree', () => {
  it('reports one N+1 finding, not also sequential awaits for the same queries', () => {
    const items: ExplainNode[] = Array.from({ length: 8 }, (_, i) => ({
      label: 'SELECT items', startTime: 5 + i * 3, duration: 3, selfDuration: 3, async: true, children: [],
    }));
    const root: ExplainNode = {
      label: 'GET /orders', startTime: 0, duration: 30, selfDuration: 1, async: true,
      children: [{ label: 'SELECT orders', startTime: 0, duration: 5, selfDuration: 5, async: true, children: [] }, ...items],
    };
    const kinds = explain([root]).map(f => f.kind);
    expect(kinds).toContain('repeated');
    expect(kinds).not.toContain('sequential');
  });

  it('groups sequential awaits in one parent into one finding, and lists errors first', () => {
    const q = (label: string, start: number, error?: string): ExplainNode =>
      ({ label, startTime: start, duration: 10, selfDuration: 10, async: true, error, children: [] });
    const roots: ExplainNode[] = [
      { label: 'GET /d', startTime: 0, duration: 30, selfDuration: 0, async: true, children: [q('a', 0), q('b', 10), q('c', 20)] },
      { label: 'GET /d', startTime: 100, duration: 20, selfDuration: 0, async: true, children: [q('b', 100), q('c', 110, 'boom')], error: 'boom' },
    ];
    const findings = explain(roots);
    expect(findings[0].kind).toBe('error');
    expect(findings.filter(f => f.kind === 'sequential')).toHaveLength(1);
  });
});

const cases: Record<string, { paths: string[]; expect: Array<{ kind: string | string[]; includes: string }> }> =
  JSON.parse(fs.readFileSync(path.join(APPS, 'cases.json'), 'utf8'));

describe('known-slow example apps: explain names the planted cause', () => {
  // Cases that need a real database run where CI provides one (TRACEPERF_PG_URL)
  const runnable = Object.keys(cases).filter(name => !(cases[name] as { requires?: string }).requires || !!process.env.TRACEPERF_PG_URL);
  it.each(runnable)('%s', async name => {
    const c = cases[name];
    const out: string[] = [];
    const argv = [path.join(APPS, name, 'server.js'), ...c.paths.flatMap(p => ['--path', p]), '-d', '1s', '--json'];
    const args = parseRunArgs(argv) as RunArgs;
    const code = await runApp(args, deps(out));
    expect(code).toBe(0);
    const result = JSON.parse(out.join('\n'));
    expect(result.trees).toBeGreaterThan(5);
    for (const e of c.expect) {
      const hit = result.findings.find((f: any) => ([] as string[]).concat(e.kind).includes(f.kind) && f.message.includes(e.includes));
      if (!hit) throw new Error(`${name}: no ${e.kind} finding containing "${e.includes}"; got:\n${result.findings.map((f: any) => `${f.kind}: ${f.message}`).join('\n')}`);
    }
  }, 30000);
});

describe('runApp', () => {
  it('prints the text report, writes HTML and keeps the trees when asked', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-run-test-'));
    const html = path.join(dir, 'r.html');
    const output = path.join(dir, 'calls.jsonl');
    const out: string[] = [];
    const args = parseRunArgs([path.join(APPS, 'sequential', 'server.js'), '--path', '/dashboard', '-n', '20', '--html', html, '--output', output, '--warmup', '0', '--probe', '0']) as RunArgs;
    expect(await runApp(args, deps(out))).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('load: 20 requests');
    expect(text).toContain('Why it was slow:');
    expect(text).toContain('Promise.all');
    expect(fs.readFileSync(html, 'utf8')).toMatch(/<html[\s\S]*Why it was slow/);
    expect(fs.readFileSync(output, 'utf8').trim().split('\n')).toHaveLength(20);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000);

  it('fails clearly when the app exits before listening', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-run-test-'));
    const app = path.join(dir, 'crash.js');
    fs.writeFileSync(app, 'process.exit(3)');
    const err: string[] = [];
    const args = parseRunArgs([app, '--path', '/']) as RunArgs;
    expect(await runApp(args, deps([], err))).toBe(1);
    expect(err.join('\n')).toContain('exited (code 3) before it started listening');
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000);

  it('runs a command through NODE_OPTIONS and reports when nothing was tracked', async () => {
    const out: string[] = [];
    const args = parseRunArgs(['--', process.execPath, '-e', 'setTimeout(() => {}, 10)']) as RunArgs;
    expect(await runApp(args, deps(out))).toBe(0);
    expect(out.join('\n')).toContain('no requests were tracked');
  }, 30000);
});

describe('naming blocking code from CPU profiles', () => {
  // A tiny V8-shaped profile: root > handler > buildReport, plus samples where
  // buildReport was inlined into handler (attributed to handler), and a native
  // frame under hashPassword > pbkdf2Sync (node:internal)
  const { summariseProfile, createInlineHints, learnInlineHints, blockingHotspots } = jest.requireActual('../core/cpu-profile');
  const frame = (functionName: string, url: string, lineNumber: number) => ({ functionName, url, lineNumber, columnNumber: 0, scriptId: '1' });
  const profile = {
    startTime: 0,
    nodes: [
      { id: 1, callFrame: frame('(root)', '', -1), children: [2, 5] },
      { id: 2, callFrame: frame('handler', 'file:///app/server.js', 14), children: [3], positionTicks: [{ line: 15, ticks: 6 }] },
      { id: 3, callFrame: frame('buildReport', 'file:///app/server.js', 2), children: [], positionTicks: [{ line: 6, ticks: 4 }] },
      { id: 5, callFrame: frame('hashPassword', 'file:///app/server.js', 19), children: [6] },
      { id: 6, callFrame: frame('pbkdf2Sync', 'node:internal/crypto/pbkdf2', 40), children: [7] },
      { id: 7, callFrame: frame('run', '', -1), children: [] },
    ],
    // 6 samples in handler (inlined buildReport), 4 in buildReport, 5 native
    samples: [2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 7, 7, 7, 7, 7],
    timeDeltas: Array(15).fill(1000),
  };

  it('without merging, self time stays where V8 put it', () => {
    const p = summariseProfile(profile, 0, 100, 5);
    expect(p.hotspots[0].functionName).toBe('handler');
  });

  it('moves inlined self time to the callee and names native code by its caller', () => {
    const p = summariseProfile(profile, 0, 100, 5, undefined, { mergeInlined: true });
    const names = p.hotspots.map((h: any) => h.functionName);
    expect(names[0]).toBe('buildReport');
    expect(p.hotspots[0].selfMs).toBeCloseTo(10, 0);
    expect(p.hotspots[0].hotLine).toBe(6);
    expect(names).toContain('hashPassword → pbkdf2Sync');
    expect(names).not.toContain('handler');
  });

  it('remembers callers across windows, when a later window only has the inlined form', () => {
    const hints = createInlineHints();
    learnInlineHints(profile, hints);
    const later = { ...profile, nodes: profile.nodes.map(n => (n.id === 2 ? { ...n, children: [] } : n)).filter(n => n.id !== 3), samples: [2, 2, 2], timeDeltas: [1000, 1000, 1000] };
    learnInlineHints(later, hints);
    const p = summariseProfile(later, 0, 100, 5, undefined, { mergeInlined: hints });
    expect(p.hotspots[0].functionName).toBe('buildReport');
  });

  it('sums hotspots per label and function, with paths relative to cwd', () => {
    const spots = blockingHotspots([
      { label: 'GET /r', hotspots: [{ functionName: 'f', url: 'file:///app/a.js', line: 3, column: 1, selfMs: 4, hotLine: 5 }] },
      { label: 'GET /r', hotspots: [{ functionName: 'f', url: 'file:///app/a.js', line: 3, column: 1, selfMs: 1 }, { functionName: 'g', url: '', line: 0, column: 0, selfMs: 2 }] },
    ], { cwd: '/app' });
    expect(spots['GET /r']).toEqual([
      { functionName: 'f', location: 'a.js:5', ms: 5 },
      { functionName: 'g', location: '', ms: 2 },
    ]);
  });

  it('explain names the function in blocking and blocked findings', () => {
    const roots: ExplainNode[] = [
      { label: 'GET /report', startTime: 0, duration: 40, selfDuration: 40, syncDuration: 40, async: true, children: [] },
      { label: 'GET /users', startTime: 1, duration: 45, selfDuration: 45, syncDuration: 0, async: true, children: [] },
    ];
    const findings = explain(roots, { hotspots: { 'GET /report': [{ functionName: 'buildReport', location: 'server.js:10', ms: 38 }, { functionName: 'tiny', location: 'x.js:1', ms: 0.5 }] } });
    const blocking = findings.find(f => f.kind === 'blocking')!;
    expect(blocking.message).toContain('CPU time: buildReport (server.js:10) 99%');
    expect(blocking.message).not.toContain('tiny'); // under 5%
    expect(blocking.call).toBe('GET /report');
    expect(findings.find(f => f.kind === 'blocked')!.message).toContain('blocked the event loop, in buildReport (server.js:10)');
  });
});

describe('baselines (calls per request per route)', () => {
  const { baselineOf, compareBaseline } = jest.requireActual('../run');
  const n = (label: string, children: any[] = []) => ({ label, children });
  const orders = (items: number) => n('GET /orders', [n('pg SELECT orders'), ...Array.from({ length: items }, () => n('pg SELECT items'))]);

  it('takes the median count of each call per request', () => {
    const b = baselineOf([orders(1), orders(1), orders(3), n('GET /health')], []);
    expect(b.routes).toEqual({
      'GET /health': { requests: 1, calls: {} },
      'GET /orders': { requests: 3, calls: { 'pg SELECT items': 1, 'pg SELECT orders': 1 } },
    });
    const withN1 = baselineOf([orders(12)], [{ kind: 'repeated', root: 'GET /orders', ms: 50, message: '' }, { kind: 'blocking', root: 'GET /x', ms: 20, message: '' }]);
    expect(withN1.problems).toEqual(['N+1 in GET /orders']); // blocking is timing, not in the baseline
  });

  it('flags more calls per request and new problems; reports improvements', () => {
    const before = baselineOf([orders(1), n('GET /old')], []);
    const after = baselineOf([orders(12), n('GET /new')], [{ kind: 'repeated', root: 'GET /orders', ms: 50, message: '' }]);
    const r = compareBaseline(before, after);
    expect(r.regressions).toEqual(['GET /orders: pg SELECT items 1 → 12 per request (an N+1?)', 'new problem: N+1 in GET /orders']);
    expect(r.notes).toEqual(['GET /new: new route (not in the baseline)', 'GET /old: not requested in this run']);
    expect(compareBaseline(after, before).improvements).toEqual(['GET /orders: pg SELECT items 12 → 1 per request', 'fixed: N+1 in GET /orders']);
    expect(compareBaseline(before, before)).toEqual({ regressions: [], improvements: [], notes: [] });
  });
});

describe('statusFinding', () => {
  const { statusFinding } = jest.requireActual('../run');
  const load = (statuses: Record<string, number>, errors = 0) => ({ requests: 10, errors, statuses, durationMs: 1, latency: {} });
  it('warns when most responses failed, with a hint for the status', () => {
    const f = statusFinding(load({ 401: 9, 200: 1 }));
    expect(f.message).toBe('9 of 10 responses failed (most: 9× 401 Unauthorized), so the timings below describe error responses, not the endpoints');
    expect(f.fix).toMatch(/-H "Authorization: Bearer \$TOKEN"/);
    expect(statusFinding(load({ 404: 6, 200: 4 })).fix).toMatch(/--path/);
    expect(statusFinding(load({}, 5)).message).toMatch(/most: 5× connection error/);
  });
  it('says nothing when most succeeded', () => {
    expect(statusFinding(load({ 200: 8, 500: 2 }))).toBeUndefined();
  });
});

describe('cpuAdvice', () => {
  const { cpuAdvice } = jest.requireActual('../run');
  const spot = (functionName: string, location: string, ms: number) => ({ functionName, location, ms });
  it('names what to do for the libraries using the CPU', () => {
    const nest = [
      spot('send → end', 'node_modules/express/lib/response.js:170', 26),
      spot('DriverUtils.buildAlias', 'node_modules/typeorm/driver/DriverUtils.js:100', 17),
      spot('escapeRegExp', 'node_modules/typeorm/query-builder/QueryBuilder.js:445', 10),
      spot('render', 'src/view.js:3', 47),
    ];
    const advice = cpuAdvice(nest, 100);
    expect(advice).toMatch(/^Express computes an ETag .*; TypeORM spends CPU .*; beyond that, run more processes/);
    expect(advice.match(/TypeORM/g)).toHaveLength(1);
    // Under 10% of the time: not worth a library-specific hint
    expect(cpuAdvice([spot('x', 'node_modules/mongoose/lib/document.js:1', 5), spot('y', 'src/a.js:1', 95)], 100)).toMatch(/^cut the CPU each request needs/);
  });
});

describe('busyFinding', () => {
  const { busyFinding } = jest.requireActual('../run');
  const load = { requests: 400, errors: 0, statuses: {}, durationMs: 4000, latency: {} };
  const second = (i: number, activeMs: number, extra = {}) => ({ start: 1000 * i, end: 1000 * (i + 1), activeMs, idleMs: 1000 - activeMs, cpuMs: activeMs, ...extra });
  const spot = (functionName: string, url: string, selfMs: number) => ({ functionName, url, line: 10, column: 0, selfMs });

  it('says the app was saturated and where the CPU went', () => {
    const samples = [
      second(0, 100), // before the load: ignored
      ...[1, 2, 3, 4].map(i => second(i, 960)),
      ...[1, 2, 3, 4].map(i => ({ start: 1000 * i, end: 1000 * (i + 1), hotspots: [spot('cloneObject', '/app/node_modules/mongoose/lib/helpers/clone.js', 300), spot('render', '/app/src/view.js', 100)] })),
    ];
    const f = busyFinding(samples, load, { start: 1000, end: 5000 }, '/app');
    expect(f.kind).toBe('busy');
    expect(f.message).toMatch(/^Each request keeps the event loop busy ~9\.6 ms, so one process tops out near 104 requests\/s: at 100\/s here its event loop was busy 96%/);
    expect(f.message).toContain('cloneObject (node_modules/mongoose/lib/helpers/clone.js:10) 75%, render (src/view.js:10) 25%');
    expect(f.fix).toMatch(/\.lean\(\)/);
  });

  it('says nothing when the app had spare capacity', () => {
    expect(busyFinding([1, 2, 3].map(i => second(i, 400)), load, { start: 1000, end: 4000 })).toBeUndefined();
    expect(busyFinding([], load, { start: 0, end: 1 })).toBeUndefined();
    // Saturated, but each request is cheap (2 ms of CPU): that is just a load test at work
    expect(busyFinding([1, 2, 3].map(i => second(i, 960)), { ...load, requests: 1920 }, { start: 1000, end: 4000 })).toBeUndefined();
  });
});

describe('queueFindings', () => {
  const { queueFindings } = jest.requireActual('../run');
  it('reports time clients waited that the app never saw', () => {
    const load = { requests: 4, errors: 0, statuses: {}, durationMs: 1, latency: { '/ping': [180, 190, 185, 200], '/slow': [60, 61, 59, 60] } };
    const trees = [
      ...[0.2, 0.3, 0.2, 0.2].map(d => ({ label: 'GET /ping', duration: d })),
      ...[55, 58, 57, 56].map(d => ({ label: 'GET /slow', duration: d })),
    ];
    const findings = queueFindings(load, trees, 'GET');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('GET /ping took 0.2 ms in the app (median) but clients waited 190 ms');    expect(findings[0].message).toMatch(/see blocking code above/);
    expect(findings[0].fix).toBeUndefined();
    // Nothing blocked: the app is simply at its throughput limit
    const [busy] = queueFindings({ ...load, requests: 800, durationMs: 1000 }, trees, 'GET', false);
    expect(busy.message).toMatch(/waited their turn .* \(800 requests\/s here\)$/);
    expect(busy.fix).toMatch(/throughput limit/);
  });
});

describe('config file and login', () => {
  const read = (text: string) => (file?: string) => (file === 'missing.json' ? undefined : text);

  it('reads options from the file; the command line wins and its --path replaces the file paths', () => {
    const config = JSON.stringify({ app: 'server.js', paths: ['/a', '/b'], concurrency: 4, duration: '2s', headers: { 'X-Key': '${KEY}' }, probe: 0 });
    const fromFile = parseRunArgs([], read(config), { KEY: 'secret' }) as RunArgs;
    expect(fromFile).toMatchObject({ command: ['server.js'], paths: ['/a', '/b'], concurrency: 4, durationMs: 2000, headers: { 'x-key': 'secret' }, probe: 0 });
    const overridden = parseRunArgs(['-c', '8', '--path', '/c'], read(config), {}) as RunArgs;
    expect(overridden).toMatchObject({ command: ['server.js'], paths: ['/c'], concurrency: 8 });
    expect((parseRunArgs(['other.js'], read(config), {}) as RunArgs).command).toEqual(['other.js']);
    expect(parseRunArgs([], read('{'), {})).toMatch(/not valid JSON/);
    expect(parseRunArgs(['--config', 'missing.json', 'x.js'], read(''), {})).toMatch(/could not read missing.json/);
    expect(parseRunArgs([], read('{}'), {})).toMatch(/"app" in the config file/);
  });

  it('logs in first and sends the token from the JSON response with every request', async () => {
    const seen: Array<string | undefined> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (req.url === '/login') {
          const { password } = JSON.parse(body);
          if (password !== 'pw') { res.statusCode = 401; return res.end('bad password'); }
          return res.end(JSON.stringify({ user: { token: 'abc' } }));
        }
        if (req.url === '/cookie-login') { res.setHeader('set-cookie', ['sid=42; HttpOnly', 'theme=dark']); return res.end('{}'); }
        seen.push(req.headers.authorization || req.headers.cookie);
        res.end('ok');
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      const args = parseRunArgs(['x.js']) as RunArgs;
      const { login } = await import('../run');
      expect(await login(http, args, port, { path: '/login', body: { password: 'pw' }, token: 'user.token' })).toEqual({ authorization: 'Bearer abc' });
      expect(await login(http, args, port, { path: '/login', body: { password: 'pw' }, token: 'user.token', header: 'X-Token', prefix: '' })).toEqual({ 'x-token': 'abc' });
      expect(await login(http, args, port, { path: '/cookie-login' })).toEqual({ cookie: 'sid=42; theme=dark' });
      expect(await login(http, args, port, { path: '/login', body: { password: 'no' }, token: 'user.token' })).toMatch(/answered 401: bad password/);
      expect(await login(http, args, port, { path: '/login', body: { password: 'pw' }, token: 'missing.path' })).toMatch(/no "missing.path"/);
      await sendLoad(http, { ...args, paths: ['/x'], requests: 2, concurrency: 1, headers: { authorization: 'Bearer abc' } }, port);
      expect(seen).toEqual(['Bearer abc', 'Bearer abc']);
    } finally {
      server.close();
    }
  });
});

describe('markdownReport', () => {
  const { markdownReport } = jest.requireActual('../run');
  it('leads with the verdict, lists baseline changes, folds the timing findings', () => {
    const md = markdownReport({
      trees: 30, findings: [{ kind: 'repeated', root: 'GET /orders', ms: 40, message: 'GET /orders called q 12 times', fix: 'batch it' }],
      baseline: { regressions: ['GET /orders: q 1 → 12 per request (an N+1?)'], improvements: [], notes: [] }, baselineFile: 'b.json',
      load: { requests: 30, durationMs: 300, statuses: { 200: 30 }, errors: 0, latency: {} },
    });
    expect(md).toMatch(/^### traceperf: ✖ more calls per request than the baseline\n\n- ✖ GET \/orders: q 1 → 12/);
    expect(md).toContain('<details><summary>Why it was slow');
    expect(md).toContain('  - fix: batch it');
    expect(md).toContain('30 requests in 0.3 s (100/s), 30× 200');
    expect(markdownReport({ trees: 5, findings: [], baseline: { regressions: [], improvements: [], notes: [] }, baselineFile: 'b.json' }))
      .toMatch(/^### traceperf: ✔ no new queries or calls\n\n- ✔ same calls per request on every route/);
    expect(markdownReport({ trees: 5, findings: [] })).toMatch(/^### traceperf: no issues found/);
  });
});

describe('indexFindings', () => {
  const { indexFindings } = jest.requireActual('../run');
  const scan = (over: object) => ({ table: 'orders', filter: '(customer_id = 5)', rows: 12, columns: ['customer_id'], tableRows: 60000, ...over });
  it('reports selective full scans of big tables, once per index', () => {
    const [f, ...rest] = indexFindings([
      { driver: 'pg', text: 'SELECT * FROM orders WHERE customer_id = $1', count: 500, scans: [scan({})] },
      { driver: 'pg', text: 'SELECT id FROM orders WHERE customer_id = $1', count: 20, scans: [scan({})] },
    ]);
    expect(rest).toEqual([]);
    expect(f.kind).toBe('index');
    expect(f.message).toMatch(/\(run 500 times\) reads all ~60,000 rows of orders to return ~12/);
    expect(f.fix).toMatch(/^add an index: CREATE INDEX ON orders \(customer_id\)/);
  });
  it('small tables, unselective filters and filters without usable columns are fine', () => {
    expect(indexFindings([{ driver: 'pg', text: 'q', count: 9, scans: [scan({ tableRows: 500 })] }])).toEqual([]);
    expect(indexFindings([{ driver: 'pg', text: 'q', count: 9, scans: [scan({ rows: 30000 })] }])).toEqual([]);
    expect(indexFindings([{ driver: 'pg', text: 'q', count: 9, scans: [scan({ columns: [] })] }])).toEqual([]);
    expect(indexFindings([{ driver: 'pg', text: 'q', count: 9, scans: [scan({ tableRows: 500 })] }], 100)).toHaveLength(1);
  });
});

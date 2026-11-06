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

const cases: Record<string, { paths: string[]; expect: Array<{ kind: string; includes: string }> }> =
  JSON.parse(fs.readFileSync(path.join(APPS, 'cases.json'), 'utf8'));

describe('known-slow example apps: explain names the planted cause', () => {
  it.each(Object.keys(cases))('%s', async name => {
    const c = cases[name];
    const out: string[] = [];
    const argv = [path.join(APPS, name, 'server.js'), ...c.paths.flatMap(p => ['--path', p]), '-d', '1s', '--json'];
    const args = parseRunArgs(argv) as RunArgs;
    const code = await runApp(args, deps(out));
    expect(code).toBe(0);
    const result = JSON.parse(out.join('\n'));
    expect(result.trees).toBeGreaterThan(5);
    for (const e of c.expect) {
      const hit = result.findings.find((f: any) => f.kind === e.kind && f.message.includes(e.includes));
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

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
    const args = parseRunArgs([path.join(APPS, 'sequential', 'server.js'), '--path', '/dashboard', '-n', '20', '--html', html, '--output', output, '--warmup', '0']) as RunArgs;
    expect(await runApp(args, deps(out))).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('load: 20 requests');
    expect(text).toContain('Why it was slow:');
    expect(text).toContain('Promise.all');
    expect(fs.readFileSync(html, 'utf8')).toContain('<html');
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

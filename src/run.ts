/**
 * `traceperf run`: start an app with traceperf/auto, optionally send it
 * concurrent traffic, then print statistics and explanations.
 *
 *   traceperf run server.js                       # use the app, Ctrl-C for the report
 *   traceperf run server.js --path /orders -c 20  # traffic for 5 s, then the report
 *   traceperf run -- npm start                    # any command (via NODE_OPTIONS)
 *
 * Node-only; builtins are passed in so this module stays free of require().
 */
import { explain, formatFindings, Finding } from './core/explain';
import { blockingHotspots, BlockingProfileEntry } from './core/cpu-profile';
import { normalizePath } from './instrument';

export interface RunArgs {
  /** Command and its arguments; a .js/.mjs/.cjs file runs with this Node */
  command: string[];
  paths: string[];
  concurrency: number;
  durationMs: number;
  requests?: number;
  /** Requests per path sent before measuring (not reported), default 3 */
  warmup: number;
  port?: number;
  host: string;
  method: string;
  html?: string;
  output?: string;
  json: boolean;
  max: number;
  /** Sample the CPU to name blocking code (default on) */
  profile: boolean;
  /** Ms to wait for the app to listen before giving up */
  startTimeoutMs: number;
}

export const RUN_USAGE = `  traceperf run <app.js> [app args] [options]
  traceperf run [options] -- <command...>      e.g. -- npm start
      --path /a        send traffic to this path (repeatable); without it,
                       use the app yourself and press Ctrl-C for the report
      -c, --concurrency N   parallel requests (default 10)
      -d, --duration 5s     how long to send traffic (default 5s)
      -n, --requests N      stop after N requests instead
      --port N         app port (default: detected when the app listens)
      --method GET     request method
      --warmup 3       untimed requests per path first (cold start), 0 for none
      --html out.html  write an HTML report
      --output f.jsonl keep the raw request trees
      --json           print stats and findings as JSON
      --no-profile     don't sample the CPU (blocking code is then named
                       only by its tracked call)`;

function parseDuration(value: string | undefined): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value || '');
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : m[2] === 'm' ? n * 60000 : n * 1000;
}

/** Parse `run` arguments; returns an error message on bad input */
export function parseRunArgs(argv: string[]): RunArgs | string {
  const args: RunArgs = {
    command: [], paths: [], concurrency: 10, durationMs: 5000, host: '127.0.0.1',
    method: 'GET', warmup: 3, json: false, profile: true, max: 10, startTimeoutMs: 15000,
  };
  const num = (name: string, v: string | undefined): number | string => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) && n > 0 ? n : `${name} expects a positive number`;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      args.command = argv.slice(i + 1);
      break;
    }
    let v: number | string;
    switch (a) {
      case '--path': {
        const p = argv[++i];
        if (!p || !p.startsWith('/')) return '--path expects a path starting with /';
        args.paths.push(p);
        break;
      }
      case '-c': case '--concurrency':
        if (typeof (v = num(a, argv[++i])) === 'string') return v;
        args.concurrency = Math.floor(v);
        break;
      case '-n': case '--requests':
        if (typeof (v = num(a, argv[++i])) === 'string') return v;
        args.requests = Math.floor(v);
        break;
      case '-d': case '--duration': {
        const d = parseDuration(argv[++i]);
        if (!d) return `${a} expects a duration such as 5s or 500ms`;
        args.durationMs = d;
        break;
      }
      case '--port':
        if (typeof (v = num(a, argv[++i])) === 'string') return v;
        args.port = v;
        break;
      case '--host': args.host = argv[++i] || args.host; break;
      case '--method': args.method = (argv[++i] || 'GET').toUpperCase(); break;
      case '--html': if (!(args.html = argv[++i])) return '--html expects a file'; break;
      case '--output': if (!(args.output = argv[++i])) return '--output expects a file'; break;
      case '--max':
        if (typeof (v = num(a, argv[++i])) === 'string') return v;
        args.max = v;
        break;
      case '--warmup': {
        const w = Number(argv[++i]);
        if (!(w >= 0)) return '--warmup expects a number';
        args.warmup = Math.floor(w);
        break;
      }
      case '--json': args.json = true; break;
      case '--no-profile': args.profile = false; break;
      default:
        // Our options can come before or after the app; anything else after
        // the app is the app's own argument (use -- to pass everything as is)
        if (a.startsWith('-') && !args.command.length) return `unknown option "${a}"`;
        args.command.push(a);
    }
  }
  if (!args.command.length) return 'run expects an app, e.g. traceperf run server.js';
  return args;
}

export interface LoadResult {
  requests: number;
  errors: number;
  statuses: Record<string, number>;
  durationMs: number;
  /** Client-side latency per path (ms), as the load generator saw it */
  latency: Record<string, number[]>;
}

/** Send concurrent requests until the duration or request count is reached */
export function sendLoad(http: any, args: RunArgs, port: number): Promise<LoadResult> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: args.concurrency });
  const result: LoadResult = { requests: 0, errors: 0, statuses: {}, durationMs: 0, latency: {} };
  const start = Date.now();
  const deadline = start + args.durationMs;
  let issued = 0;
  const more = () => (args.requests !== undefined ? issued < args.requests : Date.now() < deadline);
  const one = (path: string) => new Promise<void>(resolve => {
    const sent = Date.now();
    const req = http.request({ host: args.host, port, path, method: args.method, agent }, (res: any) => {
      result.statuses[res.statusCode] = (result.statuses[res.statusCode] || 0) + 1;
      res.resume();
      res.on('end', () => {
        (result.latency[path] = result.latency[path] || []).push(Date.now() - sent);
        resolve();
      });
      res.on('error', resolve);
    });
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', () => {
      result.errors++;
      resolve();
    });
    req.end();
  });
  const worker = async () => {
    while (more()) {
      const path = args.paths[issued++ % args.paths.length];
      await one(path);
      result.requests++;
    }
  };
  return Promise.all(Array.from({ length: args.concurrency }, worker)).then(() => {
    agent.destroy();
    result.durationMs = Date.now() - start;
    return result;
  });
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

/**
 * Time clients waited that the app never saw: a request that arrives while
 * the event loop is blocked waits in the socket before its handler starts,
 * so the server-side duration misses it. Compares the load generator's
 * latency with the request trees, per path.
 */
export function queueFindings(load: LoadResult, trees: Array<{ label: string; duration: number }>, method: string): Finding[] {
  const findings: Finding[] = [];
  for (const [path, latencies] of Object.entries(load.latency)) {
    const label = `${method} ${normalizePath(path)}`;
    const server = trees.filter(t => t.label === label).map(t => t.duration);
    if (server.length === 0 || latencies.length === 0) continue;
    const client50 = percentile(latencies, 50);
    const server50 = percentile(server, 50);
    const gap = client50 - server50;
    if (gap >= 10 && gap >= 0.5 * client50) {
      findings.push({
        kind: 'blocked',
        root: label,
        ms: gap * latencies.length,
        message: `${label} took ${server50.toFixed(1)} ms in the app (median) but clients waited ${client50.toFixed(0)} ms: requests sat queued until the event loop was free (see blocking code above)`,
      });
    }
  }
  return findings;
}

export interface RunSummary {
  stats: string;
  findings: Finding[];
  trees: number;
}

/** Stats and findings from the JSON lines the app wrote (and its blocking profiles) */
export function summarise(
  text: string,
  deps: { report: (t: string, o: any) => string; parseTrees: (t: string) => any[] },
  max = 10,
  profiles: BlockingProfileEntry[] = [],
  cwd?: string,
): RunSummary {
  const trees = deps.parseTrees(text);
  const hotspots = profiles.length ? blockingHotspots(profiles, { cwd }) : undefined;
  return {
    trees: trees.length,
    stats: trees.length ? deps.report(text, { top: 5 }) : '',
    findings: explain(trees, { max, hotspots }),
  };
}

export interface RunDeps {
  childProcess: any;
  fs: any;
  http: any;
  os: any;
  path: any;
  /** Absolute path of dist/register.js */
  registerPath: string;
  report: (text: string, options: any) => string;
  parseTrees: (text: string) => any[];
  out: (t: string) => void;
  err: (t: string) => void;
}

const SCRIPT = /\.(c|m)?js$/;

/** Run the app, apply load if asked, print the report. Resolves to an exit code. */
export async function runApp(args: RunArgs, deps: RunDeps): Promise<number> {
  const { fs, path, os } = deps;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceperf-run-'));
  const output = args.output ? path.resolve(args.output) : path.join(dir, 'calls.jsonl');
  const readyFile = path.join(dir, 'port');
  const profileFile = path.join(dir, 'profiles.jsonl');
  if (args.output) fs.writeFileSync(output, '');
  const env: Record<string, string> = {
    ...process.env,
    TRACEPERF_OUTPUT: output,
    TRACEPERF_SILENT: '1',
    TRACEPERF_SUMMARY: '0',
    TRACEPERF_READY_FILE: readyFile,
    ...(args.profile ? { TRACEPERF_PROFILE_BLOCKING: '1', TRACEPERF_PROFILE_OUTPUT: profileFile } : {}),
  } as Record<string, string>;
  const [cmd, ...cmdArgs] = args.command;
  const quoted = JSON.stringify(deps.registerPath);
  const child = SCRIPT.test(cmd)
    ? deps.childProcess.spawn(process.execPath, ['--require', deps.registerPath, cmd, ...cmdArgs], { stdio: 'inherit', env })
    : deps.childProcess.spawn(cmd, cmdArgs, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS ? env.NODE_OPTIONS + ' ' : ''}--require ${quoted}` },
    });

  let exited = false;
  let exitCode: number | null = null;
  const exitedPromise = new Promise<void>(resolve => {
    child.on('exit', (code: number | null) => {
      exited = true;
      exitCode = code;
      resolve();
    });
    child.on('error', (e: Error) => {
      deps.err(`traceperf: could not start ${cmd}: ${e.message}`);
      exited = true;
      exitCode = 1;
      resolve();
    });
  });
  // Ctrl-C reaches the app too; we wait for it to exit, then report
  const onSigint = () => { /* the app exits; the report follows */ };
  process.on('SIGINT', onSigint);

  let load: LoadResult | undefined;
  let skipBytes = 0;
  try {
    if (args.paths.length) {
      const port = args.port ?? (await waitForPort(fs, readyFile, () => exited, args.startTimeoutMs));
      if (port === undefined) {
        deps.err(exited
          ? `traceperf: the app exited (code ${exitCode}) before it started listening`
          : `traceperf: the app did not start an HTTP server within ${args.startTimeoutMs / 1000} s; pass --port`);
        if (!exited) child.kill('SIGTERM');
        await exitedPromise;
        return 1;
      }
      deps.err(`traceperf: sending ${args.requests ? `${args.requests} requests` : `${args.durationMs / 1000} s of traffic`} to ${args.paths.join(', ')} on port ${port}, ${args.concurrency} at a time`);
      if (args.warmup > 0) {
        await sendLoad(deps.http, { ...args, concurrency: 1, requests: args.warmup * args.paths.length }, port);
        try {
          skipBytes = fs.statSync(output).size;
        } catch {
          skipBytes = 0;
        }
      }
      load = await sendLoad(deps.http, args, port);
      if (!exited) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => !exited && child.kill('SIGKILL'), 3000);
        await exitedPromise;
        clearTimeout(timer);
      }
    } else {
      deps.err('traceperf: app running; use it, then press Ctrl-C for the report');
      await exitedPromise;
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  let text = '';
  try {
    text = fs.readFileSync(output).subarray(skipBytes).toString('utf8');
  } catch {
    text = '';
  }
  const profiles: BlockingProfileEntry[] = [];
  try {
    for (const line of fs.readFileSync(profileFile, 'utf8').split('\n')) {
      if (line.trim()) profiles.push(JSON.parse(line));
    }
  } catch {
    // no profiles: --no-profile, no inspector, or nothing blocked
  }
  const summary = summarise(text, deps, args.max, profiles, process.cwd());
  if (load) {
    const queued = queueFindings(load, deps.parseTrees(text), args.method);
    // After blocking findings, which explain them
    const after = summary.findings.filter(f => f.kind === 'error' || f.kind === 'blocking').length;
    summary.findings.splice(after, 0, ...queued);
  }
  if (args.html && summary.trees) {
    fs.writeFileSync(args.html, deps.report(text, { html: true, title: `traceperf run: ${args.command.join(' ')}` }));
  }
  if (args.json) {
    deps.out(JSON.stringify({ load, trees: summary.trees, findings: summary.findings }, null, 2));
  } else if (!summary.trees) {
    deps.out('\ntraceperf: no requests were tracked.');
  } else {
    const lines = ['', `traceperf: ${summary.trees} request trees`];
    if (load) {
      const statuses = Object.entries(load.statuses).map(([s, n]) => `${n}× ${s}`).join(', ');
      lines.push(`load: ${load.requests} requests in ${(load.durationMs / 1000).toFixed(1)} s (${(load.requests / Math.max(load.durationMs / 1000, 1e-3)).toFixed(0)}/s)${statuses ? `, ${statuses}` : ''}${load.errors ? `, ${load.errors} failed` : ''}`);
    }
    lines.push('', summary.stats, '', 'Why it was slow:', formatFindings(summary.findings));
    if (args.html) lines.push('', `HTML report: ${args.html}`);
    if (args.output) lines.push(`Request trees: ${args.output}`);
    deps.out(lines.join('\n'));
  }
  if (!args.output) fs.rmSync(dir, { recursive: true, force: true });
  // Interactive runs end with Ctrl-C; that is success. A crash before any traffic is not.
  return !summary.trees && exitCode ? 1 : 0;
}

function waitForPort(fs: any, file: string, exited: () => boolean, timeoutMs: number): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const check = () => {
      try {
        const port = Number(fs.readFileSync(file, 'utf8'));
        if (port > 0) return resolve(port);
      } catch {
        // not yet
      }
      if (exited() || Date.now() > deadline) return resolve(undefined);
      setTimeout(check, 50);
    };
    check();
  });
}

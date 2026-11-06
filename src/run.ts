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
  /**
   * Requests per path sent one at a time after the warm-up (default 10, 0
   * for none). Per-request findings (a dominant call, sequential awaits,
   * N+1) come from these: under concurrent load every await also waits for
   * the busy event loop, which inflates call times.
   */
  probe: number;
  port?: number;
  host: string;
  method: string;
  /** Request headers, e.g. { authorization: 'Bearer ...' } */
  headers?: Record<string, string>;
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
      -H, --header "Name: value"   request header, repeatable (e.g. -H "Authorization: Bearer $TOKEN")
      --warmup 3       untimed requests per path first (cold start), 0 for none
      --probe 10       requests per path sent one at a time before the load, for
                       per-request findings with undistorted timings (0: none)
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
    method: 'GET', warmup: 3, probe: 10, json: false, profile: true, max: 10, startTimeoutMs: 15000,
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
      case '-H':
      case '--header': {
        const h = argv[++i] || '';
        const colon = h.indexOf(':');
        if (colon <= 0) return '--header expects "Name: value"';
        args.headers = { ...args.headers, [h.slice(0, colon).trim().toLowerCase()]: h.slice(colon + 1).trim() };
        break;
      }
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
      case '--probe': {
        const n = Number(argv[++i]);
        if (!(n >= 0)) return '--probe expects a number';
        args.probe = Math.floor(n);
        break;
      }
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
    const req = http.request({ host: args.host, port, path, method: args.method, agent, ...(args.headers ? { headers: args.headers } : {}) }, (res: any) => {
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
export function queueFindings(load: LoadResult, trees: Array<{ label: string; duration: number }>, method: string, blocking = true): Finding[] {
  const rate = load.requests / Math.max(load.durationMs / 1000, 1e-3);
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
        message: blocking
          ? `${label} took ${server50.toFixed(1)} ms in the app (median) but clients waited ${client50.toFixed(0)} ms: requests sat queued until the event loop was free (see blocking code above)`
          : `${label} took ${server50.toFixed(1)} ms in the app (median) but clients waited ${client50.toFixed(0)} ms: requests waited their turn while the app's one thread worked through the others (${rate.toFixed(0)} requests/s here)`,
        ...(blocking ? {} : { fix: `this is the app's throughput limit at this load, not one slow call: run more processes (cluster, more instances) or spend less CPU per request; check the CPU time with --concurrency 1 for comparison` }),
      });
    }
  }
  return findings;
}

/** One line of TRACEPERF_LOAD_OUTPUT: event-loop/CPU use, or where the CPU went, for a time range (epoch ms) */
export interface LoadSample {
  start: number;
  end: number;
  activeMs?: number;
  idleMs?: number;
  cpuMs?: number;
  hotspots?: Array<{ functionName: string; url: string; line: number; column: number; selfMs: number }>;
}

const insideWindow = (window: { start: number; end: number }) => (s: LoadSample): boolean => {
  // Samples mostly inside the load (the first and last second are partial)
  const overlap = Math.min(s.end, window.end) - Math.max(s.start, window.start);
  return overlap > 0.5 * (s.end - s.start);
};

/** How busy the app's event loop was during the load, and its main-thread time per request (ms) */
export function loadCost(samples: LoadSample[], load: LoadResult, window: { start: number; end: number }): { busy: number; perRequest: number; rate: number } | undefined {
  const usage = samples.filter(s => typeof s.activeMs === 'number' && insideWindow(window)(s));
  const active = usage.reduce((sum, s) => sum + (s.activeMs || 0), 0);
  const idle = usage.reduce((sum, s) => sum + (s.idleMs || 0), 0);
  if (usage.length === 0 || active + idle <= 0) return undefined;
  // Event-loop (main thread) time, not process CPU: GC and libuv threads add
  // CPU without lowering the single-thread ceiling
  const activeRate = active / usage.reduce((sum, s) => sum + (s.end - s.start), 0);
  const rate = load.requests / Math.max(load.durationMs / 1000, 1e-3);
  return { busy: active / (active + idle), perRequest: rate > 0 ? (activeRate * 1000) / rate : 0, rate };
}

/** Known CPU costs of popular libraries, matched against the hottest functions, and what to do */
const CPU_ADVICE: Array<{ test: RegExp; advice: string }> = [
  { test: /mongoose[\\/]lib[\\/](document|helpers|schema|types)/, advice: 'Mongoose is building full documents: add .lean() to read-only queries (plain objects, often several times less CPU) and .select() only the fields you send' },
  { test: /typeorm[\\/](query-builder|driver[\\/]DriverUtils|metadata|entity-manager|persistence)/, advice: 'TypeORM spends CPU building queries and mapping rows to entities: on hot read paths load fewer relations and columns, or use getRawMany() / a raw query' },
  { test: /sequelize[\\/]lib[\\/](model|instance|utils|dialects)/, advice: 'Sequelize is building model instances: use raw: true on hot read queries and limit attributes / includes' },
  { test: /@prisma[\\/]client[\\/]runtime/, advice: 'Prisma\'s client is serialising queries and results: select only the fields you send and avoid deep include trees on hot paths' },
  { test: /express[\\/]lib[\\/]response\.js|[\\/]etag[\\/]/, advice: "Express computes an ETag (a hash of the body) for every response: app.set('etag', false) if clients don't send conditional requests, and send smaller bodies" },
  { test: /class-transformer|class-validator/, advice: 'class-transformer / class-validator run on every request (NestJS pipes and serialisers): skip them on hot read routes or validate less deeply' },
  { test: /JSON\.stringify|fast-json-stringify|safe-stable-stringify/, advice: 'serialising large responses: paginate, send fewer fields, or use a schema-based serialiser (fast-json-stringify)' },
  { test: /bcrypt|argon2|scrypt|pbkdf2/i, advice: 'password hashing is CPU by design: keep it to login routes, use the async API, and do not hash per request' },
  { test: /winston|pino|morgan|debug[\\/]src|console/, advice: 'logging costs CPU per request: log less on hot routes, avoid pretty formatting in production, prefer pino' },
  { test: /\(garbage collection\)/, advice: 'much of it is garbage collection: allocate less per request (smaller objects and arrays, no needless copies)' },
];

/** Advice for the hottest functions (those with at least 10% of the CPU time), then the general fix */
export function cpuAdvice(spots: Array<{ functionName: string; location: string; ms: number }>, total: number): string {
  const hints: string[] = [];
  for (const h of spots) {
    if (h.ms < 0.1 * total || hints.length >= 2) continue;
    const rule = CPU_ADVICE.find(r => r.test.test(`${h.functionName} ${h.location}`));
    if (rule && !hints.includes(rule.advice)) hints.push(rule.advice);
  }
  const general = 'run more processes (cluster or more instances) so requests stop waiting for each other';
  return hints.length ? `${hints.join('; ')}; beyond that, ${general}` : `cut the CPU each request needs (start with the functions above), or ${general}`;
}

/**
 * The app was saturated *and* each request is expensive (5 ms of CPU or
 * more, a ceiling near 200/s per process): a load test saturates any one
 * process, so cheap requests are not worth a finding. Names where the CPU went.
 */
export function busyFinding(samples: LoadSample[], load: LoadResult, window: { start: number; end: number }, cwd?: string): Finding | undefined {
  const cost = loadCost(samples, load, window);
  if (!cost || cost.busy < 0.8 || cost.perRequest < 5) return undefined;
  const { busy, perRequest, rate } = cost;
  const inside = insideWindow(window);
  const entries = samples.filter(s => s.hotspots && inside(s)).map(s => ({ label: 'all', hotspots: s.hotspots! }));
  const spots = entries.length ? blockingHotspots(entries, { cwd, top: 8 }).all || [] : [];
  const total = spots.reduce((sum, h) => sum + h.ms, 0);
  const shown = spots.filter(h => h.ms >= 0.04 * total).slice(0, 4)
    .map(h => `${h.functionName}${h.location ? ` (${h.location})` : ''} ${Math.round((h.ms / Math.max(total, 1e-9)) * 100)}%`);
  const where = shown.length ? `; CPU time went to: ${shown.join(', ')}` : '';
  const fix = cpuAdvice(spots, total);
  return {
    kind: 'busy',
    root: 'process',
    ms: (busy * load.durationMs),
    message: `Each request keeps the event loop busy ~${perRequest.toFixed(1)} ms, so one process tops out near ${Math.round(1000 / perRequest)} requests/s: at ${rate.toFixed(0)}/s here its event loop was busy ${Math.round(busy * 100)}% of the time and requests queued for the CPU (most of their latency is waiting, not slow code)${where}`,
    fix,
  };
}

const STATUS_TEXT: Record<string, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
};

/** Most responses were errors: the timings describe error handling, not the endpoint */
export function statusFinding(load: LoadResult): Finding | undefined {
  const total = Object.values(load.statuses).reduce((a, b) => a + b, 0) + load.errors;
  const failed = Object.entries(load.statuses).filter(([s]) => Number(s) >= 400);
  const failedCount = failed.reduce((sum, [, n]) => sum + n, 0) + load.errors;
  if (total === 0 || failedCount < 0.5 * total) return undefined;
  const [top, n] = failed.sort((a, b) => b[1] - a[1])[0] || ['connection error', load.errors];
  const what = /^\d+$/.test(top) ? `${top}${STATUS_TEXT[top] ? ` ${STATUS_TEXT[top]}` : ''}` : top;
  const hint = top === '401' || top === '403'
    ? 'pass credentials with -H, e.g. -H "Authorization: Bearer $TOKEN" (an expired token gives this too)'
    : top === '404' ? 'check the --path values' : 'look at the app output above for the error';
  return {
    kind: 'error',
    root: 'load',
    ms: 0,
    message: `${failedCount} of ${total} responses failed (most: ${n}× ${what}), so the timings below describe error responses, not the endpoints`,
    fix: hint,
  };
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
  const loadFile = path.join(dir, 'load.jsonl');
  let loadWindow: { start: number; end: number } | undefined;
  if (args.output) fs.writeFileSync(output, '');
  const env: Record<string, string> = {
    ...process.env,
    TRACEPERF_OUTPUT: output,
    TRACEPERF_SILENT: '1',
    TRACEPERF_SUMMARY: '0',
    TRACEPERF_READY_FILE: readyFile,
    ...(args.profile ? { TRACEPERF_PROFILE_BLOCKING: '1', TRACEPERF_PROFILE_OUTPUT: profileFile } : {}),
    TRACEPERF_LOAD_OUTPUT: loadFile,
  } as Record<string, string>;
  const [cmd, ...cmdArgs] = args.command;
  const quoted = JSON.stringify(deps.registerPath);
  // Own process group (POSIX): `npx tsx app.ts` is three processes, and
  // stopping only the first would leave the app running with our stdout
  const group = process.platform !== 'win32';
  const child = SCRIPT.test(cmd)
    ? deps.childProcess.spawn(process.execPath, ['--require', deps.registerPath, cmd, ...cmdArgs], { stdio: 'inherit', env, detached: group })
    : deps.childProcess.spawn(cmd, cmdArgs, {
      stdio: 'inherit',
      detached: group,
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
  /** Any process of the app's group still running (npx can exit while tsx's child lives on) */
  const groupAlive = (): boolean => {
    if (!group || !child.pid) return !exited;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  /** Stop the app: the whole group, SIGKILL after a grace period */
  const stopAndWait = async (): Promise<void> => {
    stop('SIGTERM');
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (groupAlive() || !exited)) await new Promise(r => setTimeout(r, 50));
    if (groupAlive() || !exited) stop('SIGKILL', true);
    await exitedPromise;
  };
  const stop = (signal: NodeJS.Signals, force = false) => {
    if (exited && !force) return;
    try {
      if (group && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      child.kill(signal);
    }
  };
  // The app has its own process group, so Ctrl-C is passed on by us; it
  // exits, then the report follows. If we are terminated, so is the app.
  const onSigint = () => stop('SIGINT');
  const onSigterm = () => {
    stopAndWait().then(() => process.exit(143), () => process.exit(143));
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  let load: LoadResult | undefined;
  let skipBytes = 0;
  let probeFrom: number | undefined;
  const sizeNow = async (): Promise<number> => {
    // The last trees are written just after their responses
    await new Promise(r => setTimeout(r, 100));
    try {
      return fs.statSync(output).size;
    } catch {
      return 0;
    }
  };
  try {
    if (args.paths.length) {
      const port = args.port ?? (await waitForPort(fs, readyFile, () => exited, args.startTimeoutMs));
      if (port === undefined) {
        deps.err(exited
          ? `traceperf: the app exited (code ${exitCode}) before it started listening`
          : `traceperf: the app did not start an HTTP server within ${args.startTimeoutMs / 1000} s; pass --port`);
        await stopAndWait();
        return 1;
      }
      deps.err(`traceperf: sending ${args.requests ? `${args.requests} requests` : `${args.durationMs / 1000} s of traffic`} to ${args.paths.join(', ')} on port ${port}, ${args.concurrency} at a time`);
      if (args.warmup > 0) {
        await sendLoad(deps.http, { ...args, concurrency: 1, requests: args.warmup * args.paths.length }, port);
        skipBytes = await sizeNow();
      }
      // One at a time: timings not inflated by queueing (only useful when the load is concurrent)
      if (args.probe > 0 && args.concurrency > 1) {
        probeFrom = skipBytes;
        await sendLoad(deps.http, { ...args, concurrency: 1, requests: args.probe * args.paths.length }, port);
        skipBytes = await sizeNow();
      }
      const loadStart = Date.now();
      load = await sendLoad(deps.http, args, port);
      loadWindow = { start: loadStart, end: Date.now() };
      // One more load sample covers the last second
      await new Promise(r => setTimeout(r, 1100));
      await stopAndWait();
    } else {
      deps.err('traceperf: app running; use it, then press Ctrl-C for the report');
      await exitedPromise;
      // The first process can exit before the rest of the group (npx, tsx)
      if (groupAlive()) await stopAndWait();
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }

  let text = '';
  let probeText = '';
  try {
    const all = fs.readFileSync(output);
    // If a cut fell inside a tree still being written, move it to the next whole line
    const align = (at: number) => {
      if (at <= 0 || at >= all.length || all[at - 1] === 0x0a) return Math.min(Math.max(at, 0), all.length);
      const nl = all.indexOf(0x0a, at);
      return nl === -1 ? all.length : nl + 1;
    };
    const from = align(skipBytes);
    text = all.subarray(from).toString('utf8');
    if (probeFrom !== undefined) probeText = all.subarray(align(probeFrom), from).toString('utf8');
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
  // Per-request structure from the one-at-a-time probe, where call times are not inflated by queueing
  const STRUCTURAL = ['dominant', 'sequential', 'repeated'];
  if (probeText.trim()) {
    const structural = explain(deps.parseTrees(probeText), { max: args.max }).filter(f => STRUCTURAL.includes(f.kind));
    summary.findings = [...summary.findings.filter(f => !STRUCTURAL.includes(f.kind)), ...structural].slice(0, args.max);
  }
  if (load) {
    const failing = statusFinding(load);
    if (failing) summary.findings.unshift(failing);
    const blocked = summary.findings.some(f => f.kind === 'blocking');
    let queued = queueFindings(load, deps.parseTrees(text), args.method, blocked);
    let samples: LoadSample[] = [];
    try {
      samples = fs.readFileSync(loadFile, 'utf8').split('\n').filter((l: string) => l.trim()).map((l: string) => JSON.parse(l));
    } catch {
      samples = [];
    }
    const busy = loadWindow ? busyFinding(samples, load, loadWindow, process.cwd()) : undefined;
    const cost = loadWindow ? loadCost(samples, load, loadWindow) : undefined;
    // Queueing with nothing blocking and cheap requests: the load test filled the process, as it does
    if (!blocked && cost && cost.perRequest < 5) queued = [];
    if (busy) {
      // Saturated: "time outside tracked calls" is a symptom of it, not a cause
      // ... and so is a call that is slow only in the tail (it waited for the CPU)
      const tailOnly = (f: Finding) => {
        const m = /\(in (\d+) of (\d+) /.exec(f.message);
        return !!m && Number(m[1]) < 0.2 * Number(m[2]);
      };
      const rest = summary.findings.filter(f => !(f.kind === 'dominant' && (f.message.includes('outside any tracked call') || tailOnly(f))));
      if (blocked) {
        // Blocking code is why it is saturated: blocking, then who waited, then the overall picture
        const after = rest.filter(f => f.kind === 'error' || f.kind === 'blocking').length;
        summary.findings = [...rest.slice(0, after), ...queued, busy, ...rest.slice(after)];
      } else {
        summary.findings = [busy, ...rest];
      }
      queued = [];
    }
    // After blocking findings, which explain them
    const after = summary.findings.filter(f => f.kind === 'error' || f.kind === 'blocking').length;
    summary.findings.splice(after, 0, ...queued);
  }
  if (args.html && summary.trees) {
    fs.writeFileSync(args.html, deps.report(text, { html: true, findings: summary.findings, title: `traceperf run: ${args.command.join(' ')}` }));
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

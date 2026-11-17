/**
 * `traceperf test`: run the app's own test suite with traceperf/auto preloaded
 * and report the database and HTTP calls each route makes per request.
 *
 *   traceperf test -- npm test
 *   traceperf test --baseline perf-baseline.json -- npx vitest run
 *
 * No paths, no load: the requests are the ones the tests already make
 * (supertest, fetch against a test server). Counts, not timings, so the
 * result is the same on every machine and safe to gate a pull request on.
 * Node-only; builtins are passed in so this module stays free of require().
 */
import { explain, formatFindings, Finding } from './core/explain';
import { Baseline, baselineOf, compareBaseline, markdownReport } from './run';

export interface TestArgs {
  command: string[];
  saveBaseline?: string;
  baseline?: string;
  markdown?: string;
  json: boolean;
  output?: string;
  max: number;
}

export const TEST_USAGE = `  traceperf test [options] -- <test command...>   e.g. -- npm test
      counts the queries and HTTP calls each route makes during your tests
      (supertest, fetch to a test server; Jest, Vitest, Mocha, node:test)
      --save-baseline f.json   save calls per request for each route (commit it)
      --baseline f.json        compare with it; exit 1 if a route makes more calls
                               or a new N+1 appears
      --markdown f.md  write a Markdown summary (for a PR comment or job summary)
      --json           print routes, findings and the comparison as JSON
      --output f.jsonl keep the raw request trees`;

export function parseTestArgs(argv: string[]): TestArgs | string {
  const args: TestArgs = { command: [], json: false, max: 10 };
  const dash = argv.indexOf('--');
  const options = dash === -1 ? argv : argv.slice(0, dash);
  args.command = dash === -1 ? [] : argv.slice(dash + 1);
  for (let i = 0; i < options.length; i++) {
    const a = options[i];
    const value = () => {
      const v = options[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === '--save-baseline') args.saveBaseline = value();
      else if (a === '--baseline') args.baseline = value();
      else if (a === '--markdown') args.markdown = value();
      else if (a === '--output') args.output = value();
      else if (a === '--json') args.json = true;
      else if (a === '--max') args.max = Math.max(1, Number(value()) || 10);
      else return `unknown option ${a}`;
    } catch (e) {
      return (e as Error).message;
    }
  }
  if (!args.command.length) return 'give the test command after --, e.g. traceperf test -- npm test';
  return args;
}

interface TreeNode { label: string; children: TreeNode[] }

/** Request trees only: the test client's own outgoing calls (supertest's http GET) are roots too */
export function requestTrees<T extends TreeNode>(trees: T[]): T[] {
  return trees.filter(t => !/^(http|https|fetch) /.test(t.label));
}

/** "GET /users  6 calls per request (pg SELECT ×6)" for each route */
export function routeTable(baseline: Baseline): string {
  const rows = Object.entries(baseline.routes).map(([route, r]) => {
    const total = Object.values(r.calls).reduce((a, b) => a + b, 0);
    const parts = Object.entries(r.calls).sort((a, b) => b[1] - a[1]).map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
    return [route, String(r.requests), String(total), parts.join(', ')];
  });
  if (!rows.length) return '';
  const head = ['route', 'requests', 'calls/request', 'calls'];
  const all = [head, ...rows];
  const widths = head.map((_, i) => Math.max(...all.map(r => r[i].length)));
  return all.map((r, ri) => r.map((c, i) => (i === 3 ? c : i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')
    + (ri === 0 ? `\n${widths.map((w, i) => '-'.repeat(i === 3 ? 5 : w)).join('  ')}` : '')).join('\n');
}

export interface TestDeps {
  childProcess: any;
  fs: any;
  os: any;
  path: any;
  registerPath: string;
  parseTrees: (text: string) => any[];
  /** Dependencies of the app (package.json), for ORM-specific advice */
  libraries?: string[];
  out: (t: string) => void;
  err: (t: string) => void;
}

/** Run the tests, print the report. Resolves to an exit code: the tests' own when they fail. */
export async function runTests(args: TestArgs, deps: TestDeps): Promise<number> {
  const { fs, path, os } = deps;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceperf-test-'));
  const output = args.output ? path.resolve(args.output) : path.join(dir, 'calls.jsonl');
  fs.writeFileSync(output, '');
  const quoted = JSON.stringify(deps.registerPath);
  const env = {
    ...process.env,
    TRACEPERF_OUTPUT: output,
    TRACEPERF_SILENT: '1',
    TRACEPERF_SUMMARY: '0',
    TRACEPERF_QUIET: '1',
    TRACEPERF_TEST: '1',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : ''}--require ${quoted}`,
  };
  const [cmd, ...cmdArgs] = args.command;
  const code: number = await new Promise(resolve => {
    const child = deps.childProcess.spawn(cmd, cmdArgs, { stdio: 'inherit', env, shell: process.platform === 'win32' });
    child.on('exit', (c: number | null, signal: string | null) => resolve(c ?? (signal ? 1 : 0)));
    child.on('error', (e: Error) => {
      deps.err(`traceperf: could not start ${cmd}: ${e.message}`);
      resolve(127);
    });
  });
  // Test runners can exit before a worker's last batch is written; it is flushed on the worker's exit
  let text = '';
  try {
    text = fs.readFileSync(output, 'utf8');
  } catch {
    text = '';
  }
  const trees = requestTrees(deps.parseTrees(text));
  // Counts only: timings inside a test suite (cold caches, parallel workers) say little
  const findings: Finding[] = explain(trees, { max: args.max, libraries: deps.libraries }).filter(f => f.kind === 'repeated');
  const current = baselineOf(trees, findings);
  let comparison: ReturnType<typeof compareBaseline> | undefined;
  let baselineError: string | undefined;
  if (args.saveBaseline && trees.length) fs.writeFileSync(args.saveBaseline, JSON.stringify(current, null, 2) + '\n');
  if (args.baseline) {
    try {
      comparison = compareBaseline(JSON.parse(fs.readFileSync(args.baseline, 'utf8')), current);
    } catch (e) {
      baselineError = `traceperf: could not read the baseline ${args.baseline}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (args.markdown) {
    fs.writeFileSync(args.markdown, markdownReport({ findings, baseline: comparison, baselineFile: args.baseline, baselineError, trees: trees.length }));
  }
  if (args.json) {
    deps.out(JSON.stringify({ testExitCode: code, requests: trees.length, routes: current.routes, findings, ...(comparison ? { baseline: comparison } : {}) }, null, 2));
  } else if (!trees.length) {
    deps.out(`\ntraceperf: the tests made no HTTP requests to a server in their own process, so there was nothing to count.\n`
      + `  It counts requests the tests send to the app (supertest, or fetch to a server the tests start). Tests that call\n`
      + `  functions directly, or a server started in another process, aren't seen.`);
  } else {
    const lines = ['', `traceperf: ${trees.length} requests during the tests`, '', routeTable(current)];
    if (findings.length) lines.push('', formatFindings(findings));
    if (args.saveBaseline) lines.push('', `Baseline saved: ${args.saveBaseline}`);
    if (comparison) {
      lines.push('', `Compared with ${args.baseline}:`);
      comparison.regressions.forEach(r => lines.push(`  ✖ ${r}`));
      comparison.improvements.forEach(r => lines.push(`  ✔ ${r}`));
      comparison.notes.forEach(r => lines.push(`  · ${r}`));
      if (!comparison.regressions.length && !comparison.improvements.length) lines.push('  ✔ same calls per request on every route');
    }
    deps.out(lines.join('\n'));
  }
  if (baselineError) deps.err(baselineError);
  if (!args.output) fs.rmSync(dir, { recursive: true, force: true });
  if (code !== 0) {
    deps.err(`traceperf: the tests failed (exit ${code})`);
    return code;
  }
  return baselineError || (comparison && comparison.regressions.length) ? 1 : 0;
}

/**
 * traceperf report CLI
 */
import { createTracePerf, jsonLinesExporter } from '../index';
import { compare, main, parseCalls, report } from '../cli';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function sample() {
  const lines: string[] = [];
  const tp = createTracePerf({ silent: true, plugins: [jsonLinesExporter(l => lines.push(l))] });
  const recording = tp.startTrace();
  const query = tp.createTrackable(() => sleep(5), { label: 'db.query' });
  const fail = tp.createTrackable(async () => { throw new Error('boom'); }, { label: 'cache.get' });
  for (let i = 0; i < 3; i++) {
    await tp.track(async () => {
      await query();
      await query();
      await fail().catch(() => undefined);
    }, { label: 'GET /users' });
  }
  return { trace: JSON.stringify(recording.stop()), jsonl: lines.join('\n') };
}

test('reads JSON lines and Chrome traces into the same calls', async () => {
  const { trace, jsonl } = await sample();
  for (const input of [trace, jsonl]) {
    const calls = parseCalls(input);
    expect(calls).toHaveLength(12);
    expect(calls.filter(c => c.label === 'db.query')).toHaveLength(6);
    expect(calls.find(c => c.label === 'db.query')!.path).toBe('GET /users > db.query');
    expect(calls.filter(c => c.error === 'boom')).toHaveLength(3);
  }
});

test('report prints stats and the slowest calls', async () => {
  const { jsonl } = await sample();
  const text = report(jsonl, { top: 2 });
  expect(text).toMatch(/^12 calls, 3 labels \(sorted by total\)/);
  expect(text).toMatch(/GET \/users\s+3\s+0/);
  expect(text).toMatch(/cache\.get\s+3\s+3/);
  expect(text).toMatch(/Slowest 2 calls:\n\s+[\d.]+ ms  GET \/users\n/);
});

test('--json and --sort', async () => {
  const { trace } = await sample();
  const json = JSON.parse(report(trace, { json: true, top: 1 }));
  expect(json.calls).toBe(12);
  expect(json.stats['db.query'].count).toBe(6);
  expect(json.slowest).toHaveLength(1);
  const byCount = report(trace, { sort: 'count' }).split('\n');
  expect(byCount[4]).toMatch(/^db\.query/);
});

test('main(): usage, errors and exit codes', async () => {
  const { jsonl } = await sample();
  const run = (argv: string[], files: Record<string, string> = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, {
      readFile: p => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]; },
      readStdin: () => jsonl,
      out: t => out.push(t),
      err: t => err.push(t),
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  expect(run([]).code).toBe(1);
  expect(run(['--help'])).toMatchObject({ code: 0 });
  expect(run(['nope']).err).toContain('unknown command');
  expect(run(['report']).code).toBe(1);
  expect(run(['report', 'missing.json']).err).toContain('ENOENT');
  expect(run(['report', 'x', '--sort', 'weird'], { x: jsonl }).code).toBe(1);
  expect(run(['report', 'bad'], { bad: 'not json' }).err).toContain('line 1 is not JSON');
  expect(run(['report', 'f.jsonl', '--top', '1'], { 'f.jsonl': jsonl })).toMatchObject({ code: 0 });
  expect(run(['report', '-']).out).toContain('12 calls');
});

test('--html writes a self-contained report with one bar per call', async () => {
  const { trace, jsonl } = await sample();
  for (const input of [trace, jsonl]) {
    const files: Record<string, string> = { in: input };
    const out: string[] = [];
    const code = main(['report', 'in', '--html', 'r.html'], {
      readFile: p => files[p], readStdin: () => '', writeFile: (p, c) => { files[p] = c; },
      out: t => out.push(t), err: t => out.push(t),
    });
    expect(code).toBe(0);
    const html = files['r.html'];
    expect(html).toMatch(/^<!doctype html>/);
    expect(html.match(/<g class="call">/g)).toHaveLength(12);
    expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)/);
    expect(html).toContain('GET /users &gt; db.query');
    expect(html).toContain('#d73a49'); // failed calls are red
  }
});

test('the HTML report lists findings, each linked to its time range on the chart', async () => {
  const { trace, jsonl } = await sample();
  for (const input of [trace, jsonl]) {
    const html = report(input, { html: true });
    expect(html).toContain('Why it was slow');
    // the failing cache.get is a finding with evidence: link and band share an id
    const link = html.match(/<a href="#(ev-\d+)">✖ cache\.get in GET \/users failed/);
    expect(link).not.toBeNull();
    expect(html).toContain(`<rect id="${link![1]}" class="ev"`);
    expect(html).toMatch(/rect\.ev:target/);
    expect(html).not.toMatch(/<script/);
  }
  // Findings passed in (as traceperf run does) replace the computed ones; no evidence, no link
  const html = report(jsonl, { html: true, findings: [{ kind: 'dominant', root: 'x', ms: 1, message: 'given <finding>' }] });
  expect(html).toContain('<li>● given &lt;finding&gt;</li>');
  expect(html).not.toContain('class="ev"');
  expect(report(jsonl, { html: true, findings: [] })).not.toContain('Why it was slow');
});

function runLog(durations: Record<string, number[]>): string {
  // Synthetic JSON lines: one root per call
  return Object.entries(durations).flatMap(([label, ds]) => ds.map(d => JSON.stringify({
    label, start: new Date(0).toISOString(), durationMs: d, selfMs: d, syncMs: d, async: false, children: [],
  }))).join('\n');
}

test('compare flags regressions and improvements, ignores noise', () => {
  const before = runLog({ 'db.query': [10, 10, 10, 10], render: [5, 5, 5, 5], tiny: [0.1, 0.1], gone: [1] });
  const after = runLog({ 'db.query': [15, 15, 15, 15], render: [2, 2, 2, 2], tiny: [0.3, 0.3], fresh: [4] });
  const result = compare(before, after);
  const status = Object.fromEntries(result.rows.map(r => [r.label, r.status]));
  expect(status).toEqual({ 'db.query': 'regressed', render: 'improved', tiny: 'unchanged', fresh: 'added', gone: 'removed' });
  expect(result.regressions).toBe(1);
  expect(result.text).toMatch(/db\.query\s+10\.000\s+15\.000\s+\+50\.0%\s+regressed/);
  expect(result.text).toContain('1 label regressed by more than 10% (p95');
  expect(compare(before, after, { threshold: 60 }).regressions).toBe(0);
  expect(compare(before, after, { minCalls: 5 }).rows.find(r => r.label === 'db.query')!.status).toBe('skipped');
});

test('compare --fail exit code for CI', () => {
  const files = {
    a: runLog({ q: [10, 10] }),
    b: runLog({ q: [20, 20] }),
  } as Record<string, string>;
  const run = (argv: string[]) => {
    const out: string[] = [];
    const code = main(argv, { readFile: p => files[p], readStdin: () => '', out: t => out.push(t), err: t => out.push(t) });
    return { code, out: out.join('\n') };
  };
  expect(run(['compare', 'a', 'b']).code).toBe(0);
  expect(run(['compare', 'a', 'b', '--fail']).code).toBe(1);
  expect(run(['compare', 'a', 'a', '--fail']).code).toBe(0);
  expect(JSON.parse(run(['compare', 'a', 'b', '--json']).out).regressions).toBe(1);
  expect(run(['compare', 'a']).code).toBe(1);
  expect(run(['compare', 'a', 'b', '--metric', 'bogus']).code).toBe(1);
});

/**
 * traceperf report CLI
 */
import { createTracePerf, jsonLinesExporter } from '../index';
import { main, parseCalls, report } from '../cli';

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

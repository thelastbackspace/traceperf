import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWatcher } from '../watch';
import { main } from '../cli';

const line = (label: string, ms: number, children: object[] = [], error?: string) =>
  JSON.stringify({ label, durationMs: ms, selfMs: ms, children, ...(error ? { error } : {}) });

test('ingests partial lines, nested children, invalid lines; sorts and rates', () => {
  const w = createWatcher({ sort: 'p95', rateWindow: 1000 });
  const full = `${line('GET /a', 10, [JSON.parse(line('db', 8))])}\n${line('GET /b', 50, [], 'boom')}\nnot json\n`;
  w.ingest(full.slice(0, 20), 0);
  expect(w.frame('t', 0)).toContain('waiting for data');
  w.ingest(full.slice(20), 0);
  const frame = w.frame('t', 0);
  expect(frame).toContain('3 calls');
  expect(frame).toContain('1 invalid lines');
  expect(frame).toContain('3.0 calls/s');
  const rows = frame.split('\n').filter(l => /^(GET|db)/.test(l));
  expect(rows.map(r => r.split(/\s{2,}/)[0])).toEqual(['GET /b', 'GET /a', 'db']);
  expect(rows[0]).toMatch(/GET \/b\s+1\s+1\s/);
  expect(w.frame('t', 5000)).toContain('0.0 calls/s');
  w.reset();
  expect(w.frame('t', 0)).toContain('waiting for data');
});

test('watch --once prints a frame; argument errors', () => {
  const out: string[] = [];
  const io = { readFile: () => `${line('x', 1)}\n${line('x', 3)}`, readStdin: () => '', out: (t: string) => out.push(t), err: (t: string) => out.push(t) };
  expect(main(['watch', 'f', '--once', '--sort', 'max'], io)).toBe(0);
  expect(out.join('\n')).toMatch(/max▼/);
  expect(out.join('\n')).not.toContain('calls/s');
  expect(main(['watch'], io)).toBe(1);
  expect(main(['watch', 'f', '--sort', 'nope', '--once'], io)).toBe(1);
  expect(main(['watch', 'f', '--interval', '5', '--once'], io)).toBe(1);
});

test('live: follows the file as it grows and survives truncation', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceperf-watch-'));
  const file = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(file, `${line('first', 5)}\n`);
  const child = spawn(process.execPath, [path.join(root, 'dist/cli.js'), 'watch', file, '--interval', '100'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => { output += d.toString(); });
  const waitFor = async (re: RegExp) => {
    for (let i = 0; i < 100 && !re.test(output); i++) await new Promise(r => setTimeout(r, 50));
    expect(output).toMatch(re);
  };
  try {
    await waitFor(/first/);
    fs.appendFileSync(file, `${line('second', 9)}\n${line('second', 11)}`); // last line without newline yet
    await waitFor(/second\s+1\s/);
    fs.appendFileSync(file, '\n');
    await waitFor(/second\s+2\s/);
    fs.writeFileSync(file, `${line('afterTruncate', 1)}\n`);
    await waitFor(/afterTruncate/);
    const lastFrame = output.trim().split('\n\n').slice(-2).join('\n\n');
    expect(lastFrame).not.toMatch(/^second/m);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

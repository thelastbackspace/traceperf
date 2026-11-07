#!/usr/bin/env node
// Scores `traceperf run` on the apps in examples/slow-apps: every planted
// problem it names is a hit, every one it misses is a miss, and every finding
// that matches no expectation is a false alarm (on a clean app, all of them).
//
//   npm run build && node scripts/eval.js [case-prefix] [--show]
//
// Exits 1 on any miss or false alarm, so CI keeps the score at 100%.
// Cases with "requires": "pg" run only when TRACEPERF_PG_URL is set.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPS = path.join(ROOT, 'examples', 'slow-apps');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const cases = JSON.parse(fs.readFileSync(path.join(APPS, 'cases.json'), 'utf8'));

const argv = process.argv.slice(2);
const show = argv.includes('--show');
const only = argv.find(a => !a.startsWith('--'));

function run(name, c) {
  const args = [CLI, 'run', path.join(APPS, name, 'server.js'), ...c.paths.flatMap(p => ['--path', p]), '-d', c.duration || '1.5s', '--json', ...(c.args || [])];
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { env: { ...process.env, QUIET: '1', TRACEPERF_QUIET: '1', ...(c.env || {}) }, maxBuffer: 64 * 1024 * 1024, timeout: 120000 }, (error, stdout, stderr) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`${name}: no JSON output (${error ? error.message : 'exit 0'})\n${stderr}`));
      }
    });
  });
}

// kind may be a list: either answer is right (e.g. blocking or busy, depending on machine speed)
const matches = (f, e) => [].concat(e.kind).includes(f.kind) && f.message.includes(e.includes);

(async () => {
  let hits = 0, misses = 0, falseAlarms = 0, cleanApps = 0, cleanPassed = 0;
  const lines = [];
  for (const [name, c] of Object.entries(cases)) {
    if (only && !name.startsWith(only)) continue;
    if (c.requires === 'pg' && !process.env.TRACEPERF_PG_URL) {
      lines.push(`skip  ${name}: needs TRACEPERF_PG_URL`);
      continue;
    }
    let result;
    try {
      result = await run(name, c);
    } catch (error) {
      misses += c.expect.length || 1;
      lines.push(`FAIL  ${name}: ${error.message}`);
      continue;
    }
    const findings = result.findings || [];
    const missed = c.expect.filter(e => !findings.some(f => matches(f, e)));
    // "allow" lists findings that are true but not the point of the case
    const extra = findings.filter(f => !c.expect.some(e => matches(f, e)) && !(c.allow || []).some(e => matches(f, e)));
    hits += c.expect.length - missed.length;
    misses += missed.length;
    falseAlarms += extra.length;
    const clean = c.expect.length === 0;
    if (clean) {
      cleanApps++;
      if (!extra.length) cleanPassed++;
    }
    const ok = !missed.length && !extra.length;
    lines.push(`${ok ? 'ok  ' : 'FAIL'}  ${name}${clean ? ' (clean)' : ''}`);
    for (const e of missed) lines.push(`        missed: ${e.kind} "${e.includes}"`);
    for (const f of extra) lines.push(`        false alarm: ${f.kind}: ${f.message.split('\n')[0]}`);
    if (show || !ok) for (const f of findings) lines.push(`        | ${f.kind}: ${f.message.split('\n')[0]}`);
  }
  const planted = hits + misses;
  console.log(lines.join('\n'));
  console.log(`\nplanted problems found: ${hits}/${planted}${planted ? ` (${Math.round((100 * hits) / planted)}%)` : ''}`);
  console.log(`clean apps with no findings: ${cleanPassed}/${cleanApps}`);
  console.log(`false alarms: ${falseAlarms}`);
  process.exit(misses || falseAlarms ? 1 : 0);
})();

#!/usr/bin/env node
/**
 * Render the README demo: `traceperf run` on the N+1 example app, then on
 * its fixed version, as an SVG terminal. Both outputs come from running the
 * real CLI, so the image shows what traceperf actually prints.
 *
 *   npm run build && node scripts/render-demo.js
 *
 * Writes docs/assets/demo.svg.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const WIDTH = 96;

function run(app) {
  const out = execFileSync(process.execPath, [CLI, 'run', `examples/slow-apps/${app}/server.js`, '--path', '/orders', '-d', '2s'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, QUIET: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = out.split('\n');
  const load = lines.find(l => l.startsWith('load:'));
  const why = lines.indexOf('Why it was slow:');
  return [load, '', ...lines.slice(why).filter(l => l.trim())];
}

/** Wrap at WIDTH columns, continuation lines indented like the line they continue */
function wrap(line) {
  const indent = /^\s*(?:\S+ )?/.exec(line)[0].replace(/\S/g, ' ').slice(0, 3).padEnd(3);
  const out = [];
  let rest = line;
  while ([...rest].length > WIDTH) {
    const cut = rest.lastIndexOf(' ', WIDTH);
    const at = cut > 20 ? cut : WIDTH;
    out.push(rest.slice(0, at));
    rest = indent + rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}

const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const color = line => escape(line)
  .replace(/^(\$ .*)$/, '<tspan fill="#7ee787">$1</tspan>')
  .replace(/^(# .*)$/, '<tspan fill="#8b949e">$1</tspan>')
  .replace(/(N\+1 pattern)/, '<tspan fill="#f9a03f">$1</tspan>')
  .replace(/^(\s+fix:)/, '<tspan fill="#79c0ff">$1</tspan>')
  .replace(/(No issues found)/, '<tspan fill="#7ee787">$1</tspan>')
  .replace(/^(load: .*)$/, '<tspan fill="#8b949e">$1</tspan>');

const before = run('n-plus-one');
const after = run('clean-batched');
const lines = [
  '$ npx traceperf run server.js --path /orders',
  ...before,
  '',
  '# after replacing the per-order query with one WHERE order_id IN (...)',
  '$ npx traceperf run server.js --path /orders',
  ...after,
].flatMap(wrap);

const charW = 8.4;
const lineH = 20;
const pad = 20;
const top = 44;
const width = Math.ceil(WIDTH * charW + pad * 2);
const height = top + lines.length * lineH + pad;
const text = lines.map((l, i) => `  <text x="${pad}" y="${top + i * lineH + 14}" fill="#e6edf3" xml:space="preserve">${color(l)}</text>`).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="traceperf run finds an N+1 query, then reports no issues after the fix">
  <rect width="100%" height="100%" rx="8" fill="#0d1117"/>
  <circle cx="20" cy="18" r="6" fill="#ff5f56"/><circle cx="40" cy="18" r="6" fill="#ffbd2e"/><circle cx="60" cy="18" r="6" fill="#27c93f"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">
${text}
  </g>
</svg>
`;
const out = path.join(ROOT, 'docs', 'assets', 'demo.svg');
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(process.cwd(), out)} (${lines.length} lines)`);

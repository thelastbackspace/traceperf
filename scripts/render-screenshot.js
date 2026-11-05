#!/usr/bin/env node
/**
 * Render real traceperf output as an SVG "terminal screenshot" for the README.
 *
 *   npm run build && node scripts/render-screenshot.js
 *
 * Writes docs/assets/terminal.svg. The content is produced by running the
 * code below, so the image always shows what the library actually prints.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createTracePerf, TrackingMode } = require(path.resolve(__dirname, '..', 'dist'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const busy = ms => { const s = Date.now(); while (Date.now() - s < ms) { /* spin */ } };

async function capture() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(...args.join(' ').split('\n'));
  try {
    const tp = createTracePerf({ trackingMode: TrackingMode.DETAILED, trackMemory: false });
    const findUser = tp.createTrackable(async () => { await sleep(18); }, { label: 'db.findUser' });
    const findOrders = tp.createTrackable(async () => { await sleep(24); }, { label: 'db.findOrders' });
    const render = tp.createTrackable(() => busy(62), { label: 'renderTemplate' });
    await tp.track(async () => {
      await Promise.all([findUser(), findOrders()]);
      render();
    }, { label: 'GET /users/:id' });
    lines.push('');
    tp.printStats();
  } finally {
    console.log = original;
  }
  return lines;
}

const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function color(line) {
  // Highlight the bits people look for
  return escape(line)
    .replace(/(⚠ blocked event loop [\d.]+ ms)/, '<tspan fill="#f9a03f">$1</tspan>')
    .replace(/(\(self [^)]*\))/, '<tspan fill="#8b949e">$1</tspan>')
    .replace(/(\(sync [^)]*\))/, '<tspan fill="#8b949e">$1</tspan>')
    .replace(/^([└├│ ─]+)/, '<tspan fill="#6e7681">$1</tspan>');
}

(async () => {
  const lines = ['$ node app.js', ...(await capture())];
  const charW = 8.4;
  const lineH = 20;
  const pad = 20;
  const top = 44;
  const width = Math.ceil(Math.max(...lines.map(l => [...l].length)) * charW + pad * 2);
  const height = top + lines.length * lineH + pad;
  const text = lines.map((l, i) => {
    const y = top + i * lineH + 14;
    const fill = i === 0 ? '#7ee787' : '#e6edf3';
    return `  <text x="${pad}" y="${y}" fill="${fill}" xml:space="preserve">${i === 0 ? escape(l) : color(l)}</text>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="traceperf terminal output">
  <rect width="100%" height="100%" rx="8" fill="#0d1117"/>
  <circle cx="20" cy="18" r="6" fill="#ff5f56"/><circle cx="40" cy="18" r="6" fill="#ffbd2e"/><circle cx="60" cy="18" r="6" fill="#27c93f"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">
${text}
  </g>
</svg>
`;
  const out = path.resolve(__dirname, '..', 'docs', 'assets', 'terminal.svg');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, svg);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${lines.length} lines)`);
})();

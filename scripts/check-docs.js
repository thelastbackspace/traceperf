#!/usr/bin/env node
/**
 * Run every JavaScript example in the docs against the built package and,
 * where a doc shows the expected output, check the real output matches.
 *
 *   node scripts/check-docs.js [files...]    (default: README.md docs/index.html)
 *
 * Conventions in the docs:
 *  - ```javascript / ```js / ```html blocks that mention traceperf are run.
 *  - A plain ``` block directly after a runnable block (optionally with only
 *    a short "Output"-style sentence in between) is its expected output.
 *    Numbers are ignored when comparing; every expected line must start an
 *    actual output line, in order.
 *  - Put <!-- docs:skip --> on the line before a block that is illustrative only.
 *  - In HTML, <pre><code> blocks are run and a following
 *    <pre class="output"><code> block is the expected output.
 *
 * Requires a build (`npm run build:all`). Undefined helpers used in examples
 * (slowFunction, fetch, document, ...) are stubbed below.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['README.md', 'docs/index.html'];

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const STUBS = `
const __busy = ms => { const s = Date.now(); while (Date.now() - s < ms) {} };
var someValue = 1;
var slowFunction = function slowFunction() { __busy(60); };
var criticalFunction = function criticalFunction() { __busy(1); };
var backgroundTask = function backgroundTask() { __busy(1); };
var someAsyncOperation = async () => 1, processResult = x => x, processArray = a => a.length;
var fetch = async () => ({ json: async () => ({ ok: true }) });
var __els = {};
var document = { getElementById: id => __els[id] || (__els[id] = { textContent: '', addEventListener() {} }) };
`;

function extractBlocks(file, text) {
  const blocks = [];
  if (file.endsWith('.md')) {
    const fence = /(<!-- docs:skip -->\s*\n)?```([\w-]*)\n([\s\S]*?)```/g;
    let m;
    const raw = [];
    while ((m = fence.exec(text))) raw.push({ skip: !!m[1], lang: m[2], code: m[3], start: m.index, end: fence.lastIndex });
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i];
      if (!['javascript', 'js', 'html'].includes(b.lang)) continue;
      const next = raw[i + 1];
      let expected;
      if (next && next.lang === '') {
        const between = text.slice(b.end, next.start).trim();
        if (between.length < 200 && !between.includes('#')) expected = next.code;
      }
      blocks.push({ code: b.code, skip: b.skip, expected, line: text.slice(0, b.start).split('\n').length });
    }
  } else {
    const pre = /<pre( class="output")?><code>([\s\S]*?)<\/code><\/pre>/g;
    let m;
    const raw = [];
    while ((m = pre.exec(text))) raw.push({ output: !!m[1], code: decode(m[2]), start: m.index });
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].output) continue;
      const next = raw[i + 1];
      blocks.push({
        code: raw[i].code,
        skip: /^\s*npm /.test(raw[i].code),
        expected: next && next.output ? next.code : undefined,
        line: text.slice(0, raw[i].start).split('\n').length,
      });
    }
  }
  return blocks.filter(b => /traceperf|TracePerf/.test(b.code));
}

function program(code) {
  if (/<script/.test(code)) {
    const inline = code.replace(/<script src=[^>]*><\/script>/g, '').replace(/<\/?script>/g, '');
    return { ext: 'cjs', source: `${STUBS}
const vm = require('vm');
const ctx = { console, performance, setTimeout, Promise, document, fetch, Date, JSON, process };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(require('fs').readFileSync(${JSON.stringify(path.join(root, 'dist/traceperf.browser.js'))}, 'utf8'), ctx);
vm.runInContext('(async () => {' + ${JSON.stringify(inline)} + '\\n})().catch(e => { console.error(e); process.exitCode = 1; })', ctx);
` };
  }
  if (/^\s*import /m.test(code)) {
    const imports = code.match(/^import .*$/gm).join('\n');
    const body = code.replace(/^import .*$/gm, '');
    return { ext: 'mjs', source: `${imports}\n${STUBS}\nawait (async () => {\n${body}\n})();\n` };
  }
  return {
    ext: 'cjs',
    source: `${STUBS}\nvar traceperf = require('traceperf');\n(async () => {\n${code.replace(/^const traceperf = require\('traceperf'\);?/m, '')}\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`,
  };
}

// Ignore numbers, column padding and the length of dash rules; keep leading
// indentation, which carries the tree structure.
const normalize = line => line
  .replace(/[+-]?\d+(\.\d+)?/g, '#')
  .replace(/-{2,}/g, '--')
  .replace(/(\S)\s+/g, '$1 ')
  .replace(/\s+$/, '');

function outputMatches(actual, expected) {
  const want = expected.split('\n').map(normalize).filter(Boolean);
  const got = actual.split('\n').map(normalize);
  let pos = 0;
  // Each expected line must start an actual line, in order (so a trailing
  // annotation such as "(gc)" on a heap delta does not break the match)
  for (const line of want) {
    let found = -1;
    for (let i = pos; i < got.length; i++) {
      if (got[i].startsWith(line)) {
        found = i;
        break;
      }
    }
    if (found === -1) return `expected line not found: ${JSON.stringify(line)}`;
    pos = found + 1;
  }
  return null;
}

// The package resolves itself by name from inside the repo (self-reference).
const work = fs.mkdtempSync(path.join(root, '.docs-check-'));
let failures = 0;
let ran = 0;
let skipped = 0;
try {
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    extractBlocks(file, text).forEach((block, i) => {
      const id = `${file}:${block.line}`;
      if (block.skip) {
        skipped++;
        return;
      }
      ran++;
      const { ext, source } = program(block.code);
      const script = path.join(work, `snippet-${i}.${ext}`);
      fs.writeFileSync(script, source);
      let out;
      try {
        // cwd is the scratch dir so examples that write files leave nothing behind
        out = execFileSync(process.execPath, [script], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
      } catch (error) {
        failures++;
        console.log(`FAIL ${id}: threw\n${String(error.stderr || error.message).split('\n').slice(0, 8).join('\n')}`);
        return;
      }
      if (block.expected) {
        const problem = outputMatches(out, block.expected);
        if (problem) {
          failures++;
          console.log(`FAIL ${id}: output differs from the docs (${problem})\n--- actual ---\n${out}`);
          return;
        }
      }
      console.log(`ok   ${id}${block.expected ? ' (output checked)' : ''}`);
    });
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`\n${ran} snippets run, ${skipped} skipped, ${failures} failed`);
process.exitCode = failures ? 1 : 0;

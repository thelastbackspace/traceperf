/**
 * Build dist/traceperf.browser.js: a <script>-tag build of the browser entry
 * that exposes a global `TracePerf`. dist/browser.js is CommonJS without any
 * runtime require() calls, so wrapping it with a local module/exports pair
 * is enough.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dist = path.resolve(__dirname, '..', 'dist');
const source = fs.readFileSync(path.join(dist, 'browser.js'), 'utf8')
  .replace(/^\/\/# sourceMappingURL=.*$/m, '');

if (/\brequire\(/.test(source)) {
  throw new Error('build-browser-global: dist/browser.js has runtime require() calls; it cannot be wrapped');
}

const { version } = require('../package.json');
const banner = `/*! traceperf v${version} | MIT License | browser global build */\n`;
const bundle = `${banner}(function (root) {
  var module = { exports: {} };
  var exports = module.exports;
${source}
  root.TracePerf = module.exports;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;

fs.writeFileSync(path.join(dist, 'traceperf.browser.js'), bundle);

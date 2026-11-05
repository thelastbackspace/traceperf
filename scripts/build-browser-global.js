/**
 * Build dist/traceperf.browser.js: a <script>-tag build of the browser entry
 * that exposes a global `TracePerf`. Bundles dist/browser.js (CommonJS) and
 * its imports with esbuild into a single IIFE (plus a minified copy).
 */
'use strict';
const path = require('path');
const { buildSync } = require('esbuild');
const { version } = require('../package.json');

const dist = path.resolve(__dirname, '..', 'dist');

for (const minify of [false, true]) buildSync({
  entryPoints: [path.join(dist, 'browser.js')],
  outfile: path.join(dist, minify ? 'traceperf.browser.min.js' : 'traceperf.browser.js'),
  minify,
  bundle: true,
  format: 'iife',
  globalName: 'TracePerf',
  platform: 'browser',
  target: 'es2018',
  legalComments: 'none',
  banner: { js: `/*! traceperf v${version} | MIT License | browser global build */` },
  logLevel: 'warning',
});

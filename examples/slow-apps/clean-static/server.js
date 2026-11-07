// Clean: serves a small in-memory document, no I/O. No issues expected.
const serve = require('../serve');

const doc = { name: 'traceperf', version: 1, features: ['run', 'baseline'] };
serve({
  '/about': async () => doc,
});

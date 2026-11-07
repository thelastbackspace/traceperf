// Clean: a loop over 3 cache reads of a few microseconds each, below
// anything worth reporting as repeated.
const serve = require('../serve');
const tp = require('traceperf');

const cache = new Map([['a', 1], ['b', 2], ['c', 3]]);
const get = tp.createTrackable(key => cache.get(key), { label: 'cache get' });

serve({
  '/flags': async () => ['a', 'b', 'c'].map(get),
});

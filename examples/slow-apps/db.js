// A stand-in for a database client: each query is a tracked async call that
// takes `ms` to answer. Real apps get this from traceperf/auto's pg, mysql2,
// MongoDB and Redis instrumentation; the trees look the same.
const tp = require('traceperf');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function query(sql, ms = 10, result = []) {
  return tp.track(async () => {
    await sleep(ms);
    return result;
  }, { label: sql });
}

module.exports = { query, sleep };

/**
 * TracePerf: statistics, Perfetto trace export and JSON lines
 *
 *   npm run build && node examples/stats-and-export.js
 *
 * Writes traceperf-example-trace.json; open it at https://ui.perfetto.dev
 */
const fs = require('fs');
const path = require('path');
const { createTracePerf, TrackingMode, jsonLinesExporter } = require('../dist');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Production-style setup: no console trees, but stats, a trace and JSON lines
const slowRequests = [];
const tp = createTracePerf({
  trackingMode: TrackingMode.PERFORMANCE,
  plugins: [jsonLinesExporter(line => slowRequests.push(line))],
  onComplete: root => {
    if (root.duration > 25) console.log(`slow request: ${root.label} (${root.duration.toFixed(1)} ms)`);
  }
});

const db = {
  findUser: tp.createTrackable(async id => { await sleep(5 + (id % 3) * 5); return { id }; }, { label: 'db.findUser' }),
  findOrders: tp.createTrackable(async () => { await sleep(8); return []; }, { label: 'db.findOrders' })
};

async function handleRequest(id) {
  const span = tp.start('GET /users/:id');
  try {
    return await span.run(async () => {
      const [user, orders] = await Promise.all([db.findUser(id), db.findOrders(id)]);
      return { user, orders };
    });
  } finally {
    span.end();
  }
}

async function main() {
  const recording = tp.startTrace();
  for (let batch = 0; batch < 5; batch++) {
    await Promise.all([1, 2, 3, 4].map(id => handleRequest(batch * 4 + id)));
  }
  const tracePath = path.join(process.cwd(), 'traceperf-example-trace.json');
  fs.writeFileSync(tracePath, JSON.stringify(recording.stop()));

  console.log('\nPer-label statistics:\n');
  tp.printStats();
  console.log(`\nWrote ${tracePath} (open it at https://ui.perfetto.dev)`);
  console.log(`JSON lines captured: ${slowRequests.length}; first one:\n${slowRequests[0]}`);
}

main();

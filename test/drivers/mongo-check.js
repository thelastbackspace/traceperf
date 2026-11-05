// Run by drivers.test.ts in a plain Node process: the MongoDB driver's
// client metadata cannot be built inside Jest's module environment.
const mongodb = require('mongodb');
const { createTracePerf, instrumentMongo } = require('../../dist');

(async () => {
  const roots = [];
  const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
  const uninstall = instrumentMongo(tp, mongodb);
  const client = new mongodb.MongoClient(process.env.TRACEPERF_MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const users = client.db(`traceperf_test_${process.pid}`).collection('users');
  try {
    await tp.track(async () => {
      await users.insertMany([{ name: 'ada' }, { name: 'grace' }]);
      await users.find({}).toArray();
      await users.findOne({ name: 'ada' });
      await users.aggregate([{ $count: 'n' }]).toArray();
      await users.deleteMany({});
    }, { label: 'job' });
  } finally {
    await users.drop().catch(() => undefined);
    uninstall();
    await client.close();
  }
  const job = roots.find(r => r.label === 'job');
  console.log(JSON.stringify(job.children.map(c => c.label)));
})().catch(error => {
  console.error(error);
  process.exit(1);
});

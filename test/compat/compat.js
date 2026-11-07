// Runs traceperf's driver instrumentation against old and new majors of each
// driver (installed side by side by ./package.json) and real servers, so a
// driver release that moves the methods we patch fails CI instead of silently
// producing empty traces.
//
//   cd test/compat && npm install && node compat.js
//
// Servers come from the same env vars as the unit tests; a driver whose server
// is not configured is reported as skipped (CI sets all of them, and with
// TRACEPERF_COMPAT_STRICT=1 a skip is a failure).
const assert = require('assert');
const {
  createTracePerf, instrumentPg, instrumentMysql2, instrumentMysql, instrumentMongo, instrumentRedis, instrumentNodeRedis,
  instrumentBetterSqlite3, instrumentPrisma,
} = require('../../dist');
const path = require('path');

const env = {
  pg: process.env.TRACEPERF_PG_URL,
  mysql: process.env.TRACEPERF_MYSQL_URL,
  mongo: process.env.TRACEPERF_MONGO_URL,
  redis: process.env.TRACEPERF_REDIS_URL,
  mariadb: process.env.TRACEPERF_MARIADB_URL,
};

/** Run body inside a root call and return the labels of its direct children */
async function trace(instrument, body) {
  const roots = [];
  const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
  const uninstall = instrument(tp);
  try {
    await tp.track(body, { label: 'job' });
  } finally {
    uninstall();
  }
  const job = roots.find(r => r.label === 'job');
  return { labels: job.children.map(c => c.label), job };
}

const cb = fn => new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))));
const db = () => `traceperf_compat_${process.pid}`;

const pgCheck = pkg => async () => {
  const pg = require(pkg);
  const client = new pg.Client({ connectionString: env.pg });
  const pool = new pg.Pool({ connectionString: env.pg, max: 2 });
  await client.connect();
  try {
    const { labels, job } = await trace(tp => instrumentPg(tp, pg), async () => {
      await client.query('CREATE TEMP TABLE users (id int, name text)');
      await client.query('INSERT INTO users VALUES ($1, $2)', [1, 'ada']);
      const res = await cb(done => client.query('SELECT * FROM users WHERE id = $1', [1], done));
      assert.strictEqual(res.rows[0].name, 'ada');
      await pool.query('SELECT 1 AS x FROM pg_class LIMIT 1');
      await client.query('SELECT * FROM missing_table').catch(() => undefined);
    });
    assert.deepStrictEqual(labels, ['pg CREATE users', 'pg INSERT users', 'pg SELECT users', 'pg SELECT pg_class', 'pg SELECT missing_table']);
    assert.ok(job.children[4].error, 'failed query is marked as an error');
  } finally {
    await client.end();
    await pool.end();
  }
};

const mysql2Check = pkg => async () => {
  const mysql = require(pkg);
  const conn = mysql.createConnection(env.mysql);
  const pool = mysql.createPool({ uri: env.mysql, connectionLimit: 2 });
  try {
    const { labels, job } = await trace(tp => instrumentMysql2(tp, mysql), async () => {
      await conn.promise().query('CREATE TEMPORARY TABLE users (id int, name text)');
      await conn.promise().execute('INSERT INTO users VALUES (?, ?)', [1, 'ada']);
      const rows = await cb(done => conn.query('SELECT * FROM users WHERE id = ?', [1], done));
      assert.strictEqual(rows[0].name, 'ada');
      await pool.promise().query('SELECT 1 AS x FROM DUAL');
      await conn.promise().query('SELECT * FROM missing_table').catch(() => undefined);
    });
    assert.deepStrictEqual(labels, ['mysql CREATE users', 'mysql INSERT users', 'mysql SELECT users', 'mysql SELECT DUAL', 'mysql SELECT missing_table']);
    assert.ok(job.children[4].error, 'failed query is marked as an error');
  } finally {
    conn.end();
    await pool.promise().end();
  }
};

const mysqlCheck = pkg => async () => {
  const mysql = require(pkg);
  const conn = mysql.createConnection(env.mariadb);
  const pool = mysql.createPool(`${env.mariadb}?connectionLimit=2`);
  try {
    const { labels, job } = await trace(tp => instrumentMysql(tp, mysql), async () => {
      await cb(done => conn.query('CREATE TEMPORARY TABLE users (id int, name text)', done));
      await cb(done => conn.query('INSERT INTO users VALUES (?, ?)', [1, 'ada'], done));
      const rows = await cb(done => conn.query('SELECT * FROM users WHERE id = ?', [1], done));
      assert.strictEqual(rows[0].name, 'ada');
      await cb(done => pool.query('SELECT 1 AS x FROM DUAL', done));
      await cb(done => conn.query('SELECT * FROM missing_table', done)).catch(() => undefined);
    });
    // The pool query is counted once, not again for the pooled connection
    assert.deepStrictEqual(labels, ['mysql CREATE users', 'mysql INSERT users', 'mysql SELECT users', 'mysql SELECT DUAL', 'mysql SELECT missing_table']);
    assert.ok(job.children[4].error, 'failed query is marked as an error');
  } finally {
    conn.end();
    await cb(done => pool.end(done));
  }
};

const MONGO_OPS = ['mongo insertMany users', 'mongo find users', 'mongo findOne users', 'mongo aggregate users', 'mongo deleteMany users'];

const mongoCheck = (pkg, { callbacks } = {}) => async () => {
  const mongodb = require(pkg);
  const client = new mongodb.MongoClient(env.mongo, { serverSelectionTimeoutMS: 5000, ...(callbacks ? { useUnifiedTopology: true } : {}) });
  await client.connect();
  const users = client.db(db()).collection('users');
  try {
    const { labels } = await trace(tp => instrumentMongo(tp, mongodb), async () => {
      await users.insertMany([{ name: 'ada' }, { name: 'grace' }]);
      assert.strictEqual((await users.find({}).toArray()).length, 2);
      await users.findOne({ name: 'ada' });
      await users.aggregate([{ $count: 'n' }]).toArray();
      await users.deleteMany({});
    });
    assert.deepStrictEqual(labels, MONGO_OPS);
    if (callbacks) {
      // 3.x callback style: the call must last until the callback, not return at once
      const { labels: cbLabels, job } = await trace(tp => instrumentMongo(tp, mongodb), async () => {
        await cb(done => users.insertOne({ name: 'ada' }, done));
        await cb(done => users.find({}).toArray(done));
      });
      assert.deepStrictEqual(cbLabels, ['mongo insertOne users', 'mongo find users']);
      assert.ok(job.children.every(c => c.duration > 0));
    }
  } finally {
    await users.drop().catch(() => undefined);
    await client.close();
  }
};

const mongooseCheck = pkg => async () => {
  const mongoose = require(pkg);
  const legacy = Number(mongoose.version.split('.')[0]) < 6;
  const conn = mongoose.createConnection(`${env.mongo}/${db()}`, {
    serverSelectionTimeoutMS: 5000, ...(legacy ? { useNewUrlParser: true, useUnifiedTopology: true } : {}),
  });
  if (conn.asPromise) await conn.asPromise();
  else await new Promise((resolve, reject) => { conn.once('open', resolve); conn.once('error', reject); });
  const User = conn.model('User', new mongoose.Schema({ name: String }));
  try {
    const { labels } = await trace(tp => instrumentMongo(tp, mongoose.mongo), async () => {
      await User.insertMany([{ name: 'ada' }, { name: 'grace' }]);
      assert.strictEqual((await User.find({})).length, 2);
      await User.findOne({ name: 'ada' }).lean();
      await User.aggregate([{ $count: 'n' }]);
      await User.deleteMany({});
    });
    assert.deepStrictEqual(labels, MONGO_OPS);
  } finally {
    await conn.dropDatabase().catch(() => undefined);
    await conn.close();
  }
};

const redisCheck = pkg => async () => {
  const Redis = require(pkg);
  const redis = new Redis(env.redis, { lazyConnect: true, maxRetriesPerRequest: 0 });
  await redis.connect();
  const key = `traceperf:compat:${process.pid}`;
  try {
    const { labels, job } = await trace(tp => instrumentRedis(tp, Redis), async () => {
      await redis.set(key, 'v');
      assert.strictEqual(await redis.get(key), 'v');
      await redis.pipeline().incr(`${key}:n`).incr(`${key}:n`).exec();
      await redis.call('NOPE').catch(() => undefined);
      await redis.del(key, `${key}:n`);
    });
    assert.deepStrictEqual(labels.filter(l => l !== 'redis INCR'), ['redis SET', 'redis GET', 'redis NOPE', 'redis DEL']);
    assert.ok(job.children.find(c => c.label === 'redis NOPE').error, 'failed command is marked as an error');
  } finally {
    redis.disconnect();
  }
};

const nodeRedisCheck = pkg => async () => {
  const redis = require(pkg);
  const client = redis.createClient({ url: env.redis, socket: { reconnectStrategy: false } });
  client.on('error', () => undefined);
  await client.connect();
  const key = `traceperf:compat:${process.pid}`;
  try {
    const { labels, job } = await trace(tp => instrumentNodeRedis(tp, redis), async () => {
      await client.set(key, 'v');
      assert.strictEqual(await client.get(key), 'v');
      assert.deepStrictEqual(await client.multi().incr(`${key}:n`).incr(`${key}:n`).exec(), [1, 2]);
      await client.multi().get(key).execAsPipeline();
      await client.sendCommand(['NOPE']).catch(() => undefined);
      await client.del([key, `${key}:n`]);
    });
    // MULTI and pipeline commands are tracked one by one
    assert.deepStrictEqual(labels, ['redis SET', 'redis GET', 'redis INCR', 'redis INCR', 'redis GET', 'redis NOPE', 'redis DEL']);
    assert.ok(job.children[5].error, 'failed command is marked as an error');
  } finally {
    await client.disconnect();
  }
};

// Each Prisma major lives in its own prisma<N>/ directory (see prisma-setup.js)
const prismaCheck = dir => async () => {
  const mod = require(path.join(__dirname, dir, 'node_modules', '@prisma/client'));
  const prisma = new mod.PrismaClient({ datasources: { db: { url: `file:${path.join(__dirname, dir, 'compat.db')}` } } });
  await prisma.$connect();
  try {
    await prisma.user.deleteMany();
    const { labels, job } = await trace(tp => instrumentPrisma(tp, mod), async () => {
      await prisma.user.create({ data: { name: 'ada' } });
      assert.strictEqual((await prisma.user.findMany()).length, 1);
      await prisma.user.findFirst({ where: { name: 'ada' } });
      await prisma.user.update({ where: { id: -1 }, data: { name: 'x' } }).catch(() => undefined);
      await prisma.$queryRaw`SELECT 1`;
      await prisma.user.deleteMany();
    });
    assert.deepStrictEqual(labels, [
      'prisma.User.create', 'prisma.User.findMany', 'prisma.User.findFirst', 'prisma.User.update',
      'prisma.raw.queryRaw', 'prisma.User.deleteMany',
    ]);
    assert.ok(job.children[3].error, 'failed call is marked as an error');
  } finally {
    await prisma.$disconnect();
  }
};

// Sequelize and Knex run on the instrumented drivers: their queries carry the driver's labels
const SQL_SERVERS = {
  pg: { url: () => env.pg, driver: 'pg8', instrument: instrumentPg, prefix: 'pg', knexDialect: 'postgres' },
  mysql: { url: () => env.mysql, driver: 'mysql2-3', instrument: instrumentMysql2, prefix: 'mysql', knexDialect: 'mysql2' },
};

const sequelizeCheck = (pkg, server) => async () => {
  const { Sequelize, DataTypes } = require(pkg);
  const s = SQL_SERVERS[server];
  const driver = require(s.driver);
  const sequelize = new Sequelize(s.url(), { dialectModule: driver, logging: false, pool: { max: 1 } });
  const table = `Users${process.pid}`;
  const User = sequelize.define('User', { name: DataTypes.STRING }, { tableName: table });
  try {
    const { labels } = await trace(tp => s.instrument(tp, driver), async () => {
      await User.sync({ force: true });
    });
    assert.ok(labels.includes(`${s.prefix} CREATE ${table}`), `CREATE TABLE IF NOT EXISTS is labelled by table: ${labels}`);
    const { labels: crud } = await trace(tp => s.instrument(tp, driver), async () => {
      const ada = await User.create({ name: 'ada' });
      assert.strictEqual((await User.findAll({ where: { name: 'ada' } })).length, 1);
      await User.update({ name: 'grace' }, { where: { id: ada.id } });
      await User.destroy({ where: { id: ada.id } });
    });
    assert.deepStrictEqual(crud, ['INSERT', 'SELECT', 'UPDATE', 'DELETE'].map(v => `${s.prefix} ${v} ${table}`));
  } finally {
    await User.drop().catch(() => undefined);
    await sequelize.close();
  }
};

const knexCheck = (pkg, server) => async () => {
  const s = SQL_SERVERS[server];
  const driver = require(s.driver);
  // Knex requires 'pg' / 'mysql2' by name; hand it the aliased driver instead
  const Dialect = require(`${pkg}/lib/dialects/${s.knexDialect}`);
  class Client extends Dialect { _driver() { return driver; } }
  const knex = require(pkg)({ client: Client, connection: s.url(), pool: { min: 0, max: 1 } });
  const table = `users${process.pid}`;
  try {
    await knex.raw('SELECT 1');   // connect first: pg runs "select version()" on a new connection
    const { labels } = await trace(tp => s.instrument(tp, driver), async () => {
      await knex.schema.createTable(table, t => { t.increments('id'); t.string('name'); });
      await knex(table).insert({ name: 'ada' });
      assert.strictEqual((await knex(table).where({ name: 'ada' })).length, 1);
      await knex(table).where({ name: 'ada' }).update({ name: 'grace' });
      await knex(table).del();
      await knex.schema.dropTable(table);
    });
    assert.deepStrictEqual(labels, ['CREATE', 'INSERT', 'SELECT', 'UPDATE', 'DELETE', 'DROP'].map(v => `${s.prefix} ${v} ${table}`));
  } finally {
    await knex.schema.dropTableIfExists(table).catch(() => undefined);
    await knex.destroy();
  }
};

const sqliteCheck = pkg => async () => {
  const Database = require(pkg);
  const sqlite = new Database(':memory:');
  try {
    const { labels } = await trace(tp => instrumentBetterSqlite3(tp, Database), () => {
      sqlite.exec('CREATE TABLE users (id INTEGER, name TEXT)');
      sqlite.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'ada');
      assert.strictEqual(sqlite.prepare('SELECT * FROM users WHERE id = ?').get(1).name, 'ada');
      assert.strictEqual(sqlite.prepare('SELECT * FROM users').all().length, 1);
      assert.strictEqual([...sqlite.prepare('SELECT name FROM users').iterate()].length, 1);
    });
    assert.deepStrictEqual(labels, ['sqlite CREATE users', 'sqlite INSERT users', 'sqlite SELECT users', 'sqlite SELECT users', 'sqlite SELECT users']);
  } finally {
    sqlite.close();
  }
};

const checks = [
  ['pg@8.0', 'pg', pgCheck('pg8-0')],  // pg@7 cannot connect on Node 14+ at all
  ['pg@8', 'pg', pgCheck('pg8')],
  ['mysql2@2', 'mysql', mysql2Check('mysql2-2')],
  ['mysql2@3', 'mysql', mysql2Check('mysql2-3')],
  ['mysql@2', 'mariadb', mysqlCheck('mysql-2')],
  ['mongodb@3', 'mongo', mongoCheck('mongodb3', { callbacks: true })],
  ['mongodb@4', 'mongo', mongoCheck('mongodb4')],
  ['mongodb@5', 'mongo', mongoCheck('mongodb5')],
  ['mongodb@6', 'mongo', mongoCheck('mongodb6')],
  ['mongodb@7', 'mongo', mongoCheck('mongodb7')],
  ['mongoose@5', 'mongo', mongooseCheck('mongoose5')],
  ['mongoose@6', 'mongo', mongooseCheck('mongoose6')],
  ['mongoose@7', 'mongo', mongooseCheck('mongoose7')],
  ['mongoose@8', 'mongo', mongooseCheck('mongoose8')],
  ['ioredis@4', 'redis', redisCheck('ioredis4')],
  ['ioredis@5', 'redis', redisCheck('ioredis5')],
  ['redis@4', 'redis', nodeRedisCheck('redis4')],
  ['redis@5', 'redis', nodeRedisCheck('redis5')],
  ['prisma@5', null, prismaCheck('prisma5')],
  ['prisma@6', null, prismaCheck('prisma6')],
  // prisma@7: needs a driver adapter and the TypeScript-only generator for SQLite, see prisma-setup.js
  ['sequelize@6 pg', 'pg', sequelizeCheck('sequelize6', 'pg')],
  ['sequelize@6 mysql2', 'mysql', sequelizeCheck('sequelize6', 'mysql')],
  ['knex@2 pg', 'pg', knexCheck('knex2', 'pg')],
  ['knex@2 mysql2', 'mysql', knexCheck('knex2', 'mysql')],
  ['knex@3 pg', 'pg', knexCheck('knex3', 'pg')],
  ['knex@3 mysql2', 'mysql', knexCheck('knex3', 'mysql')],
  ['better-sqlite3@11', null, sqliteCheck('better-sqlite3-11')],
  ['better-sqlite3@12', null, sqliteCheck('better-sqlite3-12')],
];

// A driver that never settles leaves no handles and Node exits quietly: make it loud
let finished = false;
process.on('exit', code => { if (!finished && code === 0) { console.log('FAIL  a check never finished'); process.exitCode = 1; } });

(async () => {
  const only = process.argv[2];
  const strict = process.env.TRACEPERF_COMPAT_STRICT === '1';
  let failed = 0;
  for (const [name, server, run] of checks) {
    if (only && !name.startsWith(only)) continue;
    const version = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'node_modules', aliasOf(name), 'package.json'), 'utf8')).version;
    if (server && !env[server]) {
      console.log(`${strict ? 'FAIL' : 'skip'}  ${name} (${version}): no ${server} server configured`);
      if (strict) failed++;
      continue;
    }
    try {
      await run();
      console.log(`ok    ${name} (${version})`);
    } catch (error) {
      failed++;
      console.log(`FAIL  ${name} (${version})\n${String(error && error.stack || error).replace(/^/gm, '      ')}`);
    }
  }
  finished = true;
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();

function aliasOf(name) {
  const [pkg, major] = name.split(' ')[0].split('@');
  if (name === 'pg@8.0') return 'pg8-0';
  if (pkg === 'prisma') return path.join(`..`, `prisma${major}`, 'node_modules', '@prisma', 'client');
  return ['pg', 'mongodb', 'mongoose', 'ioredis', 'redis', 'sequelize', 'knex'].includes(pkg) ? `${pkg}${major}` : `${pkg}-${major}`;
}

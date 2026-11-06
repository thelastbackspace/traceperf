/**
 * Database / cloud client instrumentation against the real client libraries.
 *
 * Postgres, MySQL and MongoDB tests need servers: set TRACEPERF_PG_URL,
 * TRACEPERF_MYSQL_URL and TRACEPERF_MONGO_URL (CI provides service
 * containers); otherwise they are skipped. Redis and S3 use local protocol
 * servers; mysql2's connection-failure path runs without a server.
 */
import * as net from 'net';
import * as http from 'http';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { AddressInfo } from 'net';
import {
  createTracePerf,
  ExecutionRecord,
  instrumentAwsClient,
  instrumentBetterSqlite3,
  instrumentPrisma,
  prismaExtension,
  instrumentMysql,
  instrumentMysql2,
  instrumentPg,
  instrumentRedis,
  sqlLabel,
} from '../index';

function setup() {
  const roots: ExecutionRecord[] = [];
  const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
  return { tp, roots };
}
const labels = (r: ExecutionRecord) => r.children.map(c => c.label);
const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5));
};

describe('sqlLabel', () => {
  test.each([
    ['SELECT * FROM users WHERE id = $1', 'SELECT users'],
    ['  insert into "orders" (a) values (1)', 'INSERT orders'],
    ['UPDATE public.accounts SET x = 1', 'UPDATE public.accounts'],
    ['/* hint */ select 1', 'SELECT'],
    [{ text: 'DELETE FROM t' }, 'DELETE t'],
    [{ sql: 'select a from b join c' }, 'SELECT b'],
    ['SELECT "public"."Post"."id" FROM "public"."Post" WHERE 1', 'SELECT public.Post'],
    ['select * from `shop`.`orders`', 'SELECT shop.orders'],
    ['BEGIN', 'BEGIN'],
    [undefined, 'QUERY'],
  ])('%p -> %p', (sql, label) => {
    expect(sqlLabel(sql)).toBe(label);
  });
});

const PG = process.env.TRACEPERF_PG_URL;
(PG ? describe : describe.skip)('instrumentPg (real Postgres)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = require('pg');
  test('promise, callback and Pool queries; failures; nesting', async () => {
    const { tp, roots } = setup();
    const uninstall = instrumentPg(tp, pg);
    const pool = new pg.Pool({ connectionString: PG, max: 2 });
    const client = new pg.Client({ connectionString: PG });
    try {
      await client.connect();
      await tp.track(async () => {
        await client.query('CREATE TEMP TABLE users (id int, name text)');
        await client.query('INSERT INTO users VALUES ($1, $2)', [1, 'ada']);
        const rows = await new Promise<any>((resolve, reject) =>
          client.query('SELECT * FROM users WHERE id = $1', [1], (err: Error, res: any) => (err ? reject(err) : resolve(res))));
        expect(rows.rows[0].name).toBe('ada');
        await pool.query('SELECT 1 AS x FROM pg_class LIMIT 1');
        await expect(client.query('SELECT * FROM missing_table')).rejects.toThrow();
      }, { label: 'job' });
    } finally {
      uninstall();
      await client.end();
      await pool.end();
    }
    const job = roots.find(r => r.label === 'job')!;
    expect(labels(job)).toEqual(['pg CREATE users', 'pg INSERT users', 'pg SELECT users', 'pg SELECT pg_class', 'pg SELECT missing_table']);
    expect(job.children[4].error).toBeDefined();
    expect(job.children[2].duration).toBeGreaterThan(0);
  });
});

const MONGO = process.env.TRACEPERF_MONGO_URL;
// The mongodb@7 driver used here requires Node >= 20.19 (its own engines field)
const nodeMajor = Number(process.versions.node.split('.')[0]);
(MONGO && nodeMajor >= 20 ? describe : describe.skip)('instrumentMongo (real MongoDB)', () => {
  test('collection operations and cursor reads', () => {
    // Plain Node process: the driver cannot build its client metadata inside Jest
    const out = execFileSync(process.execPath, [path.resolve(__dirname, '..', '..', 'test/drivers/mongo-check.js')], {
      env: { ...process.env, TRACEPERF_MONGO_URL: MONGO },
      encoding: 'utf8',
    });
    expect(JSON.parse(out.trim())).toEqual([
      'mongo insertMany users', 'mongo find users', 'mongo findOne users', 'mongo aggregate users', 'mongo deleteMany users',
    ]);
  }, 120000);
});

describe('instrumentRedis (real ioredis client, local RESP server)', () => {
  let server: net.Server;
  let port: number;
  const store = new Map<string, string>();
  beforeAll(done => {
    server = net.createServer(socket => {
      let buffer = '';
      socket.on('data', chunk => {
        buffer += chunk.toString();
        // Parse complete RESP arrays: *N\r\n($len\r\nvalue\r\n)*
        for (;;) {
          const m = /^\*(\d+)\r\n/.exec(buffer);
          if (!m) return;
          let pos = m[0].length;
          const parts: string[] = [];
          for (let i = 0; i < Number(m[1]); i++) {
            const len = /^\$(\d+)\r\n/.exec(buffer.slice(pos));
            if (!len) return;
            pos += len[0].length;
            if (buffer.length < pos + Number(len[1]) + 2) return;
            parts.push(buffer.slice(pos, pos + Number(len[1])));
            pos += Number(len[1]) + 2;
          }
          buffer = buffer.slice(pos);
          const [cmd, key, value] = parts;
          switch (cmd.toUpperCase()) {
            case 'SET': store.set(key, value); socket.write('+OK\r\n'); break;
            case 'GET': {
              const v = store.get(key);
              socket.write(v === undefined ? '$-1\r\n' : `$${Buffer.byteLength(v)}\r\n${v}\r\n`);
              break;
            }
            case 'INFO': socket.write('$13\r\nredis_version\r\n'); break;
            default: socket.write('-ERR unknown command\r\n');
          }
        }
      });
    }).listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      done();
    });
  });
  afterAll(done => { server.close(() => done()); });

  test('every command is tracked, errors included', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis');
    const { tp, roots } = setup();
    const uninstall = instrumentRedis(tp, Redis);
    const redis = new Redis({
      port, host: '127.0.0.1', enableReadyCheck: false, maxRetriesPerRequest: 0, lazyConnect: true,
      protocol: 2, disableClientInfo: true, // the test server speaks RESP2 only
    });
    try {
      await redis.connect();
      await tp.track(async () => {
        await redis.set('k', 'v');
        expect(await redis.get('k')).toBe('v');
        await expect(redis.call('NOPE')).rejects.toThrow();
      }, { label: 'job' });
    } finally {
      uninstall();
      redis.disconnect();
    }
    const job = roots.find(r => r.label === 'job')!;
    expect(labels(job)).toEqual(['redis SET', 'redis GET', 'redis NOPE']);
    expect(job.children[2].error).toBeDefined();
  });
});

describe('instrumentMysql2 (real mysql2 client)', () => {
  test('connection failures are tracked as failed queries (callback and promise APIs)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mysql = require('mysql2');
    const { tp, roots } = setup();
    const uninstall = instrumentMysql2(tp, mysql);
    try {
      const conn = mysql.createConnection({ host: '127.0.0.1', port: 1, user: 'x', connectTimeout: 2000 });
      conn.on('error', () => undefined);
      await tp.track(async () => {
        await new Promise<void>(resolve => conn.query('SELECT * FROM users', () => resolve()));
        await conn.promise().query('UPDATE orders SET a = 1').catch(() => undefined);
      }, { label: 'job' });
    } finally {
      uninstall();
    }
    const job = roots.find(r => r.label === 'job')!;
    expect(labels(job)).toEqual(['mysql SELECT users', 'mysql UPDATE orders']);
    job.children.forEach(c => expect(c.error).toBeDefined());
  });
});

describe('instrumentMysql (real mysql client)', () => {
  test('connection and pool failures are tracked as failed queries', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mysql = require('mysql');
    const { tp, roots } = setup();
    const uninstall = instrumentMysql(tp, mysql);
    expect(instrumentMysql(tp, mysql)).toBeInstanceOf(Function); // idempotent
    try {
      const conn = mysql.createConnection({ host: '127.0.0.1', port: 1, user: 'x', connectTimeout: 2000 });
      conn.on('error', () => undefined);
      const pool = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'x', connectTimeout: 2000 });
      await tp.track(async () => {
        await new Promise<void>(resolve => conn.query('SELECT * FROM users WHERE id = ?', [1], () => resolve()));
        await new Promise<void>(resolve => pool.query('INSERT INTO orders (a) VALUES (1)', () => resolve()));
      }, { label: 'job' });
      pool.end(() => undefined);
    } finally {
      uninstall();
    }
    const job = roots.find(r => r.label === 'job')!;
    expect(labels(job)[0]).toBe('mysql SELECT users');
    expect(labels(job)).toContain('mysql INSERT orders');
    job.children.forEach(c => expect(c.error).toBeDefined());
  });
});

const MYSQL = process.env.TRACEPERF_MYSQL_URL;
(MYSQL ? describe : describe.skip)('instrumentMysql2 (real MySQL)', () => {
  test('query/execute through connections, pools and the promise API; failures; nesting', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mysql = require('mysql2');
    const { tp, roots } = setup();
    const uninstall = instrumentMysql2(tp, mysql);
    const conn = mysql.createConnection(MYSQL);
    const pool = mysql.createPool({ uri: MYSQL, connectionLimit: 2 });
    try {
      await tp.track(async () => {
        await conn.promise().query('CREATE TEMPORARY TABLE users (id int, name text)');
        await conn.promise().execute('INSERT INTO users VALUES (?, ?)', [1, 'ada']);
        const rows = await new Promise<any[]>((resolve, reject) =>
          conn.query('SELECT * FROM users WHERE id = ?', [1], (err: Error, r: any[]) => (err ? reject(err) : resolve(r))));
        expect(rows[0].name).toBe('ada');
        const [poolRows] = await pool.promise().query('SELECT 1 AS x FROM DUAL');
        expect((poolRows as any)[0].x).toBe(1);
        await expect(conn.promise().query('SELECT * FROM missing_table')).rejects.toThrow();
      }, { label: 'job' });
    } finally {
      uninstall();
      conn.end();
      await pool.promise().end();
    }
    const job = roots.find(r => r.label === 'job')!;
    expect(labels(job)).toEqual(['mysql CREATE users', 'mysql INSERT users', 'mysql SELECT users', 'mysql SELECT DUAL', 'mysql SELECT missing_table']);
    expect(job.children[4].error).toBeDefined();
    expect(job.children[2].duration).toBeGreaterThan(0);
  });
});

describe('instrumentAwsClient (real AWS SDK v3 client, local endpoint)', () => {
  test('commands are tracked as "aws S3.ListBuckets"', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end('<?xml version="1.0"?><ListAllMyBucketsResult><Buckets><Bucket><Name>b1</Name></Bucket></Buckets></ListAllMyBucketsResult>');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const { tp, roots } = setup();
    const client = new S3Client({
      region: 'us-east-1',
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      forcePathStyle: true,
      credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
    });
    const uninstall = instrumentAwsClient(tp, client);
    try {
      const out = await tp.track(() => client.send(new ListBucketsCommand({})), { label: 'job' });
      expect(out.Buckets[0].Name).toBe('b1');
      expect(instrumentAwsClient(tp, client)).toBeInstanceOf(Function); // idempotent
    } finally {
      uninstall();
      client.destroy();
      server.close();
    }
    await waitFor(() => roots.length > 0);
    expect(labels(roots[0])).toEqual(['aws S3.ListBuckets']);
  });
});

describe('instrumentPrisma (client that uses the tracing hook the way Prisma 5-7 does)', () => {
  // Checked by hand against @prisma/client 6.19 and 7.0 (generated client, pg adapter)
  const g = globalThis as any;
  const helper = () => g.V7_PRISMA_INSTRUMENTATION?.helper ?? g.PRISMA_INSTRUMENTATION?.helper ??
    { runInChildSpan: (_o: unknown, fn: () => unknown) => fn() };
  const fakePrisma = {
    _op(model: string | undefined, method: string, fail = false) {
      return helper().runInChildSpan({ name: 'operation', attributes: { method, model } }, () =>
        helper().runInChildSpan({ name: 'serialize' }, () =>
          new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error('P2002')) : resolve([])), 2))));
    },
    user: { findMany: (fail?: boolean) => fakePrisma._op('User', 'findMany', fail) },
    $queryRaw: () => fakePrisma._op(undefined, 'queryRaw'),
  };

  test('model calls, raw queries and failures; uninstall restores the hook', async () => {
    const { tp, roots } = setup();
    const uninstall = instrumentPrisma(tp);
    expect(instrumentPrisma(tp)).toBeInstanceOf(Function); // idempotent
    await tp.track(async () => {
      await fakePrisma.user.findMany();
      await fakePrisma.$queryRaw();
      await fakePrisma.user.findMany(true).catch(() => undefined);
    }, { label: 'GET /users' });
    expect(labels(roots[0])).toEqual(['prisma.User.findMany', 'prisma.raw.queryRaw', 'prisma.User.findMany']);
    expect(roots[0].children[2].error).toBeInstanceOf(Error);
    uninstall();
    expect('PRISMA_INSTRUMENTATION' in g).toBe(false);
    roots.length = 0;
    await tp.track(() => fakePrisma.user.findMany(), { label: 'after' });
    expect(labels(roots[0])).toEqual([]);
  });

  test('OpenTelemetry instrumentation that is already there keeps getting its spans', async () => {
    const seen: string[] = [];
    const otel = { helper: {
      isEnabled: () => true, getTraceParent: () => 'tp', dispatchEngineSpans: () => undefined, getActiveContext: () => undefined,
      runInChildSpan: (o: any, fn: () => unknown) => { seen.push(o.name); return fn(); },
    } };
    g.V7_PRISMA_INSTRUMENTATION = otel;
    const { tp, roots } = setup();
    const uninstall = instrumentPrisma(tp);
    expect(helper().isEnabled()).toBe(true);
    await tp.track(() => fakePrisma.user.findMany(), { label: 'r' });
    expect(labels(roots[0])).toEqual(['prisma.User.findMany']);
    expect(seen).toEqual(['operation', 'serialize']);
    uninstall();
    expect(g.V7_PRISMA_INSTRUMENTATION).toBe(otel);
    delete g.V7_PRISMA_INSTRUMENTATION;
  });

  test('prismaExtension stands aside while the hook is installed (no double counting)', async () => {
    const { tp, roots } = setup();
    const ext = prismaExtension(tp).query.$allModels.$allOperations;
    const call = () => ext({ model: 'User', operation: 'findMany', args: {}, query: async () => [] });
    const uninstall = instrumentPrisma(tp);
    await tp.track(() => call(), { label: 'hooked' });
    uninstall();
    await tp.track(() => call(), { label: 'extension only' });
    expect(roots.map(r => [r.label, labels(r)])).toEqual([['hooked', []], ['extension only', ['prisma.User.findMany']]]);
  });
});

describe('instrumentBetterSqlite3 (database shaped like better-sqlite3: Statement class not exported)', () => {
  // Checked by hand against better-sqlite3 12 with Drizzle
  class Statement {
    constructor(public source: string) {}
    run(..._a: unknown[]) { return { changes: 1 }; }
    get(..._a: unknown[]) { return { id: 1 }; }
    all() {
      if (this.source.includes('missing')) throw new Error('no such table: missing');
      return [{ id: 1 }];
    }
    iterate() { return [][Symbol.iterator](); }
    raw() { return this; }
  }
  class Database {
    prepare(sql: string) { return new Statement(sql); }
    exec(sql: string) { return sql ? this : this; }
  }

  test('statements and exec are tracked as synchronous calls', () => {
    const { tp, roots } = setup();
    const uninstall = instrumentBetterSqlite3(tp, Database);
    const db = new Database();
    tp.track(() => {
      db.prepare('SELECT * FROM users').all();
      db.prepare('INSERT INTO posts (t) VALUES (?)').run('a');
      db.prepare('select id from users where id = ?').raw().get(1);
      db.exec('CREATE TABLE t (a)');
      try { db.prepare('SELECT * FROM missing').all(); } catch { /* expected */ }
    }, { label: 'job' });
    expect(labels(roots[0])).toEqual(['sqlite SELECT users', 'sqlite INSERT posts', 'sqlite SELECT users', 'sqlite CREATE t', 'sqlite SELECT missing']);
    expect(roots[0].children[4].error).toBeInstanceOf(Error);
    uninstall();
    roots.length = 0;
    tp.track(() => { db.prepare('SELECT * FROM users').all(); }, { label: 'after' });
    expect(labels(roots[0])).toEqual([]);
  });
});

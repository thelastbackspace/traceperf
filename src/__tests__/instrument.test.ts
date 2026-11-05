/**
 * Auto-instrumentation against real local servers.
 */
import * as http from 'http';
import { AddressInfo } from 'net';
import {
  createTracePerf,
  ExecutionRecord,
  instrumentFetch,
  instrumentHttp,
  instrumentMethods,
  prismaExtension,
} from '../index';

let server: http.Server;
let base: string;

beforeAll(done => {
  server = http.createServer((req, res) => {
    const status = (req.url || '').split('?')[0] === '/fail' ? 503 : 200;
    setTimeout(() => {
      res.writeHead(status, { connection: 'close' });
      res.end('ok');
    }, 5);
  });
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    done();
  });
});
afterAll(done => { server.close(() => done()); });

function setup() {
  const roots: ExecutionRecord[] = [];
  const tp = createTracePerf({ silent: true, onComplete: r => roots.push(r) });
  return { tp, roots };
}

const get = (url: string) => new Promise<number>((resolve, reject) => {
  http.get(url, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); }).on('error', reject);
});

describe('instrumentFetch', () => {
  test('tracks fetch calls, nested under the caller, failures by status', async () => {
    const { tp, roots } = setup();
    const uninstall = instrumentFetch(tp);
    try {
      await tp.track(async () => {
        await fetch(`${base}/users?id=1`);
        await fetch(`${base}/fail`, { method: 'post' });
      }, { label: 'job' });
    } finally {
      uninstall();
    }
    const job = roots.find(r => r.label === 'job')!;
    expect(job.children.map(c => c.label)).toEqual([
      `fetch GET 127.0.0.1:${new URL(base).port}/users`,
      `fetch POST 127.0.0.1:${new URL(base).port}/fail`,
    ]);
    expect((job.children[1].error as Error).message).toBe('HTTP 503');
    expect(job.children[0].error).toBeUndefined();
  });

  test('is idempotent and uninstalls cleanly', async () => {
    const { tp, roots } = setup();
    const original = globalThis.fetch;
    const a = instrumentFetch(tp);
    const b = instrumentFetch(tp);
    await fetch(`${base}/x`);
    expect(roots).toHaveLength(1);
    b();
    a();
    expect(globalThis.fetch).toBe(original);
  });
});

describe('instrumentHttp', () => {
  test('tracks http.get and http.request once each, until the body is read', async () => {
    const { tp, roots } = setup();
    const uninstall = instrumentHttp(tp);
    try {
      await tp.track(async () => {
        expect(await get(`${base}/a`)).toBe(200);
        await new Promise<void>((resolve, reject) => {
          const req = http.request(`${base}/fail?q=1`, { method: 'DELETE' }, res => { res.resume(); res.on('end', resolve); });
          req.on('error', reject);
          req.end();
        });
      }, { label: 'job' });
    } finally {
      uninstall();
    }
    const job = roots.find(r => r.label === 'job')!;
    expect(job.children.map(c => c.label)).toEqual([
      `http GET 127.0.0.1:${new URL(base).port}/a`,
      `http DELETE 127.0.0.1:${new URL(base).port}/fail`,
    ]);
    expect(job.children[0].duration).toBeGreaterThanOrEqual(4);
    expect((job.children[1].error as Error).message).toBe('HTTP 503');
    expect(http.get).not.toHaveProperty([Symbol.for('traceperf.instrumented')]);
  });

  test('connection errors mark the call failed', async () => {
    const { tp, roots } = setup();
    const uninstall = instrumentHttp(tp);
    try {
      await expect(get('http://127.0.0.1:1/')).rejects.toThrow();
      for (let i = 0; i < 20 && roots.length === 0; i++) await new Promise(r => setTimeout(r, 5));
    } finally {
      uninstall();
    }
    expect(roots[0].error).toBeDefined();
  });
});

describe('instrumentMethods', () => {
  class Client {
    calls = 0;
    query(sql: string) { this.calls++; return Promise.resolve(sql.length); }
    close() { return 'closed'; }
  }

  test('patches a prototype in place; labels default to Class.method; restore works', async () => {
    const { tp, roots } = setup();
    const restore = instrumentMethods(tp, Client.prototype);
    const client = new Client();
    expect(await client.query('SELECT 1')).toBe(8);
    expect(client.close()).toBe('closed');
    expect(client.calls).toBe(1);
    restore();
    client.close();
    expect(roots.map(r => r.label)).toEqual(['Client.query', 'Client.close']);
    expect(Client.prototype.query.name).toBe('query');
  });

  test('labelFor computes per-call labels (e.g. from SQL)', async () => {
    const { tp, roots } = setup();
    const restore = instrumentMethods(tp, Client.prototype, ['query'], {
      labelFor: (_m, [sql]) => `pg ${String(sql).trim().split(/\s+/)[0]}`,
    });
    const client = new Client();
    await client.query('  SELECT * FROM users');
    await client.query('INSERT INTO t VALUES (1)');
    restore();
    expect(roots.map(r => r.label)).toEqual(['pg SELECT', 'pg INSERT']);
  });
});

describe('prismaExtension', () => {
  test('wraps every model operation as prisma.Model.operation', async () => {
    const { tp, roots } = setup();
    const ext = prismaExtension(tp);
    const result = await ext.query.$allModels.$allOperations({
      model: 'User', operation: 'findMany', args: { take: 1 },
      query: async (args: any) => [{ id: 1, take: args.take }],
    });
    expect(result).toEqual([{ id: 1, take: 1 }]);
    expect(roots[0].label).toBe('prisma.User.findMany');
  });
});

/**
 * Framework integrations against the real frameworks.
 */
import * as http from 'http';
import * as path from 'path';
import { execFileSync, execSync } from 'child_process';
import express from 'express';
import Fastify from 'fastify';
import { Hono } from 'hono';
import {
  createTracePerf,
  ExecutionRecord,
  expressMiddleware,
  fastifyPlugin,
  honoMiddleware,
  koaMiddleware,
  nestInterceptor,
  withTracing,
} from '../index';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect() {
  const roots: ExecutionRecord[] = [];
  const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
  const db = (label: string) => tp.track(async () => { await sleep(5); return 1; }, { label });
  return { tp, roots, db };
}

async function waitFor(roots: ExecutionRecord[], n: number) {
  for (let i = 0; i < 100 && roots.length < n; i++) await sleep(5);
}

function listen(server: http.Server): Promise<string> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const addr = server.address() as { port: number };
    resolve(`http://127.0.0.1:${addr.port}`);
  }));
}

describe('expressMiddleware', () => {
  test('one root per request, labelled by route, with nested work', async () => {
    const { tp, roots, db } = collect();
    const app = express();
    app.use(expressMiddleware(tp));
    app.get('/users/:id', async (_req, res) => {
      await db('db.findUser');
      await db('db.findPosts');
      res.json({ ok: true });
    });
    app.get('/boom', (_req, res) => { res.status(500).send('no'); });
    const server = http.createServer(app);
    const base = await listen(server);
    try {
      await Promise.all([fetch(`${base}/users/1?x=1`), fetch(`${base}/users/2`)]);
      await fetch(`${base}/boom`);
      await waitFor(roots, 3);
    } finally {
      server.close();
    }
    const users = roots.filter(r => r.label === 'GET /users/:id');
    expect(users).toHaveLength(2);
    for (const root of users) {
      expect(root.children.map(c => c.label)).toEqual(['db.findUser', 'db.findPosts']);
    }
    const boom = roots.find(r => r.label === 'GET /boom')!;
    expect((boom.error as Error).message).toBe('HTTP 500');
  });
});

describe('fastifyPlugin', () => {
  test('one root per request, labelled by route, with nested work', async () => {
    const { tp, roots, db } = collect();
    // fetch keeps connections alive; close them so app.close() does not wait (Node 18)
    const app = Fastify({ forceCloseConnections: true });
    await app.register(fastifyPlugin(tp));
    app.get('/items/:id', async () => {
      await db('db.item');
      return { ok: true };
    });
    try {
      const base = await app.listen({ port: 0, host: '127.0.0.1' });
      const responses = await Promise.all([fetch(`${base}/items/1`), fetch(`${base}/items/2?q=1`)]);
      expect(responses.map(r => r.status)).toEqual([200, 200]);
      await waitFor(roots, 2);
    } finally {
      await app.close();
    }
    expect(roots.map(r => r.label)).toEqual(['GET /items/:id', 'GET /items/:id']);
    roots.forEach(r => expect(r.children.map(c => c.label)).toEqual(['db.item']));
  });
});

describe('honoMiddleware', () => {
  test('one root per request, labelled by route, with nested work and errors', async () => {
    const { tp, roots, db } = collect();
    const app = new Hono();
    app.use('*', honoMiddleware(tp));
    app.get('/posts/:id', async c => {
      await db('db.post');
      return c.json({ ok: true });
    });
    app.get('/fail', () => { throw new Error('handler failed'); });
    const ok = await app.request('/posts/9');
    const failed = await app.request('/fail');
    expect(ok.status).toBe(200);
    expect(failed.status).toBe(500);
    await waitFor(roots, 2);
    const post = roots.find(r => r.label === 'GET /posts/:id')!;
    expect(post.children.map(c => c.label)).toEqual(['db.post']);
    const fail = roots.find(r => r.label.startsWith('GET /fail'))!;
    expect((fail.error as Error).message).toBe('handler failed');
  });
});

describe('withTracing', () => {
  test('wraps a fetch-style route handler (e.g. Next.js)', async () => {
    const { tp, roots, db } = collect();
    const GET = withTracing(tp, async function GET(request: Request) {
      await db('db.list');
      return new Response(`hello ${new URL(request.url).searchParams.get('name')}`);
    });
    const response = await GET(new Request('http://localhost/api/hello?name=ada'));
    expect(await response.text()).toBe('hello ada');
    expect(GET.name).toBe('GET');
    expect(roots[0].label).toBe('GET /api/hello');
    expect(roots[0].children.map(c => c.label)).toEqual(['db.list']);
  });
});

describe('koaMiddleware', () => {
  test('one root per request, nested work, thrown errors', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Koa = require('koa');
    const { tp, roots, db } = collect();
    const app = new Koa();
    app.use(koaMiddleware(tp));
    app.use(async (ctx: any) => {
      if (ctx.path === '/boom') throw new Error('kaboom');
      await db('db.koa');
      ctx.body = { ok: true };
    });
    app.silent = true;
    const server = http.createServer(app.callback());
    const base = await listen(server);
    try {
      expect((await fetch(`${base}/things?x=1`)).status).toBe(200);
      expect((await fetch(`${base}/boom`)).status).toBe(500);
      await waitFor(roots, 2);
    } finally {
      server.close();
    }
    const ok = roots.find(r => r.label === 'GET /things')!;
    expect(ok.children.map(c => c.label)).toEqual(['db.koa']);
    expect((roots.find(r => r.label === 'GET /boom')!.error as Error).message).toBe('kaboom');
  });
});

describe('nestInterceptor (real rxjs observables)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { from, throwError, lastValueFrom } = require('rxjs');
  const ctx = (req: any, res: any = { statusCode: 200 }) => ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getClass: () => ({ name: 'UsersController' }),
    getHandler: () => ({ name: 'findOne' }),
  });

  test('wraps the handler observable; nested work; route label', async () => {
    const { tp, roots, db } = collect();
    const interceptor = nestInterceptor(tp);
    const handle = () => from((async () => { await db('db.nest'); return { id: 1 }; })());
    const result = await lastValueFrom(interceptor.intercept(
      ctx({ method: 'GET', url: '/users/1', route: { path: '/users/:id' } }), { handle }));
    expect(result).toEqual({ id: 1 });
    await waitFor(roots, 1);
    expect(roots[0].label).toBe('GET /users/:id');
    expect(roots[0].children.map(c => c.label)).toEqual(['db.nest']);
  });

  test('errors and non-HTTP contexts', async () => {
    const { tp, roots } = collect();
    const interceptor = nestInterceptor(tp);
    await expect(lastValueFrom(interceptor.intercept(ctx({ method: 'POST', url: '/x' }), {
      handle: () => throwError(() => new Error('nest failed')),
    }))).rejects.toThrow('nest failed');
    const rpc = { getType: () => 'rpc', getClass: () => ({ name: 'Jobs' }), getHandler: () => ({ name: 'run' }) };
    await lastValueFrom(interceptor.intercept(rpc, { handle: () => from([1]) }));
    expect((roots[0].error as Error).message).toBe('nest failed');
    expect(roots[1].label).toBe('Jobs.run');
  });
});

describe('nestInterceptor (real NestJS app)', () => {
  test('global interceptor: one root per request labelled by route, nested work', () => {
    // Plain Node process: NestJS 12 is ESM-only
    const root = path.resolve(__dirname, '..', '..');
    execSync('npm run build:esm', { cwd: root, stdio: 'ignore' });
    const out = execFileSync(process.execPath, [path.join(root, 'test/integrations/nest-check.mjs')], { encoding: 'utf8' });
    expect(JSON.parse(out.trim())).toEqual({ body: { ok: true }, label: 'GET /users/:id', children: ['db.nestUser'] });
  }, 120000);
});

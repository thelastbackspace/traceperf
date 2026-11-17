import { expressRoutes, pathsToProbe, recordMountPaths, routeSink, serverRoutes } from '../routes';
import { wrapFastifyFactory } from '../instrument';

/* eslint-disable @typescript-eslint/no-require-imports */
const express = require('express');
const fastify = require('fastify');
/* eslint-enable @typescript-eslint/no-require-imports */

// Express 5 (this repository's dev dependency) needs the mount paths recorded, as traceperf/auto does
let unrecord: () => void;
beforeAll(() => { unrecord = recordMountPaths(express); });
afterAll(() => unrecord());

describe('recordMountPaths', () => {
  it('patches once and ignores modules without a Router', () => {
    expect(recordMountPaths(express)()).toBeUndefined();
    expect(recordMountPaths({})()).toBeUndefined();
  });
});

describe('expressRoutes', () => {
  it('lists routes with their methods, nested routers and mount paths included', () => {
    const app = express();
    const api = express.Router();
    const users = express.Router({ mergeParams: true });
    api.get('/stats', () => undefined);
    api.route('/items').get(() => undefined).post(() => undefined);
    users.get('/', () => undefined);
    users.get('/:id', () => undefined);
    api.use('/users', users);
    app.use('/api/v1', api);
    app.get('/health', () => undefined);
    app.use((_req: unknown, _res: unknown, next: () => void) => next());
    expect(expressRoutes(app)).toEqual([
      { method: 'GET', path: '/api/v1/stats' },
      { method: 'GET', path: '/api/v1/items' },
      { method: 'POST', path: '/api/v1/items' },
      { method: 'GET', path: '/api/v1/users/' },
      { method: 'GET', path: '/api/v1/users/:id' },
      { method: 'GET', path: '/health' },
    ]);
  });

  it('reads Express 4 mount paths from their regular expressions, with a parameter, and skips a router mounted on a pattern', () => {
    const route = (path: string) => ({ route: { path, methods: { get: true } } });
    const layer = (source: string, stack: unknown[]) => ({ name: 'router', regexp: new RegExp(source), handle: { stack } });
    const app = {
      _router: {
        stack: [
          layer('^\\/api\\/v1\\/?(?=\\/|$)', [route('/a')]),
          layer('^\\/shops\\/(?:([^\\/]+?))\\/?(?=\\/|$)', [route('/orders')]),
          layer('^\\/?(?=\\/|$)', [route('/root')]),
          layer('^\\/re(gex)?\\/?(?=\\/|$)', [route('/x')]),
          { name: 'router', handle: { stack: [route('/no-regexp')] } },
        ],
      },
    };
    expect(expressRoutes(app)).toEqual([
      { method: 'GET', path: '/api/v1/a' },
      { method: 'GET', path: '/shops/:param/orders' },
      { method: 'GET', path: '/root' },
    ]);
  });

  it('reads a mount path with a parameter (Express 5), and skips a router mounted on a pattern', () => {
    const app = express();
    const orders = express.Router();
    orders.get('/orders', () => undefined);
    app.use('/shops/:shopId', orders);
    const odd = express.Router();
    odd.get('/x', () => undefined);
    app.use(/^\/re(gex)?/, odd);
    expect(expressRoutes(app)).toEqual([{ method: 'GET', path: '/shops/:shopId/orders' }]);
  });

  it('returns nothing for something that is not an Express app', () => {
    expect(expressRoutes({})).toEqual([]);
    expect(expressRoutes({ get _router() { throw new Error('no'); }, get router() { throw new Error('no'); } })).toEqual([]);
  });

  it('reads Express 5 style layers (rawPath)', () => {
    const route = (path: string, methods: Record<string, boolean>) => ({ route: { path, methods } });
    const app = {
      router: {
        stack: [
          { name: 'router', rawPath: '/api', handle: { stack: [route('/a', { get: true, _all: true })] } },
          { name: 'router', rawPath: '/', handle: { stack: [route('/b', { post: true })] } },
          route('/', { get: true }),
        ],
      },
    };
    expect(expressRoutes(app)).toEqual([
      { method: 'GET', path: '/api/a' },
      { method: 'POST', path: '/b' },
      { method: 'GET', path: '/' },
    ]);
  });
});

describe('serverRoutes', () => {
  it('finds the Express app among the server request listeners, plus routes reported by Fastify, without duplicates', async () => {
    const sink = routeSink();
    sink.length = 0;
    const app = express();
    app.get('/a', () => undefined);
    const server = { listeners: () => [() => undefined, app] };
    const f = wrapFastifyFactory(fastify)();
    f.get('/f', async () => ({}));
    f.get('/f', { constraints: { version: '1.0.0' } }, async () => ({}));
    await f.ready();
    const routes = serverRoutes(server);
    expect(routes).toEqual(expect.arrayContaining([{ method: 'GET', path: '/a' }, { method: 'GET', path: '/f' }]));
    expect(routes.filter(r => r.path === '/f' && r.method === 'GET')).toHaveLength(1);
    await f.close();
    sink.length = 0;
    expect(serverRoutes(undefined)).toEqual([]);
  });
});

describe('pathsToProbe', () => {
  const routes = [
    { method: 'GET', path: '/users' },
    { method: 'POST', path: '/users' },
    { method: 'GET', path: '/users/:id' },
    { method: 'GET', path: '/users/:id/orders/:orderId?' },
    { method: 'GET', path: '/files/*' },
    { method: 'GET', path: '/health' },
    { method: 'GET', path: '/users' },
  ];

  it('keeps GET routes without parameters and skips the rest', () => {
    expect(pathsToProbe(routes)).toEqual({ paths: ['/users', '/health'], skipped: ['/users/:id', '/users/:id/orders/:orderId?', '/files/*'] });
  });

  it('fills parameters it has values for, and leaves out ignored paths', () => {
    expect(pathsToProbe(routes, { id: '7', orderId: 'a b' }, /^\/health/)).toEqual({
      paths: ['/users', '/users/7', '/users/7/orders/a%20b'],
      skipped: ['/files/*', '/health'],
    });
  });
});

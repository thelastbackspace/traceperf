/**
 * Auto-instrumentation: track common I/O without wrapping each call by hand.
 *
 * Every instrument* function patches in place, is idempotent, and returns a
 * function that removes the patch. Calls made inside a tracked call nest
 * under it like any other tracked call.
 */
import type { OptimizedPerformanceMonitor } from './core/optimized-performance-monitor';
import type { TrackOptions } from './types/options';
import { loadNodeBuiltin } from './core/env';

const PATCHED = Symbol.for('traceperf.instrumented');

export interface InstrumentOptions extends Omit<TrackOptions, 'label'> {
  /** Treat HTTP responses with status >= this as failed (default 500) */
  errorStatus?: number;
}

/** Removes an instrumentation patch */
export type Uninstall = () => void;

function describeUrl(input: unknown): { method?: string; host: string; path: string } {
  try {
    if (typeof input === 'string' || input instanceof URL) {
      const url = new URL(String(input), 'http://localhost');
      return { host: url.host, path: url.pathname };
    }
    if (input && typeof (input as any).url === 'string') {
      const url = new URL((input as any).url, 'http://localhost');
      return { method: (input as any).method, host: url.host, path: url.pathname };
    }
  } catch {
    // fall through
  }
  return { host: 'unknown', path: '' };
}

/**
 * Track every `fetch()` call: label "fetch GET api.example.com/users".
 * Timing covers the request until the response headers arrive (reading the
 * body is not included). Responses with status >= 500 are marked failed.
 */
export function instrumentFetch(tp: OptimizedPerformanceMonitor, options: InstrumentOptions = {}): Uninstall {
  const g: any = typeof globalThis !== 'undefined' ? globalThis : undefined;
  if (!g || typeof g.fetch !== 'function') return () => undefined;
  if (g.fetch[PATCHED]) return () => undefined;
  const { errorStatus = 500, ...trackOptions } = options;
  const original = g.fetch;
  const patched = function fetch(this: unknown, input: unknown, init?: { method?: string }) {
    const { method: inputMethod, host, path } = describeUrl(input);
    const method = (init && init.method) || inputMethod || 'GET';
    const span = tp.start(`fetch ${method.toUpperCase()} ${host}${path}`, trackOptions);
    let promise: Promise<any>;
    try {
      promise = span.run(() => original.call(this, input, init));
    } catch (error) {
      span.end(error);
      throw error;
    }
    return Promise.resolve(promise).then(
      response => {
        span.end(response && response.status >= errorStatus ? new Error(`HTTP ${response.status}`) : undefined);
        return response;
      },
      error => {
        span.end(error);
        throw error;
      }
    );
  };
  (patched as any)[PATCHED] = original;
  g.fetch = patched;
  return () => {
    if (g.fetch === patched) g.fetch = original;
  };
}

/**
 * Track outgoing Node.js http/https requests (`request` and `get`), which
 * covers clients built on them such as axios and got. Label:
 * "http GET api.example.com/users". Timing covers the full response
 * (until the body has been read). Node.js only.
 */
export function instrumentHttp(tp: OptimizedPerformanceMonitor, options: InstrumentOptions = {}): Uninstall {
  const { errorStatus = 500, ...trackOptions } = options;
  const restores: Uninstall[] = [];
  for (const moduleName of ['http', 'https']) {
    const mod = loadNodeBuiltin(moduleName);
    if (!mod) continue;
    for (const fnName of ['request', 'get']) {
      const original = mod[fnName];
      if (typeof original !== 'function' || original[PATCHED]) continue;
      const patched = function (this: unknown, ...args: unknown[]) {
        const span = tp.start(`${moduleName} request`, trackOptions);
        let req: any;
        try {
          req = span.run(() => original.apply(this, args));
        } catch (error) {
          span.end(error);
          throw error;
        }
        // The Host header includes a non-default port; req.host does not
        const host = (typeof req.getHeader === 'function' && req.getHeader('host')) || req.host || 'unknown';
        span.setLabel(`${moduleName} ${req.method || 'GET'} ${host}${String(req.path || '').split('?')[0]}`);
        let ended = false;
        let statusError: Error | undefined;
        // Whichever of res 'end' / res 'close' / req 'close' comes first ends
        // the span (their order differs between Node versions)
        const end = (error: unknown = statusError) => {
          if (ended) return;
          ended = true;
          span.end(error);
        };
        req.once('response', (res: any) => {
          statusError = res.statusCode >= errorStatus ? new Error(`HTTP ${res.statusCode}`) : undefined;
          res.once('end', () => end());
          res.once('close', () => end());
        });
        req.once('error', (error: unknown) => end(error));
        req.once('close', () => end());
        return req;
      };
      (patched as any)[PATCHED] = original;
      mod[fnName] = patched;
      restores.push(() => {
        if (mod[fnName] === patched) mod[fnName] = original;
      });
    }
  }
  return () => restores.forEach(restore => restore());
}

export interface InstrumentMethodsOptions extends TrackOptions {
  /** Label prefix, e.g. "pg." (default: the constructor name of `target` plus ".") */
  prefix?: string;
  /** Compute the label per call, e.g. from the SQL text */
  labelFor?: (method: string, args: unknown[]) => string;
}

/**
 * Patch methods of an object or prototype in place, e.g. a database client:
 *
 *   instrumentMethods(tp, pg.Client.prototype, ['query'], {
 *     labelFor: (_m, [q]) => `pg ${String(q?.text ?? q).trim().split(/\s+/)[0]}`,
 *   });
 *
 * `methods` defaults to every own function property except the constructor.
 */
export function instrumentMethods(
  tp: OptimizedPerformanceMonitor,
  target: object,
  methods?: string[],
  options: InstrumentMethodsOptions = {}
): Uninstall {
  const { prefix, labelFor, ...trackOptions } = options;
  const ctor = (target as any).constructor;
  const ownerName = typeof target === 'function' ? (target as Function).name
    : ctor && ctor.prototype === target ? ctor.name
      : ctor && ctor !== Object ? ctor.name : '';
  const labelPrefix = prefix ?? (ownerName ? `${ownerName}.` : '');
  const names = methods ?? Object.getOwnPropertyNames(target).filter(name => {
    if (name === 'constructor') return false;
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    return !!descriptor && typeof descriptor.value === 'function';
  });
  const restores: Uninstall[] = [];
  for (const name of names) {
    const original = (target as any)[name];
    if (typeof original !== 'function' || original[PATCHED]) continue;
    const patched = function (this: unknown, ...args: unknown[]) {
      const label = labelFor ? labelFor(name, args) : `${labelPrefix}${name}`;
      return tp.track(() => original.apply(this, args), { ...trackOptions, label });
    };
    Object.defineProperty(patched, 'name', { value: original.name, configurable: true });
    Object.defineProperty(patched, 'length', { value: original.length, configurable: true });
    (patched as any)[PATCHED] = original;
    const hadOwn = Object.prototype.hasOwnProperty.call(target, name);
    (target as any)[name] = patched;
    restores.push(() => {
      if ((target as any)[name] !== patched) return;
      if (hadOwn) (target as any)[name] = original;
      else delete (target as any)[name];
    });
  }
  return () => restores.forEach(restore => restore());
}

/**
 * Prisma client extension: every model operation becomes a tracked call
 * labelled "prisma.User.findMany".
 *
 *   const prisma = new PrismaClient().$extends(prismaExtension(tp));
 */
export function prismaExtension(tp: OptimizedPerformanceMonitor, options: TrackOptions = {}) {
  return {
    name: 'traceperf',
    query: {
      $allModels: {
        $allOperations(params: { model?: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }) {
          // Already tracked by instrumentPrisma / traceperf/auto: don't count it twice
          if ((globalThis as any)[Symbol.for('traceperf.prisma.patched')] > 0) return params.query(params.args);
          const label = options.label ?? `prisma.${params.model ?? 'raw'}.${params.operation}`;
          return tp.track(() => params.query(params.args), { ...options, label });
        },
      },
    },
  };
}

/**
 * Collapse ids in a URL path so labels stay few: /users/42/orders/9f1c... ->
 * /users/:id/orders/:id. Numbers, UUIDs, long hex and long mixed tokens count as ids.
 */
export function normalizePath(url: string): string {
  let path = String(url || '/');
  const q = path.search(/[?#]/);
  if (q !== -1) path = path.slice(0, q);
  if (!path) return '/';
  // Fast path: ids always contain a digit
  if (!/\d/.test(path)) return path;
  const segments = path.split('/');
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg && /\d/.test(seg) && isIdSegment(seg)) segments[i] = ':id';
  }
  return segments.join('/');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isIdSegment(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (seg.length === 36 && UUID.test(seg)) return true;
  if (seg.length >= 16 && /^[0-9a-f]+$/i.test(seg)) return true;
  return seg.length >= 20 && /^[A-Za-z0-9_-]+$/.test(seg);
}

export interface HttpServerInstrumentOptions extends InstrumentOptions {
  /** Label for a request (default "GET /users/:id", ids collapsed by normalizePath) */
  labelFor?: (req: { method?: string; url?: string; headers?: Record<string, unknown> }) => string;
  /** Skip requests for which this returns true, e.g. health checks */
  ignore?: (req: { method?: string; url?: string }) => boolean;
}

/**
 * Track every incoming request of every Node http/https server as a
 * top-level call, so work done while handling it (queries, fetches, tracked
 * functions) nests under it, with no framework middleware. Responses with
 * status >= 500 and connections closed before a response count as failed.
 */
export function instrumentHttpServer(tp: OptimizedPerformanceMonitor, options: HttpServerInstrumentOptions = {}): Uninstall {
  const { errorStatus = 500, labelFor, ignore, ...trackOptions } = options;
  const restores: Uninstall[] = [];
  for (const moduleName of ['http', 'https']) {
    const mod = loadNodeBuiltin(moduleName);
    const proto = mod && mod.Server && mod.Server.prototype;
    if (!proto) continue;
    const original = proto.emit;
    if (typeof original !== 'function' || original[PATCHED]) continue;
    const hadOwn = Object.prototype.hasOwnProperty.call(proto, 'emit');
    const patched = function (this: unknown, event: string, req: any, res: any, ...rest: unknown[]) {
      if (event !== 'request' || !req || !res || typeof res.once !== 'function' || (ignore && ignore(req))) {
        return original.call(this, event, req, res, ...rest);
      }
      const label = labelFor ? labelFor(req) : `${req.method || 'GET'} ${normalizePath(req.url)}`;
      const span = tp.start(label, trackOptions);
      // Disabled or sampled out: nothing to finish
      if (!span.id) return original.call(this, event, req, res, ...rest);
      let ended = false;
      const end = (error?: unknown) => {
        if (ended) return;
        ended = true;
        // Express (4, 5, and Nest on it) knows the route: "/api/articles/:slug", not the slug itself
        const route = !labelFor && req.route && typeof req.route.path === 'string' ? req.route.path : undefined;
        if (route) {
          const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
          // router.route('/') under app.use('/v1/users') is "/v1/users", not "/v1/users/"
          const full = base && route === '/' ? base : `${base}${route}`;
          span.setLabel(`${req.method || 'GET'} ${full}`);
        }
        span.end(error);
      };
      res.once('finish', () => end(res.statusCode >= errorStatus ? new Error(`HTTP ${res.statusCode}`) : undefined));
      res.once('close', () => end(res.writableFinished ? undefined : new Error('connection closed before the response was sent')));
      try {
        return span.run(() => original.call(this, event, req, res, ...rest));
      } catch (error) {
        end(error);
        throw error;
      }
    };
    (patched as any)[PATCHED] = original;
    proto.emit = patched;
    restores.push(() => {
      if (proto.emit !== patched) return;
      if (hadOwn) proto.emit = original;
      else delete proto.emit;
    });
  }
  return () => restores.forEach(restore => restore());
}

/**
 * Framework integrations: one top-level execution per HTTP request, with
 * tracked calls made while handling the request nested under it.
 *
 * Every helper takes the traceperf instance to record into, so they work
 * with the default instance and with createTracePerf() instances alike.
 */
import type { OptimizedPerformanceMonitor, Span } from './core/optimized-performance-monitor';
import type { TrackOptions } from './types/options';

/** What a label function gets to work with */
export interface RequestInfo {
  method: string;
  /** Route pattern when the framework knows it, e.g. "/users/:id" */
  route?: string;
  /** Path without the query string */
  path: string;
}

export interface HttpTracingOptions extends Omit<TrackOptions, 'label'> {
  /** Build the label; default "METHOD /route/pattern" (falls back to the path) */
  label?: (request: RequestInfo) => string;
  /** Treat responses with status >= this as failed (default 500) */
  errorStatus?: number;
}

const stripQuery = (url: string | undefined): string => {
  if (!url) return '/';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
};

const defaultLabel = (r: RequestInfo): string => `${r.method} ${r.route || r.path}`;

const statusError = (status: number | undefined, errorStatus: number): Error | undefined =>
  status !== undefined && status >= errorStatus ? new Error(`HTTP ${status}`) : undefined;

function splitOptions(options: HttpTracingOptions) {
  const { label = defaultLabel, errorStatus = 500, ...trackOptions } = options;
  return { label, errorStatus, trackOptions };
}

/**
 * Express / Connect middleware. Register it before your routes:
 *
 *   app.use(expressMiddleware(tp));
 */
export function expressMiddleware(tp: OptimizedPerformanceMonitor, options: HttpTracingOptions = {}) {
  const { label, errorStatus, trackOptions } = splitOptions(options);
  return function traceperfExpress(req: any, res: any, next: (err?: unknown) => void): void {
    const path = stripQuery(req.originalUrl || req.url);
    const span = tp.start(label({ method: req.method, path }), trackOptions);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const route = req.route && req.route.path ? `${req.baseUrl || ''}${req.route.path}` : undefined;
      span.setLabel(label({ method: req.method, route, path }));
      span.end(statusError(res.statusCode, errorStatus));
    };
    res.once('finish', finish);
    res.once('close', finish);
    span.run(() => next());
  };
}

/**
 * Fastify plugin (applies to every route, no fastify-plugin needed):
 *
 *   await app.register(fastifyPlugin(tp));
 */
export function fastifyPlugin(tp: OptimizedPerformanceMonitor, options: HttpTracingOptions = {}) {
  const { label, errorStatus, trackOptions } = splitOptions(options);
  const spanKey = Symbol('traceperf.span');
  const plugin = function traceperfFastify(fastify: any, _opts: unknown, done: () => void): void {
    fastify.addHook('onRequest', (request: any, _reply: any, hookDone: () => void) => {
      const span = tp.start(label({ method: request.method, path: stripQuery(request.url) }), trackOptions);
      request[spanKey] = span;
      span.run(() => hookDone());
    });
    fastify.addHook('onResponse', (request: any, reply: any, hookDone: () => void) => {
      const span: Span | undefined = request[spanKey];
      if (span) {
        const route = (request.routeOptions && request.routeOptions.url) || request.routerPath;
        span.setLabel(label({ method: request.method, route, path: stripQuery(request.url) }));
        span.end(statusError(reply.statusCode, errorStatus));
      }
      hookDone();
    });
    done();
  };
  // Same effect as wrapping with fastify-plugin: hooks apply to the whole app
  (plugin as any)[Symbol.for('skip-override')] = true;
  (plugin as any)[Symbol.for('fastify.display-name')] = 'traceperf';
  return plugin;
}

/**
 * Hono middleware:
 *
 *   app.use('*', honoMiddleware(tp));
 */
export function honoMiddleware(tp: OptimizedPerformanceMonitor, options: HttpTracingOptions = {}) {
  const { label, errorStatus, trackOptions } = splitOptions(options);
  return async function traceperfHono(c: any, next: () => Promise<void>): Promise<void> {
    const path = c.req.path;
    const span = tp.start(label({ method: c.req.method, path }), trackOptions);
    let thrown: unknown;
    try {
      await span.run(() => next());
    } catch (error) {
      thrown = error;
      throw error;
    } finally {
      const route = typeof c.req.routePath === 'string' && c.req.routePath !== '/*' && c.req.routePath !== '*'
        ? c.req.routePath : undefined;
      span.setLabel(label({ method: c.req.method, route, path }));
      span.end(thrown ?? c.error ?? statusError(c.res && c.res.status, errorStatus));
    }
  };
}

/**
 * Wrap any request handler, e.g. a Next.js route handler:
 *
 *   export const GET = withTracing(tp, async (request) => { ... });
 *
 * When the first argument looks like a Request, the label defaults to
 * "METHOD /path"; otherwise the function name.
 */
export function withTracing<T extends (...args: any[]) => any>(
  tp: OptimizedPerformanceMonitor,
  handler: T,
  options: Omit<HttpTracingOptions, 'errorStatus'> = {}
): (...args: Parameters<T>) => ReturnType<T> {
  const { label, trackOptions } = splitOptions(options);
  const wrapped = function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
    const request = args[0];
    let name = handler.name || 'handler';
    if (request && typeof request.method === 'string' && typeof request.url === 'string') {
      let path = stripQuery(request.url);
      try {
        path = new URL(request.url, 'http://localhost').pathname;
      } catch {
        // keep the raw path
      }
      name = label({ method: request.method, path });
    }
    return tp.track(() => handler.apply(this, args), { ...trackOptions, label: name });
  };
  Object.defineProperty(wrapped, 'name', { value: handler.name, configurable: true });
  Object.defineProperty(wrapped, 'length', { value: handler.length, configurable: true });
  return wrapped;
}

/**
 * Koa middleware. Register it first:
 *
 *   app.use(koaMiddleware(tp));
 *
 * Labels use the matched route when @koa/router sets ctx._matchedRoute.
 */
export function koaMiddleware(tp: OptimizedPerformanceMonitor, options: HttpTracingOptions = {}) {
  const { label, errorStatus, trackOptions } = splitOptions(options);
  return async function traceperfKoa(ctx: any, next: () => Promise<unknown>): Promise<void> {
    const path = stripQuery(ctx.path || ctx.url);
    const span = tp.start(label({ method: ctx.method, path }), trackOptions);
    let thrown: unknown;
    try {
      await span.run(() => next());
    } catch (error) {
      thrown = error;
      throw error;
    } finally {
      const route = typeof ctx._matchedRoute === 'string' ? ctx._matchedRoute : undefined;
      span.setLabel(label({ method: ctx.method, route, path }));
      const status = thrown ? ((thrown as any).status || (thrown as any).statusCode || 500) : ctx.status;
      span.end(thrown && status >= errorStatus ? thrown : statusError(status, errorStatus));
    }
  };
}

/**
 * NestJS interceptor (works without importing Nest or rxjs into traceperf):
 *
 *   app.useGlobalInterceptors(nestInterceptor(tp));
 *
 * Label: "GET /users/:id" for HTTP, otherwise "Controller.handler".
 */
export function nestInterceptor(tp: OptimizedPerformanceMonitor, options: HttpTracingOptions = {}) {
  const { label, errorStatus, trackOptions } = splitOptions(options);
  return {
    intercept(context: any, next: { handle(): any }) {
      const type = typeof context.getType === 'function' ? context.getType() : 'http';
      const request = type === 'http' ? context.switchToHttp().getRequest() : undefined;
      const response = type === 'http' ? context.switchToHttp().getResponse() : undefined;
      const handlerName = `${context.getClass?.().name ?? 'Controller'}.${context.getHandler?.().name ?? 'handler'}`;
      const route = request && request.route && request.route.path
        ? `${request.baseUrl || ''}${request.route.path}` : request && request.routeOptions && request.routeOptions.url;
      const name = request
        ? label({ method: request.method, route, path: stripQuery(request.originalUrl || request.url) })
        : handlerName;
      const span = tp.start(name, trackOptions);
      const source = span.run(() => next.handle());
      const Observable = source.constructor;
      return new Observable((subscriber: any) => {
        const subscription = span.run(() => source.subscribe({
          next: (value: unknown) => subscriber.next(value),
          error: (error: unknown) => {
            span.end(error);
            subscriber.error(error);
          },
          complete: () => {
            const status = response && (response.statusCode ?? (typeof response.status === 'number' ? response.status : undefined));
            span.end(statusError(status, errorStatus));
            subscriber.complete();
          },
        }));
        return () => {
          subscription.unsubscribe();
          span.end();
        };
      });
    },
  };
}

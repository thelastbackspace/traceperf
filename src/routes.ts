/**
 * The routes an app defines, so `traceperf run --routes` can send traffic
 * without a --path for each: Express 4 and 5 (read from the router when the
 * server starts listening) and Fastify (collected as routes are added).
 */

export interface DiscoveredRoute {
  method: string;
  /** "/users/:id": parameters as the framework writes them */
  path: string;
}

const SINK = Symbol.for('traceperf.routes');

/** Routes reported by framework hooks (Fastify's onRoute) in this process */
export function routeSink(): DiscoveredRoute[] {
  const g = globalThis as any;
  return (g[SINK] = g[SINK] || []);
}

const MOUNT = Symbol.for('traceperf.mountPath');

/**
 * Express 5 doesn't keep the path a router was mounted at (app.use('/api', router)):
 * remember it on the layers router.use adds. Express 4 keeps it in a regular
 * expression, read by prefixOf. Returns an uninstall function.
 */
export function recordMountPaths(express: any): () => void {
  const proto = express && express.Router && express.Router.prototype;
  const original = proto && proto.use;
  if (typeof original !== 'function' || original[MOUNT]) return () => undefined;
  const patched = function (this: any, ...args: any[]) {
    const before = Array.isArray(this && this.stack) ? this.stack.length : -1;
    const result = original.apply(this, args);
    const path = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (before >= 0 && typeof path === 'string') {
      for (const layer of this.stack.slice(before)) {
        try {
          layer[MOUNT] = path;
        } catch {
          // a frozen layer keeps no path
        }
      }
    }
    return result;
  };
  (patched as any)[MOUNT] = true;
  proto.use = patched;
  return () => {
    if (proto.use === patched) proto.use = original;
  };
}

/** "^\/api\/v1\/?(?=\/|$)" (Express 4 router mount) → "/api/v1"; undefined when it is not a plain prefix */
function prefixOf(layer: any): string | undefined {
  const mounted = layer[MOUNT] ?? layer.rawPath; // Express 5
  if (typeof mounted === 'string') return mounted === '/' ? '' : mounted.replace(/\/$/, '');
  const source: string | undefined = layer.regexp && layer.regexp.source;
  if (!source) return undefined;
  if (layer.regexp.fast_slash || source === '^\\/?(?=\\/|$)') return '';
  const m = /^\^((?:\\\/[\w.~-]+|\\\/(?:\(\?:\(\[\^\\\/\]\+\?\)\)))+)\\\/\?\(\?=\\\/\|\$\)$/.exec(source);
  if (!m) return undefined;
  return m[1].replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param').replace(/\\\//g, '/');
}

/** Every method + path an Express app (4 or 5) defines, nested routers included */
export function expressRoutes(app: any): DiscoveredRoute[] {
  const out: DiscoveredRoute[] = [];
  let router: any;
  try {
    router = app._router; // Express 4 (app.router throws there)
  } catch {
    router = undefined;
  }
  if (!router) {
    try {
      router = app.router; // Express 5
    } catch {
      router = undefined;
    }
  }
  const walk = (stack: any[], prefix: string, depth: number) => {
    if (!Array.isArray(stack) || depth > 8) return;
    for (const layer of stack) {
      if (layer.route && typeof layer.route.path === 'string') {
        const methods = Object.keys(layer.route.methods || {}).filter(m => m !== '_all' && layer.route.methods[m]);
        for (const method of methods) out.push({ method: method.toUpperCase(), path: `${prefix}${layer.route.path}` || '/' });
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        const at = prefixOf(layer);
        if (at !== undefined) walk(layer.handle.stack, `${prefix}${at}`, depth + 1);
      }
    }
  };
  if (router && Array.isArray(router.stack)) walk(router.stack, '', 0);
  return out;
}

/** The routes of the app behind an HTTP server: Express from its request listener, plus any Fastify reported */
export function serverRoutes(server: any): DiscoveredRoute[] {
  const out: DiscoveredRoute[] = [];
  const listeners = server && typeof server.listeners === 'function' ? server.listeners('request') : [];
  for (const listener of listeners) {
    if (typeof listener === 'function' && (listener._router || typeof listener.handle === 'function')) {
      try {
        out.push(...expressRoutes(listener));
      } catch {
        // not Express after all
      }
    }
  }
  out.push(...routeSink());
  const seen = new Set<string>();
  return out.filter(r => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Paths to send GET traffic to: routes without parameters, plus parameter
 * routes filled from `params` ({ id: '1' }). The rest are returned as skipped.
 */
export function pathsToProbe(routes: DiscoveredRoute[], params: Record<string, string> = {}, ignore?: RegExp): { paths: string[]; skipped: string[] } {
  const paths: string[] = [];
  const skipped: string[] = [];
  for (const r of routes) {
    if (r.method !== 'GET') continue;
    if (/[*(]/.test(r.path) || (ignore && ignore.test(r.path))) {
      skipped.push(r.path);
      continue;
    }
    let missing = false;
    const path = r.path.replace(/:(\w+)\??/g, (_, name: string) => {
      if (params[name] !== undefined) return encodeURIComponent(params[name]);
      missing = true;
      return `:${name}`;
    });
    if (missing) skipped.push(r.path);
    else if (!paths.includes(path)) paths.push(path);
  }
  return { paths, skipped };
}

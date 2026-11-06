/**
 * Zero-code instrumentation: incoming HTTP requests, outgoing http/fetch and
 * the database clients the application depends on.
 *
 *   const { uninstall, instrumented } = autoInstrument(tp);
 *
 * or without touching the code (see register.ts):
 *
 *   node --require traceperf/auto app.js      # CommonJS or ESM apps
 *   node --import traceperf/auto app.mjs      # Node >= 18.19 / 20.6
 */
import type { OptimizedPerformanceMonitor } from './core/optimized-performance-monitor';
import { loadNodeBuiltin } from './core/env';
import { HttpServerInstrumentOptions, instrumentFetch, instrumentHttp, instrumentHttpServer, Uninstall } from './instrument';
import { instrumentBetterSqlite3, instrumentMongo, instrumentMysql2, instrumentPg, instrumentPrisma, instrumentRedis } from './drivers';

export type AutoTarget = 'server' | 'http' | 'fetch' | 'pg' | 'mysql2' | 'mongodb' | 'ioredis' | 'prisma' | 'better-sqlite3';

export const AUTO_TARGETS: AutoTarget[] = ['server', 'http', 'fetch', 'pg', 'mysql2', 'mongodb', 'ioredis', 'prisma', 'better-sqlite3'];

export interface AutoInstrumentOptions {
  /** Targets to skip, e.g. ['http'] */
  disable?: AutoTarget[];
  /** Directory whose package.json lists the app's dependencies (default process.cwd()) */
  cwd?: string;
  /** Options for incoming-request tracking (labels, ignored paths, error status) */
  server?: HttpServerInstrumentOptions;
}

export interface AutoInstrumentResult {
  /** What was instrumented, e.g. ['server', 'http', 'fetch', 'pg'] */
  instrumented: AutoTarget[];
  /** Remove every patch */
  uninstall: Uninstall;
}

/** Dependencies declared by the nearest package.json at or above `dir` */
function declaredDependencies(dir: string): { names: Set<string>; dir: string } | undefined {
  const fs = loadNodeBuiltin('fs');
  const path = loadNodeBuiltin('path');
  if (!fs || !path) return undefined;
  let current = path.resolve(dir);
  for (;;) {
    const file = path.join(current, 'package.json');
    if (fs.existsSync(file)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
        const names = new Set<string>(Object.keys({
          ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies,
        }));
        return { names, dir: current };
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function autoInstrument(tp: OptimizedPerformanceMonitor, options: AutoInstrumentOptions = {}): AutoInstrumentResult {
  const disabled = new Set(options.disable ?? []);
  const instrumented: AutoTarget[] = [];
  const restores: Uninstall[] = [];
  const add = (target: AutoTarget, install: () => Uninstall | undefined) => {
    if (disabled.has(target)) return;
    try {
      const restore = install();
      if (restore) {
        restores.push(restore);
        instrumented.push(target);
      }
    } catch {
      // A client that cannot be loaded or patched is skipped, never fatal
    }
  };

  const hasHttp = !!loadNodeBuiltin('http');
  if (hasHttp) add('server', () => instrumentHttpServer(tp, options.server));
  if (hasHttp) add('http', () => instrumentHttp(tp));
  if (typeof (globalThis as any).fetch === 'function') add('fetch', () => instrumentFetch(tp));

  // Database clients: only those the app itself depends on, loaded from the
  // app's node_modules so the patched module is the one the app gets. They
  // are CommonJS packages, so `import pg from 'pg'` returns the same object.
  const moduleApi = loadNodeBuiltin('module');
  const path = loadNodeBuiltin('path');
  const deps = moduleApi && path && typeof moduleApi.createRequire === 'function'
    ? declaredDependencies(options.cwd ?? process.cwd())
    : undefined;
  if (deps) {
    const appRequire = moduleApi.createRequire(path.join(deps.dir, 'package.json'));
    const load = (name: string) => appRequire(name);
    if (deps.names.has('pg')) add('pg', () => instrumentPg(tp, load('pg')));
    if (deps.names.has('mysql2')) add('mysql2', () => instrumentMysql2(tp, load('mysql2')));
    if (deps.names.has('better-sqlite3')) add('better-sqlite3', () => instrumentBetterSqlite3(tp, load('better-sqlite3')));
    if (deps.names.has('@prisma/client')) add('prisma', () => {
      // Prisma 4/5 need the module; 6+ use the tracing hook (and Prisma 7's module may not load on its own)
      let mod: unknown;
      try {
        mod = load('@prisma/client');
      } catch {
        mod = undefined;
      }
      return instrumentPrisma(tp, mod);
    });
    if (deps.names.has('ioredis')) add('ioredis', () => instrumentRedis(tp, load('ioredis')));
    if (deps.names.has('mongodb')) add('mongodb', () => instrumentMongo(tp, load('mongodb')));
    else if (deps.names.has('mongoose')) {
      // Mongoose's own copy of the driver, without loading Mongoose itself
      add('mongodb', () => {
        const fromMongoose = moduleApi.createRequire(appRequire.resolve('mongoose'));
        return instrumentMongo(tp, fromMongoose('mongodb'));
      });
    }
  }

  return { instrumented, uninstall: () => restores.splice(0).reverse().forEach(r => r()) };
}

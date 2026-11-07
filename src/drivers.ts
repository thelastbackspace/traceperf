/**
 * Ready-made instrumentation for popular database and cloud clients.
 *
 * Each helper takes the library module (or client) you already import, so
 * traceperf has no dependency on any of them, patches it in place, is
 * idempotent, and returns an uninstall function.
 */
import type { OptimizedPerformanceMonitor, Span } from './core/optimized-performance-monitor';
import type { TrackOptions } from './types/options';
import type { Uninstall } from './instrument';

const PATCHED = Symbol.for('traceperf.instrumented');

export type DriverOptions = Omit<TrackOptions, 'label'>;

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as any).then === 'function';

const isCommandObject = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && !(value instanceof Promise) &&
  typeof (value as any).once === 'function' && typeof (value as any).on === 'function' &&
  typeof (value as any).emit === 'function';

/**
 * Run one driver call as a tracked span, whether it reports completion via
 * a callback (last argument), a returned promise, or synchronously.
 */
function trackCall(
  tp: OptimizedPerformanceMonitor,
  label: string,
  options: DriverOptions,
  thisArg: unknown,
  original: Function,
  args: unknown[],
  callbackIndex: number = args.length - 1
): unknown {
  const span: Span = tp.start(label, options);
  let ended = false;
  const end = (error?: unknown) => {
    if (ended) return;
    ended = true;
    span.end(error);
  };
  const cb = callbackIndex >= 0 ? args[callbackIndex] : undefined;
  if (typeof cb === 'function') {
    const wrappedArgs = args.slice();
    wrappedArgs[callbackIndex] = function (this: unknown, error: unknown, ...rest: unknown[]) {
      end(error || undefined);
      return (cb as Function).call(this, error, ...rest);
    };
    try {
      return span.run(() => original.apply(thisArg, wrappedArgs));
    } catch (error) {
      end(error);
      throw error;
    }
  }
  let result: unknown;
  try {
    result = span.run(() => original.apply(thisArg, args));
  } catch (error) {
    end(error);
    throw error;
  }
  // Command objects (mysql2 Query, pg Query) are event emitters; some, like
  // mysql2's, have a .then() that throws. Finish on their completion
  // callback or 'end' event instead of treating them as promises.
  if (isCommandObject(result)) {
    const command = result as any;
    if (typeof command.onResult === 'function') {
      const onResult = command.onResult;
      command.onResult = function (this: unknown, error: unknown, ...rest: unknown[]) {
        end(error || undefined);
        return onResult.call(this, error, ...rest);
      };
    }
    command.once('end', () => end());
    return result;
  }
  if (isPromiseLike(result)) {
    result.then(() => end(), error => end(error));
    return result;
  }
  end();
  return result;
}

function patchMethod(target: any, name: string, makePatched: (original: Function) => Function, restores: Uninstall[]): void {
  if (!target) return;
  const original = target[name];
  if (typeof original !== 'function' || original[PATCHED]) return;
  const patched = makePatched(original);
  Object.defineProperty(patched, 'name', { value: original.name, configurable: true });
  Object.defineProperty(patched, 'length', { value: original.length, configurable: true });
  (patched as any)[PATCHED] = original;
  const hadOwn = Object.prototype.hasOwnProperty.call(target, name);
  target[name] = patched;
  restores.push(() => {
    if (target[name] !== patched) return;
    if (hadOwn) target[name] = original;
    else delete target[name];
  });
}

/**
 * "SELECT users", "INSERT orders", "UPDATE accounts", "BEGIN": the SQL verb
 * and the first table it touches, without values (labels stay low-cardinality).
 */
export function sqlLabel(sql: unknown): string {
  const text = typeof sql === 'string' ? sql : sql && typeof (sql as any).text === 'string' ? (sql as any).text
    : sql && typeof (sql as any).sql === 'string' ? (sql as any).sql : '';
  const cleaned = text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').trim();
  const verb = (cleaned.split(/\s+/)[0] || 'query').toUpperCase();
  // users, public.accounts, "public"."Post", `shop`.`orders`
  const table = /\b(?:from|into|update|join|table(?:\s+if(?:\s+not)?\s+exists)?)\s+((?:"[^"]+"|`[^`]+`|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))*)/i.exec(cleaned);
  return table ? `${verb} ${table[1].replace(/["`]/g, '')}` : verb;
}

/**
 * node-postgres: tracks every query ("pg SELECT users"), including those
 * made through Pool.query (it delegates to Client.query).
 *
 *   instrumentPg(tp, require('pg'));
 */
export function instrumentPg(tp: OptimizedPerformanceMonitor, pg: any, options: DriverOptions = {}): Uninstall {
  const restores: Uninstall[] = [];
  patchMethod(pg && pg.Client && pg.Client.prototype, 'query', original => function (this: unknown, ...args: unknown[]) {
    return trackCall(tp, `pg ${sqlLabel(args[0])}`, options, this, original, args);
  }, restores);
  return () => restores.forEach(r => r());
}

/**
 * mysql2 (callback and promise APIs, connections and pools):
 *
 *   instrumentMysql2(tp, require('mysql2'));
 */
export function instrumentMysql2(tp: OptimizedPerformanceMonitor, mysql2: any, options: DriverOptions = {}): Uninstall {
  const restores: Uninstall[] = [];
  const proto = mysql2 && mysql2.Connection && mysql2.Connection.prototype;
  for (const method of ['query', 'execute']) {
    patchMethod(proto, method, original => function (this: unknown, ...args: unknown[]) {
      return trackCall(tp, `mysql ${sqlLabel(args[0])}`, options, this, original, args);
    }, restores);
  }
  return () => restores.forEach(r => r());
}

/**
 * mysql (the classic driver, e.g. under TypeORM or Knex): every query,
 * "mysql SELECT users", for connections and pools (pools use connection.query).
 *
 *   instrumentMysql(tp, require('mysql'));
 */
export function instrumentMysql(tp: OptimizedPerformanceMonitor, mysql: any, options: DriverOptions = {}): Uninstall {
  const restores: Uninstall[] = [];
  let proto: any;
  try {
    // The Connection class is not exported; an unconnected connection shows its prototype
    proto = mysql && typeof mysql.createConnection === 'function' && Object.getPrototypeOf(mysql.createConnection({}));
  } catch {
    proto = undefined;
  }
  const POOLED = Symbol.for('traceperf.mysql.pooled');
  patchMethod(proto, 'query', original => function (this: unknown, ...args: unknown[]) {
    // pool.query hands its own Query object to a connection: tracked by the pool patch
    const first = args[0] as any;
    if (first && typeof first === 'object' && first[POOLED]) return original.apply(this, args);
    return trackCall(tp, `mysql ${sqlLabel(first)}`, options, this, original, args);
  }, restores);
  let poolProto: any;
  try {
    poolProto = typeof mysql.createPool === 'function' && Object.getPrototypeOf(mysql.createPool({}));
  } catch {
    poolProto = undefined;
  }
  // Pools: includes waiting for a free connection, and failures to get one
  patchMethod(poolProto, 'query', original => function (this: unknown, ...args: unknown[]) {
    const result: any = trackCall(tp, `mysql ${sqlLabel(args[0])}`, options, this, original, args);
    if (result && typeof result === 'object') result[POOLED] = true;
    return result;
  }, restores);
  return () => restores.forEach(r => r());
}

const MONGO_COLLECTION_METHODS = [
  'insertOne', 'insertMany', 'findOne', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
  'countDocuments', 'estimatedDocumentCount', 'distinct', 'findOneAndUpdate', 'findOneAndDelete',
  'findOneAndReplace', 'bulkWrite', 'createIndex',
];

/**
 * MongoDB Node driver, and therefore Mongoose: "mongo insertOne users",
 * "mongo find users" (cursor reads are tracked when the results are fetched).
 *
 *   instrumentMongo(tp, require('mongodb'));
 *   instrumentMongo(tp, require('mongoose').mongo);   // Mongoose's bundled driver
 */
export function instrumentMongo(tp: OptimizedPerformanceMonitor, mongodb: any, options: DriverOptions = {}): Uninstall {
  const restores: Uninstall[] = [];
  const collection = mongodb && mongodb.Collection && mongodb.Collection.prototype;
  for (const method of MONGO_COLLECTION_METHODS) {
    patchMethod(collection, method, original => function (this: any, ...args: unknown[]) {
      // Driver 4+ is promise-only; 3.x (Mongoose 5) takes a trailing callback. Filters are never functions.
      const cb = typeof args[args.length - 1] === 'function' ? args.length - 1 : -1;
      return trackCall(tp, `mongo ${method} ${this && this.collectionName}`, options, this, original, args, cb);
    }, restores);
  }
  const cursorName = (cursor: any): string => {
    // Driver 3.x aggregation cursors run on "db.$cmd"; the collection is the operation's target
    const target = cursor && cursor.operation && cursor.operation.target;
    if (typeof target === 'string') return target;
    const ns = cursor && cursor.namespace;
    if (ns && (ns.collection || ns.coll)) return ns.collection || ns.coll;
    // Driver 3.x: "db.collection"
    const s = cursor && typeof cursor.ns === 'string' ? cursor.ns : '';
    return s.includes('.') ? s.slice(s.indexOf('.') + 1) : s;
  };
  // FindCursor: driver 4+; Cursor: driver 3.x (Mongoose 5)
  for (const [className, op] of [['FindCursor', 'find'], ['Cursor', 'find'], ['AggregationCursor', 'aggregate']] as const) {
    const proto = mongodb && mongodb[className] && mongodb[className].prototype;
    patchMethod(proto, 'toArray', original => function (this: any, ...args: unknown[]) {
      const cb = typeof args[args.length - 1] === 'function' ? args.length - 1 : -1;
      // Driver 3.x: AggregationCursor inherits Cursor's toArray, so ask the instance
      const Aggregation = mongodb.AggregationCursor;
      const kind = typeof Aggregation === 'function' && this instanceof Aggregation ? 'aggregate' : op;
      return trackCall(tp, `mongo ${kind} ${cursorName(this)}`, options, this, original, args, cb);
    }, restores);
  }
  return () => restores.forEach(r => r());
}

/**
 * ioredis: every command, "redis GET", "redis HSET" (pipelines and
 * transactions show their individual commands).
 *
 *   instrumentRedis(tp, require('ioredis'));
 */
export function instrumentRedis(tp: OptimizedPerformanceMonitor, Redis: any, options: DriverOptions = {}): Uninstall {
  const restores: Uninstall[] = [];
  const RedisClass = Redis && (Redis.default || Redis.Redis || Redis);
  patchMethod(RedisClass && RedisClass.prototype, 'sendCommand', original => function (this: unknown, command: any, ...rest: unknown[]) {
    const name = command && command.name ? String(command.name).toUpperCase() : 'COMMAND';
    return trackCall(tp, `redis ${name}`, options, this, original, [command, ...rest], -1);
  }, restores);
  return () => restores.forEach(r => r());
}

const redisName = (args: unknown): string => {
  const first = Array.isArray(args) ? args[0] : undefined;
  return first !== undefined && first !== null && String(first) ? String(first).toUpperCase() : 'COMMAND';
};

/** The prototype that defines a node-redis client's sendCommand (RedisClient) */
function nodeRedisPrototype(redis: any): any {
  if (!redis || typeof redis.createClient !== 'function') return undefined;
  let client: any;
  try {
    client = redis.createClient();   // not connected: no socket is opened
  } catch {
    return undefined;
  }
  for (let p = Object.getPrototypeOf(client); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    if (Object.prototype.hasOwnProperty.call(p, 'sendCommand')) return p;
  }
  return undefined;
}

/**
 * Track a batch of queued commands (MULTI or pipeline) as one span per
 * command, all ending when the batch replies (they share one round trip).
 */
function trackBatch(tp: OptimizedPerformanceMonitor, options: DriverOptions, commands: unknown, run: () => unknown): unknown {
  const list = Array.isArray(commands) ? commands : [];
  const spans = list.map((c: any) => tp.start(`redis ${redisName(c && c.args)}`, options));
  const end = (error?: unknown) => spans.forEach(s => s.end(error));
  let result: unknown;
  try {
    result = run();
  } catch (error) {
    end(error);
    throw error;
  }
  if (isPromiseLike(result)) result.then(() => end(), error => end(error));
  else end();
  return result;
}

/**
 * node-redis (`redis` / `@redis/client`) 4 and 5: every command, "redis GET",
 * "redis HSET"; MULTI and pipeline commands are tracked individually.
 * (v4 legacyMode clients are not covered.)
 *
 *   instrumentNodeRedis(tp, require('redis'));
 */
export function instrumentNodeRedis(tp: OptimizedPerformanceMonitor, redis: any, options: DriverOptions = {}): Uninstall {
  const restores: Uninstall[] = [];
  const proto = nodeRedisPrototype(redis);
  if (!proto) return () => undefined;
  // v5: every command (and v4: raw client.sendCommand) goes through sendCommand
  patchMethod(proto, 'sendCommand', original => function (this: unknown, args: unknown, opts: any, ...rest: unknown[]) {
    // v4 isolated commands are re-sent on an isolated client: tracked there
    if (opts && opts.isolated) return original.call(this, args, opts, ...rest);
    return trackCall(tp, `redis ${redisName(args)}`, options, this, original, [args, opts, ...rest], -1);
  }, restores);
  // v4: generated commands (client.get, client.GET, client.clientSetName ...)
  // call a privately captured executor, so each command method is wrapped.
  // Their names give the command: CLIENT_SETNAME -> "CLIENT SETNAME".
  if (typeof proto.commandsExecutor === 'function') {
    const names = Object.getOwnPropertyNames(proto);
    const commands = new Map<string, string>();
    for (const n of names) if (/^[A-Z][A-Z0-9_]*$/.test(n)) commands.set(n.replace(/_/g, '').toLowerCase(), n.replace(/_/g, ' '));
    for (const n of names) {
      const command = commands.get(n.replace(/_/g, '').toLowerCase());
      if (!command || command === 'MULTI') continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, n);
      if (!descriptor || typeof descriptor.value !== 'function') continue;
      patchMethod(proto, n, original => function (this: unknown, ...args: unknown[]) {
        return trackCall(tp, `redis ${command}`, options, this, original, args, -1);
      }, restores);
    }
  }
  patchMethod(proto, 'executeScript', original => function (this: unknown, ...args: unknown[]) {
    return trackCall(tp, 'redis EVALSHA', options, this, original, args, -1);
  }, restores);
  patchMethod(proto, 'executeFunction', original => function (this: unknown, ...args: unknown[]) {
    return trackCall(tp, 'redis FCALL', options, this, original, args, -1);
  }, restores);
  // MULTI / pipeline: v4 multiExecutor, v5 _executeMulti and _executePipeline
  for (const method of ['multiExecutor', '_executeMulti', '_executePipeline']) {
    patchMethod(proto, method, original => function (this: unknown, commands: unknown, ...rest: unknown[]) {
      return trackBatch(tp, options, commands, () => original.call(this, commands, ...rest));
    }, restores);
  }
  return () => restores.forEach(r => r());
}

/**
 * AWS SDK v3 clients: "aws S3.GetObject", "aws DynamoDB.Query".
 * Adds a middleware to the given client instance.
 *
 *   instrumentAwsClient(tp, new S3Client({}));
 */
export function instrumentAwsClient(tp: OptimizedPerformanceMonitor, client: any, options: DriverOptions = {}): Uninstall {
  const stack = client && client.middlewareStack;
  if (!stack || typeof stack.add !== 'function') return () => undefined;
  const name = 'traceperfMiddleware';
  if (client[PATCHED]) return () => undefined;
  const service = (context: any) => String((context && context.clientName) || client.constructor?.name || 'AWS').replace(/Client$/, '');
  stack.add((next: (args: unknown) => Promise<unknown>, context: any) => (args: unknown) =>
    tp.track(() => next(args), {
      ...options,
      label: `aws ${service(context)}.${String((context && context.commandName) || 'Command').replace(/Command$/, '')}`,
    }), { step: 'initialize', name, priority: 'high' });
  client[PATCHED] = true;
  return () => {
    stack.remove(name);
    delete client[PATCHED];
  };
}

const PRISMA_KEY = Symbol.for('traceperf.prisma.patched');

/** Prisma 4/5: the client class prototype, whose _request every call goes through */
function prismaLegacyPrototype(mod: any): any {
  const proto = mod && mod.PrismaClient && mod.PrismaClient.prototype;
  const version = mod && mod.Prisma && (mod.Prisma.prismaVersion?.client || mod.Prisma.clientVersion);
  const major = parseInt(String(version || ''), 10);
  return proto && typeof proto._request === 'function' && major > 0 && major < 6 ? proto : undefined;
}

function patchPrismaRequest(tp: OptimizedPerformanceMonitor, proto: any, options: DriverOptions): Uninstall {
  const restores: Uninstall[] = [];
  patchMethod(proto, '_request', original => function (this: unknown, params: any, ...rest: unknown[]) {
    const p = params || {};
    const label = p.model ? `prisma.${p.model}.${p.action}` : `prisma.raw.${p.action || p.clientMethod || 'query'}`;
    return trackCall(tp, label, options, this, original, [params, ...rest], -1);
  }, restores);
  const g = globalThis as any;
  g[PRISMA_KEY] = 1;
  return () => {
    g[PRISMA_KEY] = 0;
    restores.forEach(r => r());
  };
}

/**
 * Prisma Client 5, 6 and 7 (clients generated anywhere, `$extends` and
 * driver adapters included): every model call and raw query,
 * "prisma.User.findMany", "prisma.raw.queryRaw".
 *
 * Prisma 6+ calls its tracing hook (the one @prisma/instrumentation fills
 * for OpenTelemetry) for every operation, so that is used: nothing is
 * patched and Prisma need not be loaded yet; OpenTelemetry keeps working.
 * Older clients only call it with the `tracing` preview feature, so for
 * them pass the module and its client class is patched instead.
 *
 *   instrumentPrisma(tp);                              // Prisma 6, 7
 *   instrumentPrisma(tp, require('@prisma/client'));   // Prisma 4, 5 (works for 6+ too)
 */
export function instrumentPrisma(tp: OptimizedPerformanceMonitor, prisma?: unknown, options: DriverOptions = {}): Uninstall {
  const g = globalThis as any;
  if (g[PRISMA_KEY] > 0) return () => undefined;
  const legacy = prismaLegacyPrototype(prisma);
  if (legacy) return patchPrismaRequest(tp, legacy, options);
  const noop = {
    isEnabled: () => false,
    getTraceParent: () => '00-10-10-00',
    dispatchEngineSpans: () => undefined,
    getActiveContext: () => undefined,
    runInChildSpan: (_o: unknown, fn: () => unknown) => fn(),
  };
  // Prisma reads globalThis[`V${major}_PRISMA_INSTRUMENTATION`] first, then PRISMA_INSTRUMENTATION
  const keys = ['PRISMA_INSTRUMENTATION', ...Object.keys(g).filter(k => /^V\d+_PRISMA_INSTRUMENTATION$/.test(k))];
  const saved = keys.map(k => [k, Object.prototype.hasOwnProperty.call(g, k), g[k]] as const);
  const wrap = (previous: any) => {
    const inner = (previous && previous.helper) || noop;
    return {
      ...previous,
      helper: {
        isEnabled: () => inner.isEnabled(),
        getTraceParent: (ctx?: unknown) => inner.getTraceParent(ctx),
        dispatchEngineSpans: (spans: unknown) => inner.dispatchEngineSpans(spans),
        getActiveContext: () => inner.getActiveContext(),
        runInChildSpan(o: any, fn: () => unknown) {
          const opts = typeof o === 'string' ? { name: o } : o || {};
          if (opts.name !== 'operation') return inner.runInChildSpan(o, fn);
          const a = opts.attributes || {};
          const label = a.model ? `prisma.${a.model}.${a.method}` : `prisma.raw.${a.method || a.name || 'query'}`;
          return trackCall(tp, label, options, undefined, () => inner.runInChildSpan(o, fn), [], -1);
        },
      },
    };
  };
  for (const [k, , value] of saved) g[k] = wrap(value);
  g[PRISMA_KEY] = 1;
  return () => {
    g[PRISMA_KEY] = 0;
    for (const [k, had, value] of saved) {
      if (had) g[k] = value;
      else delete g[k];
    }
  };
}

/**
 * better-sqlite3 (and Drizzle on it): every statement, "sqlite SELECT users".
 * These calls are synchronous, so slow ones show up as blocking.
 *
 *   instrumentBetterSqlite3(tp, require('better-sqlite3'));
 */
export function instrumentBetterSqlite3(tp: OptimizedPerformanceMonitor, Database: any, options: DriverOptions = {}): Uninstall {
  const restores: Uninstall[] = [];
  const proto = Database && Database.prototype;
  const patchStatement = (statement: any) => {
    // The Statement class is not exported: patch its prototype on first prepare()
    const sp = statement && Object.getPrototypeOf(statement);
    for (const method of ['run', 'get', 'all', 'iterate']) {
      patchMethod(sp, method, original => function (this: any, ...args: unknown[]) {
        return trackCall(tp, `sqlite ${sqlLabel(this && this.source)}`, options, this, original, args, -1);
      }, restores);
    }
  };
  patchMethod(proto, 'prepare', original => function (this: unknown, ...args: unknown[]) {
    const statement = original.apply(this, args);
    patchStatement(statement);
    return statement;
  }, restores);
  patchMethod(proto, 'exec', original => function (this: unknown, ...args: unknown[]) {
    return trackCall(tp, `sqlite ${sqlLabel(args[0])}`, options, this, original, args, -1);
  }, restores);
  return () => restores.forEach(r => r());
}

/**
 * `traceperf test`: Jest runs each test file in a sandbox with its own module
 * registry, so the `pg` a test loads is not the copy traceperf/auto patched.
 * This hooks Jest's loader (in its worker processes, where traceperf/auto is
 * preloaded through NODE_OPTIONS) and instruments each driver the sandbox
 * loads. Vitest and node:test load node_modules natively and need nothing.
 */
import type { OptimizedPerformanceMonitor } from './core/optimized-performance-monitor';
import { loadNodeBuiltin } from './core/env';
import { DRIVER_MODULES, instrumentModule } from './auto';

const PACKAGES = [...new Set(DRIVER_MODULES.map(name => name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')))];

/** Find jest-runtime the way the app's jest does (hoisted, or nested under jest's own packages) */
function resolveJestRuntime(moduleApi: any, path: any, cwd: string): string | undefined {
  const chains = [[], ['jest'], ['jest', 'jest-cli'], ['jest', '@jest/core'], ['jest', '@jest/core', 'jest-runner']];
  for (const chain of chains) {
    try {
      let from = path.join(cwd, 'package.json');
      for (const step of chain) from = moduleApi.createRequire(from).resolve(`${step}/package.json`);
      return moduleApi.createRequire(from).resolve('jest-runtime');
    } catch {
      // try the next place
    }
  }
  return undefined;
}

/** Patch Jest's runtime so driver modules loaded inside test sandboxes are tracked. Returns true when Jest was found. */
export function hookJest(tp: OptimizedPerformanceMonitor, cwd: string = process.cwd()): boolean {
  const moduleApi = loadNodeBuiltin('module');
  const path = loadNodeBuiltin('path');
  if (!moduleApi || !path || typeof moduleApi.createRequire !== 'function') return false;
  const file = resolveJestRuntime(moduleApi, path, cwd);
  if (!file) return false;
  let Runtime: any;
  try {
    const mod = moduleApi.createRequire(file)(file);
    Runtime = mod && (mod.default || mod);
  } catch {
    return false;
  }
  const proto = Runtime && Runtime.prototype;
  if (!proto || typeof proto.requireModuleOrMock !== 'function' || proto.requireModuleOrMock.__traceperf) return !!proto;

  // Which driver (if any) a resolved file is the entry point of
  const entries = new Map<string, string | null>();
  const driverOf = (resolved: string): string | null => {
    let hit = entries.get(resolved);
    if (hit !== undefined) return hit;
    hit = null;
    // The innermost node_modules: mongoose's own mongodb is node_modules/mongoose/node_modules/mongodb
    const parts = resolved.replace(/\\/g, '/').split('/node_modules/');
    const rest = parts.length > 1 ? parts[parts.length - 1].split('/') : [];
    const pkg = rest.length ? (rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0]) : undefined;
    if (pkg && PACKAGES.includes(pkg)) {
      try {
        if (moduleApi.createRequire(resolved).resolve(pkg) === resolved) hit = pkg;
      } catch {
        hit = null;
      }
    }
    entries.set(resolved, hit);
    return hit;
  };
  const resolvedPaths = new Map<string, string | null>();
  const done = new WeakSet<object>();
  const original = proto.requireModuleOrMock;
  const patched = function (this: unknown, from: string, moduleName: string) {
    const exports = original.call(this, from, moduleName);
    try {
      if (exports && (typeof exports === 'object' || typeof exports === 'function') && !done.has(exports) && typeof from === 'string' && typeof moduleName === 'string') {
        const key = `${path.dirname(from)}\0${moduleName}`;
        let resolved = resolvedPaths.get(key);
        if (resolved === undefined) {
          try {
            resolved = moduleApi.createRequire(from).resolve(moduleName) as string;
          } catch {
            resolved = null;
          }
          resolvedPaths.set(key, resolved);
        }
        const driver = resolved && path.isAbsolute(resolved) ? driverOf(resolved) : null;
        if (driver) {
          done.add(exports);
          instrumentModule(tp, driver, exports);
        }
      }
    } catch {
      // tracking must never break a test
    }
    return exports;
  };
  (patched as any).__traceperf = true;
  proto.requireModuleOrMock = patched;
  return true;
}

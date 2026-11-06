/**
 * Environment helpers (internal, not part of the public API).
 */

/**
 * Load a Node.js built-in module without a static import, so the package
 * still loads (and bundles) in browsers. Returns undefined outside Node.
 */
const provided: Record<string, any> = {};

/**
 * Hand Node built-ins to loadNodeBuiltin. Node-only entry points (traceperf/auto)
 * import them statically and call this, because the ESM build has no `require`
 * and `process.getBuiltinModule` only exists from Node 20.16 / 22.3.
 */
export const provideNodeBuiltins = (modules: Record<string, any>): void => {
  Object.assign(provided, modules);
};

export const loadNodeBuiltin = (id: string): any => {
  if (provided[id]) return provided[id];
  try {
    const proc: any = typeof process !== 'undefined' ? process : undefined;
    if (!proc || !proc.versions || !proc.versions.node) return undefined;
    if (typeof proc.getBuiltinModule === 'function') {
      return proc.getBuiltinModule(id);
    }
    // Indirect require so browser bundlers don't try to bundle the module
    const req: ((name: string) => any) | undefined = typeof require === 'function' ? require : undefined;
    return req ? req(id) : undefined;
  } catch {
    return undefined;
  }
};


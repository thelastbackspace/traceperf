/**
 * Static imports of the Node built-ins traceperf uses, for Node-only entry
 * points. Imported first by register.ts so that, in the ESM build on Node
 * versions without process.getBuiltinModule, they are available before the
 * default instance is created (AsyncLocalStorage for nesting across await,
 * http/https for request tracking).
 */
import * as asyncHooks from 'async_hooks';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as inspector from 'inspector';
import * as moduleApi from 'module';
import * as path from 'path';
import * as perfHooks from 'perf_hooks';
import * as v8 from 'v8';
import { provideNodeBuiltins } from './core/env';

// `import * as` gives a namespace object in ESM; patching must hit the real
// module objects, which are the namespaces' default export in ESM.
const real = (ns: any) => (ns && ns.default && typeof ns.default === 'object' ? ns.default : ns);

provideNodeBuiltins({
  async_hooks: real(asyncHooks),
  fs: real(fs),
  http: real(http),
  https: real(https),
  inspector: real(inspector),
  module: real(moduleApi),
  path: real(path),
  perf_hooks: real(perfHooks),
  v8: real(v8),
});

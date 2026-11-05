/**
 * Packaging regression tests.
 *
 * These build the real dist/ output and load it the way a user would
 * (require, import, <script> tag) via Node's package self-reference,
 * so they exercise package.json "exports" exactly as an installed copy would.
 */
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const root = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function runNode(args: string[]): string {
  return execFileSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function collectTargets(value: any, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(v => collectTargets(v, out));
  return out;
}

beforeAll(() => {
  execSync('npm run build:all', { cwd: root, stdio: 'ignore' });
}, 180000);

describe('package exports', () => {
  test('every path in the exports map exists after build', () => {
    const missing = collectTargets(pkg.exports).filter(p => !fs.existsSync(path.join(root, p)));
    expect(missing).toEqual([]);
  });

  test('"types" is the first condition wherever it appears', () => {
    const offenders: string[] = [];
    const walk = (node: any, where: string) => {
      if (!node || typeof node !== 'object') return;
      const keys = Object.keys(node);
      if (keys.includes('types') && keys[0] !== 'types') offenders.push(where);
      keys.forEach(k => walk(node[k], `${where}.${k}`));
    };
    walk(pkg.exports, 'exports');
    expect(offenders).toEqual([]);
  });

  test('ESM entry can be imported by Node (default + named exports)', () => {
    const out = runNode([
      '--input-type=module',
      '-e',
      `import tp, { createTracePerf, TrackingMode, OptimizedPerformanceMonitor } from 'traceperf';
       const t = createTracePerf({ silent: true });
       console.log(JSON.stringify({
         def: typeof tp.track,
         create: typeof createTracePerf,
         mode: TrackingMode.BALANCED,
         cls: t instanceof OptimizedPerformanceMonitor,
         value: t.track(() => 42),
       }));`,
    ]);
    expect(JSON.parse(out.trim().split('\n').pop()!)).toEqual({
      def: 'function',
      create: 'function',
      mode: 'balanced',
      cls: true,
      value: 42,
    });
  });

  test('ESM browser entry can be imported by Node', () => {
    const out = runNode([
      '--input-type=module',
      '-e',
      `import logger, { createTracePerf, BrowserLogger } from 'traceperf/browser';
       console.log(JSON.stringify([typeof logger.track, typeof createTracePerf, typeof BrowserLogger]));`,
    ]);
    expect(JSON.parse(out.trim())).toEqual(['function', 'function', 'function']);
  });

  test('ESM output is real ESM: type module scope, explicit extensions, no module.exports', () => {
    const esmPkg = JSON.parse(fs.readFileSync(path.join(root, 'dist/esm/package.json'), 'utf8'));
    expect(esmPkg.type).toBe('module');
    for (const file of ['dist/esm/index.js', 'dist/esm/browser.js', 'dist/esm/core/index.js']) {
      const src = fs.readFileSync(path.join(root, file), 'utf8');
      expect(src).not.toMatch(/module\.exports/);
      expect(src).not.toMatch(/from\s+['"]\.{1,2}\/[^'"]*(?<!\.js)['"]/);
    }
  });

  test('CJS entry exposes every runtime export declared in the type definitions', () => {
    const out = runNode([
      '-e',
      `const tp = require('traceperf');
       const esm = import('traceperf').then(m => {
         const missing = Object.keys(m).filter(k => k !== 'default' && typeof tp[k] === 'undefined');
         console.log(JSON.stringify({ track: typeof tp.track, defaultTrack: typeof tp.default.track, missing }));
       });`,
    ]);
    expect(JSON.parse(out.trim().split('\n').pop()!)).toEqual({
      track: 'function',
      defaultTrack: 'function',
      missing: [],
    });
  });

  test('script-tag bundle defines a TracePerf global', () => {
    const file = path.join(root, 'dist/traceperf.browser.js');
    expect(fs.existsSync(file)).toBe(true);
    const logs: string[] = [];
    const sandbox: Record<string, any> = {
      console: { log: (...a: any[]) => logs.push(a.join(' ')), info() {}, warn() {}, error() {}, debug() {} },
      performance: { now: () => Date.now() },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
    const { createTracePerf, TrackingMode } = sandbox.TracePerf;
    expect(TrackingMode.BALANCED).toBe('balanced');
    const tracker = createTracePerf({ trackingMode: TrackingMode.BALANCED });
    expect(tracker.track(() => 7, { label: 'scriptTag' })).toBe(7);
    expect(logs.join('\n')).toContain('scriptTag');
  });
});

describe('CommonJS default export', () => {
  test('named exports never shadow methods of the default instance', () => {
    const out = runNode([
      '-e',
      `const tp = require('traceperf');
       const { OptimizedPerformanceMonitor } = tp;
       const methods = Object.getOwnPropertyNames(OptimizedPerformanceMonitor.prototype);
       const shadowed = methods.filter(m => Object.prototype.hasOwnProperty.call(tp, m) && m !== 'traced');
       const { traced } = tp;
       class S { m() { return 1; } }
       const d = Object.getOwnPropertyDescriptor(S.prototype, 'm');
       traced()(S.prototype, 'm', d);
       Object.defineProperty(S.prototype, 'm', d);
       tp.setConfig({ silent: true });
       console.log(JSON.stringify({ shadowed, stats: typeof tp.formatStats(), decorated: new S().m(), viaMethod: typeof tp.traced() }));`,
    ]);
    expect(JSON.parse(out.trim().split('\n').pop()!)).toEqual({ shadowed: [], stats: 'string', decorated: 1, viaMethod: 'function' });
  });
});

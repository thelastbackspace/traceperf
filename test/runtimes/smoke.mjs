// Runtime smoke test for non-Node runtimes (Bun, Deno). Run after `npm run build:all`:
//   bun test/runtimes/smoke.mjs
//   deno run --allow-read --allow-env --allow-sys test/runtimes/smoke.mjs
import { createTracePerf, instrumentFetch } from '../../dist/esm/index.js';
import { createTracePerf as createBrowser } from '../../dist/esm/browser.js';

const runtime = typeof Bun !== 'undefined' ? `bun ${Bun.version}`
  : typeof Deno !== 'undefined' ? `deno ${Deno.version.deno}` : `node ${process.version}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failures.push(name); };

const roots = [];
const tp = createTracePerf({ silent: true, onComplete: r => roots.push(r) });
await tp.track(async () => {
  await sleep(5);
  await tp.track(() => sleep(5), { label: 'child' });
}, { label: 'root' });
check('nesting across await', roots.length === 1 && roots[0].children.map(c => c.label).join() === 'child');
check('async timing', roots[0].duration >= 9 && roots[0].syncDuration < roots[0].duration);
check('stats', tp.getStats('child')?.count === 1);

const trace = tp.startTrace();
tp.track(() => 1, { label: 'traced' });
check('chrome trace', trace.stop().traceEvents.some(e => e.name === 'traced'));

const uninstall = instrumentFetch(tp);
check('instrumentFetch installs', typeof globalThis.fetch === 'function');
uninstall();

const logs = [];
const original = console.log;
console.log = (...a) => logs.push(a.join(' '));
createBrowser().track(() => 1, { label: 'browserEntry' });
console.log = original;
check('browser entry', logs.join('\n').includes('browserEntry'));

console.log(`${runtime}: ${failures.length ? `${failures.length} failed` : 'all passed'}`);
if (failures.length) throw new Error(failures.join(', '));

// Cloudflare Workers (workerd) smoke test worker; see test/runtimes/workerd.sh
import { AsyncLocalStorage } from 'node:async_hooks';
import { createTracePerf, instrumentFetch } from './traceperf.bundle.mjs';

export default {
  async fetch() {
    const check = async (opts) => {
      const roots = [];
      const tp = createTracePerf({ silent: true, onComplete: r => roots.push(r), ...opts });
      await tp.track(async () => {
        await scheduler.wait(5);
        await tp.track(() => scheduler.wait(5), { label: 'child' });
      }, { label: 'root' });
      return { trees: roots.map(r => [r.label, r.children.map(c => c.label)]), duration: roots.at(-1).duration };
    };
    const explicit = await check({ asyncLocalStorage: AsyncLocalStorage });
    const auto = await check({});
    const uninstall = instrumentFetch(createTracePerf({ silent: true }));
    uninstall();
    return Response.json({ explicit, auto, fetchPatchable: true });
  },
};

/**
 * `traceperf/auto`: instrument an app without changing its code.
 *
 *   node --require traceperf/auto server.js
 *   node --import traceperf/auto server.mjs
 *   NODE_OPTIONS="--require traceperf/auto" npm start
 *
 * Environment variables (all optional):
 *   TRACEPERF_OUTPUT=calls.jsonl   append every request tree as JSON lines
 *                                  (console trees are then off unless TRACEPERF_SILENT=0)
 *   TRACEPERF_THRESHOLD=50         only print/record calls taking at least 50 ms
 *   TRACEPERF_SAMPLE_RATE=0.1      track 10% of top-level calls
 *   TRACEPERF_SILENT=1             no per-call console trees
 *   TRACEPERF_SUMMARY=0            no stats + explanations on exit (default on)
 *   TRACEPERF_DISABLE=http,fetch   skip targets (server, http, fetch, pg, mysql2, mongodb, ioredis,
 *                                  prisma, better-sqlite3)
 *   TRACEPERF_IGNORE=^/health      regular expression of request paths not to track
 *   TRACEPERF_QUIET=1              no "traceperf: tracking ..." line at startup
 *   TRACEPERF_PROFILE_BLOCKING=1   sample the CPU (V8 profiler) to name the
 *                                  functions that blocked the event loop (a few % CPU)
 *   TRACEPERF_PROFILE_OUTPUT=f     with it, append those profiles as JSON lines
 *   TRACEPERF_ENABLED=0            load nothing
 */
import './node-builtins'; // must stay first: see node-builtins.ts
import tracePerf from './index';
import { AUTO_TARGETS, AutoTarget, autoInstrument } from './auto';
import { blockingRanges, explain, formatFindings } from './core/explain';
import { BlockingProfileEntry, blockingHotspots, profileSlowCalls, SlowCallProfiler } from './core/cpu-profile';
import { jsonLinesExporter } from './core/exporters';
import { loadNodeBuiltin } from './core/env';
import type { ExecutionRecord } from './core/records';

const env: Record<string, string | undefined> = (typeof process !== 'undefined' && process.env) || {};
const flag = (value: string | undefined, fallback: boolean) =>
  value === undefined || value === '' ? fallback : !/^(0|false|no|off)$/i.test(value);
const num = (value: string | undefined) => (value === undefined || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value));
const AUTO_KEY = Symbol.for('traceperf.auto');
const g = globalThis as any;

if (flag(env.TRACEPERF_ENABLED, true) && !g[AUTO_KEY]) {
  g[AUTO_KEY] = true;
  const fs = loadNodeBuiltin('fs');
  const output = env.TRACEPERF_OUTPUT;
  const threshold = num(env.TRACEPERF_THRESHOLD);
  const sampleRate = num(env.TRACEPERF_SAMPLE_RATE);
  tracePerf.setConfig({
    silent: flag(env.TRACEPERF_SILENT, !!output),
    trackMemory: false,
    ...(threshold !== undefined ? { threshold } : {}),
    ...(sampleRate !== undefined ? { sampleRate } : {}),
  });
  if (output && fs) {
    tracePerf.use(jsonLinesExporter(line => fs.appendFileSync(output, line + '\n')));
  }

  // Keep the most recent trees for the exit summary
  const recent: ExecutionRecord[] = [];
  const summary = flag(env.TRACEPERF_SUMMARY, true);
  if (summary) {
    tracePerf.onComplete(root => {
      recent.push(root);
      if (recent.length > 1000) recent.shift();
    });
  }

  // Name the code behind blocking: profile the synchronous part of blocking calls
  const blockingEntries: BlockingProfileEntry[] = [];
  let profiler: SlowCallProfiler | undefined;
  if (flag(env.TRACEPERF_PROFILE_BLOCKING, false)) {
    const profileOutput = env.TRACEPERF_PROFILE_OUTPUT;
    profiler = profileSlowCalls({
      window: 1000,
      mergeInlined: true,
      select: root => blockingRanges(root),
      exclude: /[\\/]traceperf[\\/]dist[\\/]/,
      onProfile: (call, profile) => {
        // Garbage collection during the blocking part counts as a culprit too
        const hotspots = profile.gcMs >= 1
          ? [...profile.hotspots, { functionName: '(garbage collection)', url: '', line: 0, column: 0, selfMs: profile.gcMs }]
          : profile.hotspots;
        if (hotspots.length === 0) return;
        const entry: BlockingProfileEntry = { label: call.label, hotspots };
        if (blockingEntries.length < 5000) blockingEntries.push(entry);
        if (profileOutput && fs) {
          try {
            fs.appendFileSync(profileOutput, JSON.stringify(entry) + '\n');
          } catch {
            // reporting must never break the app
          }
        }
      },
    });
    if (profiler.available) tracePerf.use(profiler);
    else profiler = undefined;
  }

  const disable = (env.TRACEPERF_DISABLE || '').split(',').map(s => s.trim()).filter(Boolean) as AutoTarget[];
  const unknown = disable.filter(t => !AUTO_TARGETS.includes(t));
  if (unknown.length) process.stderr.write(`traceperf: unknown TRACEPERF_DISABLE target(s): ${unknown.join(', ')}\n`);
  let ignore: RegExp | undefined;
  try {
    ignore = env.TRACEPERF_IGNORE ? new RegExp(env.TRACEPERF_IGNORE) : undefined;
  } catch {
    process.stderr.write('traceperf: TRACEPERF_IGNORE is not a valid regular expression; ignoring it\n');
  }
  const { instrumented } = autoInstrument(tracePerf, {
    disable,
    server: ignore ? { ignore: req => ignore!.test(String(req.url || '').split('?')[0]) } : undefined,
  });
  if (!flag(env.TRACEPERF_QUIET, false)) {
    process.stderr.write(`traceperf: tracking ${instrumented.join(', ') || 'nothing'}${output ? ` -> ${output}` : ''}\n`);
  }

  // `traceperf run` learns the app's port from this file
  const readyFile = env.TRACEPERF_READY_FILE;
  const http = readyFile && fs ? loadNodeBuiltin('http') : undefined;
  if (http && readyFile) {
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (this: any, ...a: any[]) {
      this.once('listening', () => {
        const address = this.address();
        if (address && typeof address === 'object' && !fs.existsSync(readyFile)) {
          try {
            fs.writeFileSync(readyFile, String(address.port));
          } catch {
            // the run command will time out and say so
          }
        }
      });
      return listen.apply(this, a);
    };
  }

  let printed = false;
  const printSummary = () => {
    if (printed || !summary) return;
    printed = true;
    const stats = tracePerf.getStats();
    if (Object.keys(stats).length === 0) return;
    const hotspots = blockingEntries.length ? blockingHotspots(blockingEntries, { cwd: process.cwd() }) : undefined;
    process.stderr.write(`\ntraceperf summary\n\n${tracePerf.formatStats()}\n\n${formatFindings(explain(recent, { max: 10, hotspots }))}\n`);
  };
  process.once('exit', printSummary);
  // Ctrl-C / kill: print, then exit as the signal would have, unless the app
  // handles the signal itself (its exit then triggers the 'exit' summary)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const onSignal = () => {
      if (process.listenerCount(signal) > 1) return;
      process.removeListener(signal, onSignal);
      const finish = () => {
        printSummary();
        process.kill(process.pid, signal);
      };
      // Deliver the last profiler window first (bounded, so exit is never stuck)
      if (profiler) {
        const guard = setTimeout(finish, 2000);
        profiler.stop().then(() => { clearTimeout(guard); finish(); }, finish);
      } else finish();
    };
    process.on(signal, onSignal);
  }
}

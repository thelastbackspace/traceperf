/**
 * Plain-English explanations of finished trees: what made a call slow.
 *
 *   const findings = explain(roots);
 *   console.log(formatFindings(findings));
 *
 * Works on records from onComplete / a trace recorder, or on files via
 * `traceperf explain <file>`. Every finding is a heuristic with the numbers
 * that triggered it, so it can be checked against the tree.
 */

/** The fields explain() reads; ExecutionRecord satisfies it */
export interface ExplainNode {
  label: string;
  /** Start time in ms (any clock, consistent within one input) */
  startTime: number;
  duration: number;
  selfDuration: number;
  /** Synchronous part in ms (blocked the event loop); defaults to 0 for async calls */
  syncDuration?: number;
  async?: boolean;
  error?: unknown;
  children: ExplainNode[];
}

/** 'busy' (the process was saturated) comes from traceperf run, which measures the whole process */
export type FindingKind = 'blocked' | 'blocking' | 'sequential' | 'repeated' | 'dominant' | 'error' | 'busy';

export interface Finding {
  kind: FindingKind;
  /** Top-level call the finding is about */
  root: string;
  /** One-sentence explanation */
  message: string;
  /** Estimated milliseconds involved (delay, possible saving, or time taken) */
  ms: number;
  /** For blocking / blocked: the call whose synchronous code blocked */
  call?: string;
  /** What to change, when the cause suggests a concrete fix */
  fix?: string;
  /** Where to look: the time range (same clock as the input) and the calls involved */
  evidence?: FindingEvidence;
}

export interface FindingEvidence {
  start: number;
  end: number;
  labels: string[];
}

const span = (nodes: ExplainNode[], labels: string[]): FindingEvidence => ({
  start: Math.min(...nodes.map(n => n.startTime)),
  end: Math.max(...nodes.map(n => n.startTime + n.duration)),
  labels: [...new Set(labels)],
});

/** Where a blocking call spent its CPU time (from the sampling profiler) */
export interface BlockingHotspot {
  functionName: string;
  /** File and line, e.g. "src/report.js:12" ("" for native code) */
  location: string;
  /** Sampled self time, ms */
  ms: number;
}

export interface ExplainOptions {
  /** Synchronous work at least this long counts as blocking (ms, default 10) */
  blockingMs?: number;
  /** Ignore findings smaller than this (ms, default 5) */
  minMs?: number;
  /** A child taking at least this fraction of its parent is "dominant" (default 0.6) */
  dominantShare?: number;
  /** Same label this many times under one parent is "repeated" (default 5) */
  repeatCount?: number;
  /** Return at most this many findings, largest first (default 20) */
  max?: number;
  /**
   * CPU hotspots per blocking call label, e.g. from profileSlowCalls with
   * blockingRanges(): blocking findings then name the function that ran.
   */
  hotspots?: Record<string, BlockingHotspot[]>;
}

const fmt = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`);
const pct = (part: number, whole: number): string => `${Math.round((part / Math.max(whole, 1e-9)) * 100)}%`;

function syncOf(node: ExplainNode): number {
  if (typeof node.syncDuration === 'number') return node.syncDuration;
  return node.async ? 0 : node.duration;
}

interface Blocker {
  node: ExplainNode;
  label: string;
  root: number;
  start: number;
  end: number;
}

/** Deepest records whose synchronous part is long: the code that actually blocked */
function collectBlockers(node: ExplainNode, rootIndex: number, threshold: number, out: Blocker[]): boolean {
  let childBlocked = 0;
  for (const child of node.children) {
    if (collectBlockers(child, rootIndex, threshold, out)) childBlocked += syncOf(child);
  }
  const sync = syncOf(node);
  // Attribute to this node only the blocking its blocking children do not explain
  if (sync >= threshold && sync - childBlocked >= threshold) {
    out.push({ node, label: node.label, root: rootIndex, start: node.startTime, end: node.startTime + sync });
    return true;
  }
  return childBlocked > 0;
}

/**
 * The calls whose synchronous code blocked the event loop for at least
 * `blockingMs`, deepest first, with the blocking time range (same clock as
 * the records). Pass to profileSlowCalls({ select }) to see what ran.
 */
export function blockingRanges<T extends ExplainNode>(root: T, blockingMs = 10): Array<{ call: T; start: number; end: number }> {
  const out: Blocker[] = [];
  collectBlockers(root, 0, blockingMs, out);
  return out.map(b => ({ call: b.node as T, start: b.start, end: b.end }));
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function walk(node: ExplainNode, visit: (n: ExplainNode) => void): void {
  visit(node);
  node.children.forEach(c => walk(c, visit));
}

export function explain(roots: ExplainNode[], options: ExplainOptions = {}): Finding[] {
  const blockingMs = options.blockingMs ?? 10;
  const minMs = options.minMs ?? 5;
  const dominantShare = options.dominantShare ?? 0.6;
  const repeatCount = options.repeatCount ?? 5;
  const findings: Array<Finding & { group?: string }> = [];

  /** " (in fn, file:line)" / "; mostly fn (file:line) 80%, ..." from profiler samples */
  const culprit = (label: string, short: boolean): string => {
    const all = options.hotspots?.[label] || [];
    const total = all.reduce((sum, h) => sum + h.ms, 0);
    const spots = all.filter(h => h.ms >= 0.05 * total);
    if (spots.length === 0) return '';
    const at = (h: BlockingHotspot) => `${h.functionName}${h.location ? ` (${h.location})` : ''}`;
    if (short) return `, in ${at(spots[0])}`;
    const shown = spots.slice(0, 3).map(h => `${at(h)} ${pct(h.ms, total)}`).join(', ');
    return `; CPU time: ${shown}`;
  };

  const blockers: Blocker[] = [];
  roots.forEach((root, i) => collectBlockers(root, i, blockingMs, blockers));

  // A call that comes first in several different routes is shared middleware
  // (auth loading the user, a session lookup): the handler depends on it,
  // so it is not part of a run that Promise.all could shorten
  const leadsRoutes = new Map<string, Set<string>>();
  for (const root of roots) {
    const first = root.children.filter(k => k.async).sort((a, b) => a.startTime - b.startTime)[0];
    if (!first) continue;
    const set = leadsRoutes.get(first.label) ?? new Set<string>();
    set.add(root.label);
    leadsRoutes.set(first.label, set);
  }
  const middleware = (label: string) => (leadsRoutes.get(label)?.size || 0) >= 2;

  roots.forEach((root, i) => {
    const rootLabel = root.label;
    const rootEnd = root.startTime + root.duration;

    // 1. Delayed by blocking code in other top-level calls
    const byLabel = new Map<string, { ms: number; roots: Set<string>; ranges: Blocker[] }>();
    for (const b of blockers) {
      if (b.root === i) continue;
      const ms = overlap(root.startTime, rootEnd, b.start, b.end);
      if (ms <= 0) continue;
      const entry = byLabel.get(b.label) ?? { ms: 0, roots: new Set<string>(), ranges: [] };
      entry.ms += ms;
      entry.ranges.push(b);
      entry.roots.add(roots[b.root].label);
      byLabel.set(b.label, entry);
    }
    let blockedTotal = 0;
    byLabel.forEach(({ ms, roots: from, ranges }, label) => {
      blockedTotal += ms;
      if (ms < minMs) return;
      const others = [...from].filter(r => r !== label);
      const where = others.length === 0 ? ''
        : ` in ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''}`;
      findings.push({
        kind: 'blocked',
        root: rootLabel,
        ms,
        call: label,
        evidence: {
          start: Math.min(root.startTime, ...ranges.map(r => r.start)),
          end: Math.max(rootEnd, ...ranges.map(r => r.end)),
          labels: [rootLabel, label],
        },
        message: `${rootLabel} waited ~${fmt(ms)} (${pct(ms, root.duration)} of its ${fmt(root.duration)}) while ${label}${where} blocked the event loop${culprit(label, true)}`,
      });
    });

    // 2. Blocking code inside this call
    for (const b of blockers) {
      if (b.root !== i) continue;
      const ms = b.end - b.start;
      if (ms < minMs) continue;
      findings.push({
        kind: 'blocking',
        root: rootLabel,
        ms,
        call: b.label,
        evidence: { start: b.start, end: b.end, labels: [b.label] },
        message: `${b.label} ran ${fmt(ms)} of synchronous code, blocking everything else in the process for that long${culprit(b.label, false)}`,
      });
    }

    walk(root, node => {
      const kids = node.children;
      if (kids.length === 0) return;
      // What a library does inside one call (Prisma's include = two queries) is not the app's to reorder
      if (LIBRARY_CALL.test(node.label)) return;

      // 3. Awaited one after another although they could overlap
      const asyncKids = kids.filter(k => k.async && k.duration >= 1).sort((a, b) => a.startTime - b.startTime);
      let run: ExplainNode[] = [];
      const labelCount = new Map<string, number>();
      for (const k of kids) labelCount.set(k.label, (labelCount.get(k.label) || 0) + 1);
      const flush = () => {
        if (node === root && run.length > 0 && middleware(run[0].label)) run = run.slice(1);
        // A run of one label repeated many times is the N+1 finding below
        const repeated = run.filter(k => (labelCount.get(k.label) || 0) >= repeatCount).length;
        const nPlusOne = repeated > 0 && repeated >= run.length - 1;
        if (run.length >= 2 && !nPlusOne) {
          const total = run.reduce((s, k) => s + k.duration, 0);
          const saving = total - Math.max(...run.map(k => k.duration));
          if (saving >= minMs) {
            const names = run.map(k => k.label);
            const shown = names.length > 4 ? `${names.slice(0, 4).join(', ')}, ...` : names.join(', ');
            findings.push({
              kind: 'sequential',
              root: rootLabel,
              ms: saving,
              group: node.label,
              evidence: span(run, run.map(k => k.label)),
              message: `${node.label} awaited ${run.length} calls one after another (${shown}: ${fmt(total)}); if they are independent, Promise.all could save up to ~${fmt(saving)}`,
            });
          }
        }
        run = [];
      };
      for (const k of asyncKids) {
        const prev = run[run.length - 1];
        // "One after another": starts after the previous one ended (small gap allowed)
        if (prev && k.startTime >= prev.startTime + prev.duration - 0.05) run.push(k);
        else {
          flush();
          run = [k];
        }
      }
      flush();

      // 4. Same call repeated many times (N+1 queries)
      const counts = new Map<string, { n: number; ms: number }>();
      for (const k of kids) {
        const c = counts.get(k.label) ?? { n: 0, ms: 0 };
        c.n++;
        c.ms += k.duration;
        counts.set(k.label, c);
      }
      counts.forEach(({ n, ms }, label) => {
        if (n >= repeatCount && ms >= minMs) {
          findings.push({
            kind: 'repeated',
            root: rootLabel,
            ms,
            evidence: span(kids.filter(k => k.label === label), [label]),
            message: `${node.label} called ${label} ${n} times (${fmt(ms)} total); batching them into one call may help (N+1 pattern)`,
          });
        }
      });
    });

    // 5. One child dominates the top-level call
    for (const k of root.children) {
      // A request that makes one call is always "mostly" that call: only say so when it is slow
      if (root.children.length === 1 && k.duration < 100) continue;
      if (k.duration >= minMs && k.duration >= dominantShare * root.duration) {
        const waited = blockers
          .filter(b => b.root !== i)
          .reduce((sum, b) => sum + overlap(k.startTime, k.startTime + k.duration, b.start, b.end), 0);
        const note = waited >= minMs && waited >= 0.3 * k.duration
          ? `, but ~${fmt(waited)} of that was waiting for blocking code elsewhere`
          : '';
        findings.push({
          kind: 'dominant',
          root: rootLabel,
          ms: k.duration - waited,
          evidence: span([k], [k.label]),
          message: `${k.label} took ${pct(k.duration, root.duration)} of ${rootLabel} (${fmt(k.duration)} of ${fmt(root.duration)})${note}`,
        });
      }
    }
    // Large own time not explained by children or blocking
    const own = root.selfDuration - blockedTotal;
    if (root.children.length > 0 && own >= minMs && own >= dominantShare * root.duration) {
      findings.push({
        kind: 'dominant',
        root: rootLabel,
        ms: own,
        evidence: span([root], [rootLabel]),
        message: `${pct(own, root.duration)} of ${rootLabel} (${fmt(own)}) is outside any tracked call; track the code inside it to see where`,
      });
    }

    // 6. Failures
    walk(root, node => {
      if (node.error === undefined || node.error === null) return;
      // Report each error once, at the deepest record that has it
      if (node.children.some(c => c.error !== undefined && c.error !== null)) return;
      const msg = node.error instanceof Error ? node.error.message : String(node.error);
      findings.push({
        kind: 'error',
        root: rootLabel,
        ms: node.duration,
        evidence: span([node], [node.label]),
        message: `${node === root ? node.label : `${node.label} in ${rootLabel}`} failed after ${fmt(node.duration)}: ${msg}`,
      });
    });
  });

  // Same finding for many identical roots (e.g. 1000 requests): keep the largest, count the rest
  // Blocking by the same function is grouped across top-level calls too
  type Group = Finding & { group?: string; times: number; roots: Set<string>; all: Finding[] };
  const grouped = new Map<string, Group>();
  for (const f of findings) {
    const scope = f.kind === 'blocking' ? '' : f.root;
    // Sequential awaits in one parent are one finding, however the runs split
    const key = f.group !== undefined ? `${f.kind}|${scope}|${f.group}` : `${f.kind}|${scope}|${f.message.replace(/[0-9.]+ ?(ms|s|%)/g, '')}`;
    const g = grouped.get(key);
    if (!g) grouped.set(key, { ...f, times: 1, roots: new Set([f.root]), all: [f] });
    else {
      g.times++;
      g.roots.add(f.root);
      g.all.push(f);
    }
  }
  // Show the typical occurrence (median), not the worst: one cold start
  // should not make every request look slow. Errors keep the first.
  const worstMs = new Map<Group, number>();
  for (const g of grouped.values()) {
    if (g.all.length < 2 || g.kind === 'error') continue;
    const sorted = g.all.slice().sort((a, b) => a.ms - b.ms);
    const typical = sorted[Math.floor((sorted.length - 1) / 2)];
    worstMs.set(g, sorted[sorted.length - 1].ms);
    Object.assign(g, { ms: typical.ms, message: typical.message, evidence: typical.evidence });
  }
  // Median duration per label (all depths): to tell a slow call from one that waited
  const durations = new Map<string, number[]>();
  roots.forEach(r => walk(r, n => {
    const list = durations.get(n.label);
    if (list) list.push(n.duration);
    else durations.set(n.label, [n.duration]);
  }));
  const medians = new Map<string, number>();
  durations.forEach((list, label) => {
    list.sort((a, b) => a - b);
    medians.set(label, list[Math.floor((list.length - 1) / 2)]);
  });
  // How many top-level calls had each label: a finding in 1 of 2000 requests is an outlier
  const rootCount = new Map<string, number>();
  for (const r of roots) rootCount.set(r.label, (rootCount.get(r.label) || 0) + 1);
  const share = new Map<Group, string>();
  for (const [key, g] of grouped) {
    if (g.kind === 'error') continue;
    const total = rootCount.get(g.root) || 0;
    // Blocking counts per root label too; a rare but long block (a 2 s export) is still worth saying
    const scope = g.kind === 'blocking' ? Math.max(...[...g.roots].map(r => rootCount.get(r) || 0)) : total;
    // Under 5% of 20+ requests, or once in 10+: an outlier, not a pattern
    const rare = (g.roots.size === 1 || g.kind === 'blocking') &&
      ((scope >= 20 && g.times / scope < 0.05) || (scope >= 10 && g.times === 1)) &&
      !((g.kind === 'blocking' || g.kind === 'blocked') && g.ms >= 100);
    if (g.ms < minMs || rare) grouped.delete(key);
    else if (g.kind !== 'blocking' && g.roots.size === 1 && total > g.times) share.set(g, `in ${g.times} of ${total} ${g.root}`);
  }
  const order: Record<FindingKind, number> = { error: 0, busy: 1, blocked: 1, blocking: 2, repeated: 3, sequential: 4, dominant: 5 };
  return [...grouped.values()]
    // Failures first: they matter more than timing; then by total time involved
    .sort((a, b) => Number(b.kind === 'error') - Number(a.kind === 'error') || b.ms * b.times - a.ms * a.times || order[a.kind] - order[b.kind])
    .slice(0, options.max ?? 20)
    .map(g => {
      const worst = worstMs.get(g);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, prefer-const
      let { times, roots: seenIn, group, all, ...f } = g;
      const where = [...seenIn];
      const label = where.length > 3 ? `${where.slice(0, 3).join(', ')} and ${where.length - 3} more` : where.join(', ');
      const fix = suggestFix(f, options.hotspots, medians);
      if (fix) f = { ...f, fix };
      if (f.kind === 'blocking') {
        const self = where.length === 1 && where[0] === f.message.split(' ran ')[0];
        const count = times > where.length ? `${times} times${worst !== undefined && worst > f.ms * 1.5 ? `, worst ${fmt(worst)}` : ''}` : '';
        const note = self ? count : [`in ${label}`, count].filter(Boolean).join(', ');
        return { ...f, message: note ? `${f.message} (${note})` : f.message };
      }
      const range = worst !== undefined && worst > f.ms * 1.5 ? `; worst ${fmt(worst)}` : '';
      const seen = share.get(g) || (times > 1 ? `seen ${times} times` : '');
      if (!seen) return f;
      return { ...f, message: `${f.message} (${seen}${times > 1 ? `, typical shown${range}` : ''})` };
    });
}

const SYNC_FIX: Array<[RegExp, string]> = [
  [/pbkdf2Sync|scryptSync/, 'use the async version (crypto.pbkdf2 / crypto.scrypt with a callback or util.promisify): it runs on the thread pool'],
  [/(randomBytes|generateKeyPairSync|hashSync|compareSync)/, 'use the async version of $1 so the work leaves the event loop'],
  [/readFileSync|writeFileSync|readdirSync|statSync|existsSync/, 'use fs.promises instead of the Sync call, or read it once at startup and cache it'],
  [/zlib|gzipSync|inflateSync|deflateSync|brotli/i, 'use the async / streaming zlib API instead of the Sync call'],
  [/JSON\.(stringify|parse)/, 'the payload is large: paginate it, send fewer fields, or stream it (e.g. a streaming JSON encoder)'],
  [/garbage collection/, 'it allocates a lot: reuse objects/buffers and avoid building large temporary arrays or strings'],
];
/** Labels traceperf gives driver / ORM calls */
const LIBRARY_CALL = /^(prisma\.|(pg|mysql|sqlite|mongo|redis|aws) )/;
const SQL = /\b(select|insert|update|delete|pg|mysql|postgres|sql|query|prisma|knex|sequelize|typeorm|drizzle)\b/i;

/** A concrete change for a finding, from its kind, labels and CPU hotspots */
function suggestFix(f: Finding, hotspots?: Record<string, BlockingHotspot[]>, medians?: Map<string, number>): string | undefined {
  const labels = f.evidence?.labels || [];
  switch (f.kind) {
    case 'blocked':
    case 'blocking': {
      const spots = (f.call && hotspots?.[f.call]) || [];
      // Only the top culprit decides: a 10% GC share is not the fix for a hot loop
      for (const h of spots.slice(0, 1)) {
        const name = `${h.functionName} ${h.location}`;
        for (const [re, fix] of SYNC_FIX) {
          const m = name.match(re);
          if (m) return `${h.functionName.split(' → ')[0]}: ${fix.replace('$1', m[1] || '')}`;
        }
      }
      const lib = spots[0] && (/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(spots[0].location) || /^(node):/.exec(spots[0].location));
      if (lib) {
        const where = lib[1] === 'node' ? 'Node.js itself' : `${lib[1].replace(/\\/g, '/')} (library code)`;
        return `the time is inside ${where}, not your own code: if it only shows in the first requests it is warm-up (JIT, first connection); otherwise look at how you call it (payload size, how often)`;
      }
      const at = spots[0] ? `${spots[0].functionName.split(' → ')[0]}${spots[0].location ? ` (${spots[0].location})` : ''}` : f.call;
      return `move the CPU work in ${at} off the request path: a worker_threads Worker (e.g. a pool like piscina), split it into chunks with setImmediate, or cache its result`;
    }
    case 'sequential': {
      const names = labels.slice(0, 3);
      if (!names.every(n => /^[\w.$]+$/.test(n))) return `if they don't depend on each other, start them together with Promise.all instead of awaiting each in turn`;
      return `if they don't depend on each other, start them together: await Promise.all([${names.map(n => `${n}()`).join(', ')}${labels.length > 3 ? ', ...' : ''}])`;
    }
    case 'repeated': {
      const label = labels[0] || '';
      if (/^prisma\./.test(label)) return `load them in one call: include the relation in the parent query (include: { ... }), or findMany({ where: { id: { in: ids } } }) and match results in memory`;
      if (/^sqlite /.test(label)) return `load them in one query: WHERE id IN (...) (in Drizzle: inArray(column, ids), or db.query with: { ... }); then match results in memory`;
      return SQL.test(label)
        ? `load them in one query: WHERE id IN (...) (or = ANY($1) in Postgres), or your ORM's include/join; then match results in memory`
        : `make one batched call instead of one per item (a bulk API, or DataLoader to collect the calls of one tick)`;
    }
    case 'dominant': {
      // Outside tracked code: the message says what to do; waited: the blocking finding has the fix
      if (f.message.includes('outside any tracked call') || f.message.includes('waiting for blocking code')) return undefined;
      // Far slower than the same call usually is: it waited (pool, lock, GC, cold start) rather than worked
      const usual = medians?.get(labels[0] || '');
      if (usual !== undefined && f.ms > 3 * usual && f.ms - usual >= 20) {
        return `${labels[0]} is usually ${fmt(usual)} (median), so the slow ones were waiting, not working: check the connection pool size, locks and GC pauses, or whether it is only the first requests (cold start)`;
      }
      return SQL.test(labels[0] || '')
        ? `check this query's plan (EXPLAIN ANALYZE) and indexes, or cache its result`
        : `that is where the time goes: track or profile inside ${labels[0] || 'it'} next`;
    }
    default:
      return undefined;
  }
}

const ICON: Record<FindingKind, string> = {
  error: '✖', blocked: '⏳', blocking: '🔥', repeated: '🔁', sequential: '⇉', dominant: '●', busy: '🔥',
};

/** Render findings as text, one per line (and the fix, if any, below it) */
export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'No issues found: nothing blocked, repeated, or ran sequentially in a way worth changing.';
  return findings.map(f => `${ICON[f.kind] || '•'} ${f.message}${f.fix ? `\n   fix: ${f.fix}` : ''}`).join('\n');
}

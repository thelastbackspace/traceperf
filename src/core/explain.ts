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

export type FindingKind = 'blocked' | 'blocking' | 'sequential' | 'repeated' | 'dominant' | 'error';

export interface Finding {
  kind: FindingKind;
  /** Top-level call the finding is about */
  root: string;
  /** One-sentence explanation */
  message: string;
  /** Estimated milliseconds involved (delay, possible saving, or time taken) */
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
}

const fmt = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`);
const pct = (part: number, whole: number): string => `${Math.round((part / Math.max(whole, 1e-9)) * 100)}%`;

function syncOf(node: ExplainNode): number {
  if (typeof node.syncDuration === 'number') return node.syncDuration;
  return node.async ? 0 : node.duration;
}

interface Blocker {
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
    out.push({ label: node.label, root: rootIndex, start: node.startTime, end: node.startTime + sync });
    return true;
  }
  return childBlocked > 0;
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
  const findings: Finding[] = [];

  const blockers: Blocker[] = [];
  roots.forEach((root, i) => collectBlockers(root, i, blockingMs, blockers));

  roots.forEach((root, i) => {
    const rootLabel = root.label;
    const rootEnd = root.startTime + root.duration;

    // 1. Delayed by blocking code in other top-level calls
    const byLabel = new Map<string, { ms: number; roots: Set<string> }>();
    for (const b of blockers) {
      if (b.root === i) continue;
      const ms = overlap(root.startTime, rootEnd, b.start, b.end);
      if (ms <= 0) continue;
      const entry = byLabel.get(b.label) ?? { ms: 0, roots: new Set<string>() };
      entry.ms += ms;
      entry.roots.add(roots[b.root].label);
      byLabel.set(b.label, entry);
    }
    let blockedTotal = 0;
    byLabel.forEach(({ ms, roots: from }, label) => {
      blockedTotal += ms;
      if (ms < minMs) return;
      const where = [...from].slice(0, 3).join(', ') + (from.size > 3 ? ` and ${from.size - 3} more` : '');
      findings.push({
        kind: 'blocked',
        root: rootLabel,
        ms,
        message: `${rootLabel} waited ~${fmt(ms)} (${pct(ms, root.duration)} of its ${fmt(root.duration)}) while ${label} in ${where} blocked the event loop`,
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
        message: `${b.label} ran ${fmt(ms)} of synchronous code, blocking everything else in the process for that long`,
      });
    }

    walk(root, node => {
      const kids = node.children;
      if (kids.length === 0) return;

      // 3. Awaited one after another although they could overlap
      const asyncKids = kids.filter(k => k.async && k.duration >= 1).sort((a, b) => a.startTime - b.startTime);
      let run: ExplainNode[] = [];
      const flush = () => {
        if (run.length >= 2) {
          const total = run.reduce((s, k) => s + k.duration, 0);
          const saving = total - Math.max(...run.map(k => k.duration));
          if (saving >= minMs) {
            const names = run.map(k => k.label);
            const shown = names.length > 4 ? `${names.slice(0, 4).join(', ')}, ...` : names.join(', ');
            findings.push({
              kind: 'sequential',
              root: rootLabel,
              ms: saving,
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
            message: `${node.label} called ${label} ${n} times (${fmt(ms)} total); batching them into one call may help (N+1 pattern)`,
          });
        }
      });
    });

    // 5. One child dominates the top-level call
    for (const k of root.children) {
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
        message: `${node === root ? node.label : `${node.label} in ${rootLabel}`} failed after ${fmt(node.duration)}: ${msg}`,
      });
    });
  });

  // Same finding for many identical roots (e.g. 1000 requests): keep the largest, count the rest
  // Blocking by the same function is grouped across top-level calls too
  const grouped = new Map<string, Finding & { times: number; roots: Set<string> }>();
  for (const f of findings) {
    const scope = f.kind === 'blocking' ? '' : f.root;
    const key = `${f.kind}|${scope}|${f.message.replace(/[0-9.]+ ?(ms|s|%)/g, '')}`;
    const g = grouped.get(key);
    if (!g) grouped.set(key, { ...f, times: 1, roots: new Set([f.root]) });
    else {
      g.times++;
      g.roots.add(f.root);
      if (f.ms > g.ms) Object.assign(g, { ms: f.ms, message: f.message });
    }
  }
  const order: Record<FindingKind, number> = { error: 0, blocked: 1, blocking: 2, repeated: 3, sequential: 4, dominant: 5 };
  return [...grouped.values()]
    .sort((a, b) => b.ms * b.times - a.ms * a.times || order[a.kind] - order[b.kind])
    .slice(0, options.max ?? 20)
    .map(({ times, roots: seenIn, ...f }) => {
      const where = [...seenIn];
      const label = where.length > 3 ? `${where.slice(0, 3).join(', ')} and ${where.length - 3} more` : where.join(', ');
      if (f.kind === 'blocking') {
        const self = where.length === 1 && where[0] === f.message.split(' ran ')[0];
        const count = times > where.length ? `${times} times` : '';
        const note = self ? count : [`in ${label}`, count].filter(Boolean).join(', ');
        return { ...f, message: note ? `${f.message} (${note})` : f.message };
      }
      return times > 1 ? { ...f, message: `${f.message} (seen ${times} times, worst shown)` } : f;
    });
}

const ICON: Record<FindingKind, string> = {
  error: '✖', blocked: '⏳', blocking: '🔥', repeated: '🔁', sequential: '⇉', dominant: '●',
};

/** Render findings as text, one per line */
export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'No issues found: nothing blocked, repeated, or ran sequentially in a way worth changing.';
  return findings.map(f => `${ICON[f.kind]} ${f.message}`).join('\n');
}

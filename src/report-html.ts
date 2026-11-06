/**
 * Self-contained HTML report: flame chart (one row per nesting level, one
 * band per lane), statistics table and slowest calls. No scripts, no
 * external assets - safe to attach to an issue or open from disk.
 */
import type { Call } from './cli';
import type { LabelStats } from './core/stats';
import type { Finding } from './core/explain';

const ICON: Record<string, string> = { error: '✖', blocked: '⏳', blocking: '🔥', repeated: '🔁', sequential: '⇉', dominant: '●', queued: '⏳', busy: '🔥' };

const esc = (s: unknown): string => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Stable colour per label (same label, same colour across reports) */
function colorFor(label: string, failed: boolean): string {
  if (failed) return '#d73a49';
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  // Hues 40..320 only: red is reserved for errors
  return `hsl(${40 + (h % 280)}, 55%, 58%)`;
}

const ms = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(n < 10 ? 3 : 1)} ms`);

export function renderHtmlReport(calls: Call[], stats: Record<string, LabelStats>, options: { title?: string; top?: number; findings?: Finding[] } = {}): string {
  const title = options.title ?? 'traceperf report';
  const top = options.top ?? 20;
  const width = 1200;
  const rowH = 18;
  const laneGap = 10;
  const axisH = 22;

  const start = calls.length ? Math.min(...calls.map(c => c.start)) : 0;
  const end = calls.length ? Math.max(...calls.map(c => c.start + c.duration)) : 1;
  const span = Math.max(end - start, 0.001);
  const x = (t: number) => ((t - start) / span) * width;

  // Vertical layout: each lane gets (max depth + 1) rows
  const lanes = [...new Set(calls.map(c => c.lane))].sort((a, b) => a - b);
  const laneTop = new Map<number, number>();
  let y = axisH;
  for (const lane of lanes) {
    laneTop.set(lane, y);
    const depth = Math.max(...calls.filter(c => c.lane === lane).map(c => c.depth));
    y += (depth + 1) * rowH + laneGap;
  }
  const height = y;

  const rects = calls.map(c => {
    const rx = x(c.start);
    const rw = Math.max(1, x(c.start + c.duration) - rx);
    const ry = laneTop.get(c.lane)! + c.depth * rowH;
    const tip = `${c.path}\n${ms(c.duration)} (self ${ms(c.selfDuration)})${c.error ? `\nerror: ${c.error}` : ''}`;
    const text = rw > 40
      ? `<text x="${(rx + 4).toFixed(1)}" y="${ry + 13}">${esc(c.label.length * 6.5 > rw - 8 ? `${c.label.slice(0, Math.max(1, Math.floor((rw - 14) / 6.5)))}…` : c.label)}</text>`
      : '';
    return `<g class="call"><title>${esc(tip)}</title><rect x="${rx.toFixed(1)}" y="${ry}" width="${rw.toFixed(1)}" height="${rowH - 2}" rx="2" fill="${colorFor(c.label, !!c.error)}"/>${text}</g>`;
  }).join('\n');

  // Findings: each links to a band over the chart showing its time range
  const findings = options.findings || [];
  const clampX = (t: number) => Math.min(width, Math.max(0, x(t)));
  const bands = findings.map((f, i) => {
    const ev = f.evidence;
    if (!ev || !calls.length || ev.end < start || ev.start > end) return '';
    const bx = clampX(ev.start);
    const bw = Math.max(3, clampX(ev.end) - bx);
    return `<rect id="ev-${i}" class="ev" x="${bx.toFixed(1)}" y="${axisH - 4}" width="${bw.toFixed(1)}" height="${height - axisH + 4}"><title>${esc(`${ev.labels.join(', ')}\n${ms(ev.end - ev.start)}`)}</title></rect>`;
  });
  const findingItems = findings.map((f, i) => {
    const text = `${ICON[f.kind] || '•'} ${esc(f.message)}`;
    const fix = f.fix ? `<div class="fix">fix: ${esc(f.fix)}</div>` : '';
    return bands[i]
      ? `<li><a href="#ev-${i}">${text}</a> <span class="at">at ${esc(ms(f.evidence!.start - start))}, ${esc(f.evidence!.labels.slice(0, 3).join(', '))}</span>${fix}</li>`
      : `<li>${text}${fix}</li>`;
  }).join('\n');
  const findingsSection = findings.length
    ? `<h2>Why it was slow</h2>\n<ol class="findings">\n${findingItems}\n</ol>\n<p class="meta">Click a finding to highlight its time range on the flame chart.</p>`
    : '';

  const ticks = Array.from({ length: 6 }, (_, i) => {
    const tx = (i / 5) * width;
    return `<line x1="${tx}" x2="${tx}" y1="${axisH - 4}" y2="${height}" class="grid"/><text x="${Math.min(tx + 3, width - 60)}" y="14" class="axis">${esc(ms((span * i) / 5))}</text>`;
  }).join('');

  const statRows = Object.keys(stats)
    .sort((a, b) => stats[b].total - stats[a].total)
    .map(label => {
      const s = stats[label];
      return `<tr><td>${esc(label)}</td><td>${s.count}</td><td>${s.errors}</td><td>${s.total.toFixed(1)}</td><td>${s.mean.toFixed(3)}</td><td>${s.p50.toFixed(3)}</td><td>${s.p95.toFixed(3)}</td><td>${s.p99.toFixed(3)}</td><td>${s.max.toFixed(3)}</td><td>${s.selfMean.toFixed(3)}</td></tr>`;
    }).join('\n');

  const slowest = calls.slice().sort((a, b) => b.duration - a.duration).slice(0, top)
    .map(c => `<tr><td>${esc(ms(c.duration))}</td><td>${esc(c.path)}${c.error ? ` <span class="err">✖ ${esc(c.error)}</span>` : ''}</td></tr>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #1f2328; --muted: #656d76; --grid: #d0d7de; --row: #f6f8fa; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --grid: #30363d; --row: #161b22; } }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
  main { max-width: 1240px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; }
  .meta { color: var(--muted); margin: 0 0 16px; }
  .chart { overflow-x: auto; border: 1px solid var(--grid); border-radius: 6px; padding: 8px; }
  svg { display: block; } svg text { font: 11px ui-monospace, monospace; fill: #0d1117; pointer-events: none; }
  svg text.axis { fill: var(--muted); } line.grid { stroke: var(--grid); stroke-width: 1; }
  g.call:hover rect { stroke: var(--fg); stroke-width: 1.5; }
  table { border-collapse: collapse; width: 100%; font: 12px ui-monospace, monospace; }
  th, td { text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; } tbody tr:nth-child(odd) { background: var(--row); }
  .slow td:first-child { width: 1%; } .slow td:last-child, .slow th:last-child { text-align: left; white-space: normal; width: auto; } .err { color: #d73a49; }
  .wrap { overflow-x: auto; }
  ol.findings { padding-left: 20px; margin: 0; } ol.findings li { margin: 4px 0; } ol.findings a { color: inherit; }
  .fix { color: var(--muted); font-size: 13px; } .at { color: var(--muted); font-size: 12px; }
  rect.ev { fill: #f0b400; fill-opacity: 0; stroke: none; pointer-events: none; }
  rect.ev:target { fill-opacity: 0.22; stroke: #f0b400; stroke-width: 2; }
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="meta">${calls.length} calls · ${Object.keys(stats).length} labels · ${lanes.length} lane${lanes.length === 1 ? '' : 's'} · span ${esc(ms(span))}. Hover a bar for details.</p>
${findingsSection}
<h2 id="chart">Flame chart</h2>
<div class="chart"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="flame chart">
${ticks}
${rects}
${bands.join('\n')}
</svg></div>
<h2>Statistics (ms)</h2>
<div class="wrap"><table><thead><tr><th>label</th><th>calls</th><th>errors</th><th>total</th><th>mean</th><th>p50</th><th>p95</th><th>p99</th><th>max</th><th>self mean</th></tr></thead>
<tbody>
${statRows}
</tbody></table></div>
<h2>Slowest ${Math.min(top, calls.length)} calls</h2>
<div class="wrap"><table class="slow"><thead><tr><th>duration</th><th>call</th></tr></thead>
<tbody>
${slowest}
</tbody></table></div>
</main>
</body>
</html>
`;
}

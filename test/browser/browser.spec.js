// @ts-check
const { test, expect } = require('@playwright/test');
const { buildSync } = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const scriptBuild = fs.readFileSync(path.join(root, 'dist/traceperf.browser.js'), 'utf8');

/** Bundle a snippet the way an app bundler would, resolving traceperf from this repo. */
function bundle(source) {
  const result = buildSync({
    stdin: { contents: source, resolveDir: root, loader: 'js' },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

async function collectLogs(page) {
  const logs = [];
  page.on('console', msg => logs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => logs.push({ type: 'pageerror', text: String(err) }));
  await page.setContent('<!doctype html><div id="output"></div>');
  return logs;
}

test('script-tag build: sync, async and nested tracking', async ({ page }) => {
  const logs = await collectLogs(page);
  await page.addScriptTag({ content: scriptBuild });
  const result = await page.evaluate(async () => {
    const { createTracePerf, TrackingMode } = window.TracePerf;
    const tracker = createTracePerf({ trackingMode: TrackingMode.BALANCED });
    const sync = tracker.track(() => {
      document.getElementById('output').textContent = 'Updated';
      return 'sync';
    }, { label: 'updateDOM' });
    const asyncValue = await tracker.track(async () => {
      await new Promise(r => setTimeout(r, 40));
      return 'async';
    }, { label: 'fetchData' });
    const child = tracker.createTrackable(x => x * 2, { label: 'child' });
    const parent = tracker.createTrackable(x => child(x) + 1, { label: 'parent' });
    return { sync, asyncValue, nested: parent(2), dom: document.getElementById('output').textContent };
  });

  expect(result).toEqual({ sync: 'sync', asyncValue: 'async', nested: 5, dom: 'Updated' });
  const text = logs.filter(l => l.type === 'log').map(l => l.text).join('\n');
  expect(text).toContain('updateDOM');
  const ms = Number(/fetchData \(([\d.]+)ms\)/.exec(text)?.[1]);
  expect(ms).toBeGreaterThanOrEqual(35);
  expect(text).toMatch(/→ parent \(.*\n {2}→ child \(/);
  expect(logs.filter(l => l.type === 'pageerror' || l.type === 'warning' || l.type === 'error')).toEqual([]);
});

test('bundled traceperf/browser ESM works in the page', async ({ page }) => {
  const logs = await collectLogs(page);
  await page.addScriptTag({
    content: bundle(`
      import { createTracePerf } from 'traceperf/browser';
      const tracker = createTracePerf({ threshold: 20 });
      tracker.track(() => 1, { label: 'fastOperation' });
      const start = performance.now();
      tracker.track(() => { while (performance.now() - start < 30) {} }, { label: 'slowOperation' });
      window.done = true;
    `),
  });
  await expect.poll(() => page.evaluate(() => window.done)).toBe(true);
  const text = logs.map(l => l.text).join('\n');
  expect(text).toContain('slowOperation');
  expect(text).not.toContain('fastOperation');
});

test('bundled main entry (traceperf) runs in the browser', async ({ page }) => {
  const logs = await collectLogs(page);
  await page.addScriptTag({
    content: bundle(`
      import { createTracePerf } from 'traceperf';
      const tp = createTracePerf();
      const inner = tp.createTrackable(() => 1, { label: 'inner' });
      window.result = tp.track(() => inner() + 1, { label: 'outer' });
    `),
  });
  expect(await page.evaluate(() => window.result)).toBe(2);
  const text = logs.map(l => l.text).join('\n');
  expect(text).toMatch(/└─ outer: .*\n {2}└─ inner: /);
  expect(logs.filter(l => l.type === 'pageerror')).toEqual([]);
});

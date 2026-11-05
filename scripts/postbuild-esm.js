/**
 * Turn the tsc ESM output in dist/esm into ESM that Node can load:
 *  - mark the folder as "type": "module"
 *  - add explicit file extensions to relative import/export specifiers
 *  - strip the CommonJS compatibility block (it must not run in ESM,
 *    and bundlers reject `module.exports` inside ES modules)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const esmDir = path.resolve(__dirname, '..', 'dist', 'esm');
const CJS_BLOCK = /\/\/ <cjs-compat>[\s\S]*?\/\/ <\/cjs-compat>\n?/g;
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g;

function resolveSpecifier(fromFile, spec) {
  if (/\.(m?js|json)$/.test(spec)) return spec;
  const base = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(`${base}.js`)) return `${spec}.js`;
  if (fs.existsSync(path.join(base, 'index.js'))) return `${spec}/index.js`;
  throw new Error(`postbuild-esm: cannot resolve "${spec}" from ${fromFile}`);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(js|d\.ts)$/.test(entry.name)) {
      const src = fs.readFileSync(full, 'utf8');
      const out = src
        .replace(CJS_BLOCK, '')
        .replace(SPECIFIER, (_m, lead, q, spec) => `${lead}${q}${resolveSpecifier(full, spec)}${q}`);
      if (out !== src) fs.writeFileSync(full, out);
    }
  }
}

walk(esmDir);
fs.writeFileSync(path.join(esmDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');

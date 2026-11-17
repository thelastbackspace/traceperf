// Each Prisma major needs its own @prisma/client next to the client it
// generates, so they cannot share ./node_modules under aliases: every
// prisma<N>/ directory is installed on its own, its client generated and
// its SQLite database created from ./schema.prisma. Run by `npm install`
// (postinstall) here; set TRACEPERF_SKIP_PRISMA=1 to skip.
//
// Prisma 7 (prisma7/) has its own schema and prisma.config.ts: it no longer
// ships a query engine, so SQLite goes through @prisma/adapter-better-sqlite3,
// and the client is generated as TypeScript (compat.js loads it with tsx).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.TRACEPERF_SKIP_PRISMA === '1') process.exit(0);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const schema = fs.readFileSync(path.join(__dirname, 'schema.prisma'), 'utf8');

for (const dir of ['prisma5', 'prisma6']) {
  const cwd = path.join(__dirname, dir);
  const run = (cmd, args) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, DATABASE_URL: 'file:./compat.db' } });
  fs.writeFileSync(path.join(cwd, 'schema.prisma'), schema);
  run(npm, [fs.existsSync(path.join(cwd, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund']);
  const prisma = path.join(cwd, 'node_modules', 'prisma', 'build', 'index.js');
  run(process.execPath, [prisma, 'generate', '--schema', 'schema.prisma']);
  fs.rmSync(path.join(cwd, 'compat.db'), { force: true });
  run(process.execPath, [prisma, 'db', 'push', '--skip-generate', '--schema', 'schema.prisma']);
}

{
  const cwd = path.join(__dirname, 'prisma7');
  const run = (cmd, args) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
  run(npm, [fs.existsSync(path.join(cwd, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund']);
  const prisma = path.join(cwd, 'node_modules', 'prisma', 'build', 'index.js');
  run(process.execPath, [prisma, 'generate']);
  fs.rmSync(path.join(cwd, 'compat.db'), { force: true });
  run(process.execPath, [prisma, 'db', 'push']);
}

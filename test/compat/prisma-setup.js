// Each Prisma major needs its own @prisma/client next to the client it
// generates, so they cannot share ./node_modules under aliases: every
// prisma<N>/ directory is installed on its own, its client generated and
// its SQLite database created from ./schema.prisma. Run by `npm install`
// (postinstall) here; set TRACEPERF_SKIP_PRISMA=1 to skip.
//
// Prisma 7 is not included: it no longer ships a query engine, so SQLite
// needs a driver adapter (@prisma/adapter-better-sqlite3), a prisma.config.ts
// and the new TypeScript-only "prisma-client" generator. instrumentPrisma's
// Prisma 7 path (the tracing hook) is covered by the unit tests.
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

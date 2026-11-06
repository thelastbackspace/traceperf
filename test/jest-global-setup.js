/**
 * Build dist/ once before any test file runs. Several test files run the
 * built package in child processes; building from each of them raced when
 * Jest ran them in parallel (a child could load a half-written dist/).
 */
const { execSync } = require('child_process');
const path = require('path');

module.exports = () => {
  if (process.env.TRACEPERF_SKIP_BUILD === '1') return;
  execSync('npm run build:all', { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
};

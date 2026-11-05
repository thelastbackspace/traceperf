// Real-browser tests for the browser builds. Run `npm run build:all` first.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'test/browser',
  timeout: 30000,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

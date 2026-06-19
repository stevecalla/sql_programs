'use strict';
// E2E config for the web UI. Starts the read-only server and runs browser tests that STUB the
// /api/* routes (so no Salesforce or AI is needed). Browsers must be installed once:
//   npm i -D @playwright/test   (already in the repo-root package.json)
//   npx playwright install chromium
// Run:  npx playwright test -c e2e/playwright.config.js
const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  timeout: 30000,
  use: { baseURL: 'http://localhost:8019', headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../../../server_salesforce_email_queue_8019.js',
    url: 'http://localhost:8019/favicon.svg',
    timeout: 30000,
    reuseExistingServer: true,
    env: { EQ_PORT: '8019' }
  }
});

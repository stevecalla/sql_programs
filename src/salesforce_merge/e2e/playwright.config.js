'use strict';
// E2E config for the merge tool UI. Starts the Express server (which serves the BUILT React app)
// and runs browser tests that STUB /api/* — so no DB, Salesforce, or real creds are needed.
//
// One-time setup:
//   npm i -D @playwright/test         (already in the repo-root package.json)
//   npx playwright install chromium
//   npm run salesforce_merge_build    (build web/dist so the server has a UI to serve)
//
// Run:  npm run salesforce_merge_e2e
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 30000,
  use: { baseURL: 'http://localhost:8020', headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../../../server_salesforce_merge_8020.js',
    url: 'http://localhost:8020/api/status',
    timeout: 30000,
    reuseExistingServer: true,
    env: {
      MERGE_PORT: '8020',
      MERGE_ADMIN_USER: 'tester',
      MERGE_ADMIN_PASS: 'pw',
      MERGE_SESSION_SECRET: 'e2e-secret',
    },
  },
});

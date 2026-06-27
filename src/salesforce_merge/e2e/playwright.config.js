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
const crypto = require('node:crypto');

// Random per-run creds for the spawned server — never hardcoded (the browser tests stub /api/*,
// so the values only need to satisfy login_configured()). Keeps secret scanners happy.
const E2E_PASS = crypto.randomBytes(12).toString('hex');
const E2E_SECRET = crypto.randomBytes(24).toString('hex');

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 30000,
  use: { baseURL: 'http://localhost:8021', headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build the web app at the DEFAULT base ('/') first. The e2e serves at :8020 root, so a prior
    // `salesforce_merge_build_proxy` (base /merge/) would 404 its assets and render a blank page
    // (no heading, no login form). Rebuild with salesforce_merge_build_proxy before deploying behind
    // the proxy. reuseExistingServer:false so we always serve THIS freshly-built root dist.
    command: 'npm --prefix ../web run build && node ../../../server_salesforce_merge_8020.js',
    url: 'http://localhost:8021/api/status',
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      MERGE_PORT: '8021',
      MERGE_ADMIN_USER: 'tester',
      MERGE_ADMIN_PASS: E2E_PASS,
      MERGE_SESSION_SECRET: E2E_SECRET,
    },
  },
});

'use strict';
// UI/UX (Playwright) tests for the reporting SPA — a SEPARATE suite from the code-based unit tests.
// Mirrors the merge tool's e2e (src/salesforce_merge/e2e/*): it BUILDS the web app and starts a reporting
// server on a dedicated port with throwaway credentials.
//
// Credentials are generated ONCE and cached in .auth/creds.json (gitignored) — random, never committed
// (GitGuardian-safe), and stable across runs so a reused server and the test always agree on them. No env
// var to manage; DB creds are read from the machine's .env exactly as the app normally does.
//
// One-time:  npm i -D @playwright/test   (already in the repo-root package.json)
//            npx playwright install chromium
// Run:       npm run reporting_e2e            (or reporting_e2e_ui for the interactive runner)
const { defineConfig, devices } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.E2E_PORT || '8099';
const BASE = `http://localhost:${PORT}`;
const AUTH_DIR = path.join(__dirname, '.auth');

// Load cached throwaway creds, or mint + persist them the first time (gitignored, so nothing is committed).
function loadOrCreateCreds() {
  try { return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8')); } catch (e) { /* create below */ }
  const creds = { user: 'e2e-tester', pass: crypto.randomBytes(18).toString('hex'), secret: crypto.randomBytes(24).toString('hex') };
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(path.join(AUTH_DIR, 'creds.json'), JSON.stringify(creds));
  return creds;
}
const CREDS = loadOrCreateCreds();
process.env.E2E_USER = CREDS.user;   // propagate to the test workers (auth.setup.js reads these)
process.env.E2E_PASS = CREDS.pass;

const repoRoot = path.resolve(__dirname, '..', '..', '..');

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, 'report') }]],
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // NOTE: storageState is intentionally NOT set here — a global value would also apply to the setup
    // project, which runs before state.json exists and would fail loading it. It's set per-project below.
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: path.join(AUTH_DIR, 'state.json') },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // Build into an ISOLATED dist-e2e and serve THAT (REPORTING_WEB_DIST) — never touches the production
    // web/dist, so running the suite (even on the prod server) can't clobber the deployed bundle.
    command: 'npm run reporting_build_e2e && node server_reporting_8021.js',
    url: `${BASE}/api/status`,
    reuseExistingServer: true,        // if a server is already on :8099, use it instead of erroring
    cwd: repoRoot,
    timeout: 180000,
    env: {
      REPORTING_PORT: PORT,
      REPORTING_WEB_DIST: path.join(repoRoot, '.reporting_e2e_dist'),
      REPORTING_TEST_USER: CREDS.user,
      REPORTING_TEST_PASS: CREDS.pass,
      REPORTING_SESSION_SECRET: CREDS.secret,
    },
  },
});

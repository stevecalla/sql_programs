// Playwright end-to-end config for race_results_transform.
//
// This is OPT-IN dev tooling — it is NOT part of the dependency-free `node --test`
// suite and is never installed in the locked-down production/server environment.
// Run it on a normal dev machine:
//   cd src/race_results_transform
//   npm run e2e:install     # one-time: installs Playwright + a Chromium binary
//   npm run e2e             # boots the real server and drives a real browser
const { defineConfig } = require('@playwright/test');
const path = require('path');

const PORT = process.env.E2E_PORT || 8018;
const HEADED = process.argv.includes('--headed');
// HEADED_SLOWMO: ms paused between each action in --headed runs, so you can watch.
// Bump this number for a slower run (env E2E_SLOWMO overrides it on bash, but not Windows cmd).
const HEADED_SLOWMO = 1500;
const SERVER = path.join(__dirname, '..', '..', '..', 'server_race_results_transform_8018.js');

module.exports = defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  timeout: 45000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:' + PORT,
    headless: true,
    acceptDownloads: true,
    trace: 'on-first-retry',
    // --no-sandbox so headless Chromium also runs on the Linux server (often as root).
    // slowMo (ms) makes headed runs watchable; 0 = full speed (headless default).
    launchOptions: { args: ['--no-sandbox'], slowMo: Number(process.env.E2E_SLOWMO) || (HEADED ? HEADED_SLOWMO : 0) }
  },
  // Auto-start the actual static host (serves public/ + /src). ngrok is off by
  // default in the server, so this is a clean local listen.
  webServer: {
    command: 'node "' + SERVER + '"',
    url: 'http://localhost:' + PORT,
    env: { PORT: String(PORT) },
    reuseExistingServer: true,
    timeout: 30000
  }
});

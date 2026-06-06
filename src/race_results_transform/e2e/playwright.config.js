// Playwright end-to-end config for race_results_transform.
//
// This is OPT-IN dev tooling — it is NOT part of the dependency-free `node --test`
// suite and is never installed in the locked-down production/server environment.
// Run it on a normal dev machine:
//   cd src/race_results_transform
//   npm run e2e:install     # one-time: Playwright + axe-core + chromium/firefox/webkit
//   npm run e2e             # boots the real server and drives real browsers
//   npm run e2e:chromium    # just chromium (fast); npm run e2e:snap = refresh visual baselines
//
// Projects: the Tier 1/2 specs run on chromium + firefox + webkit. mobile.spec.js
// runs ONLY in the phone-sized "mobile" project; visual.spec.js (screenshot
// baselines) runs ONLY on chromium so we keep a single committed baseline set.
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const PORT = process.env.E2E_PORT || 8018;
const HEADED = process.argv.includes('--headed');
// HEADED_SLOWMO: ms paused between each action in --headed runs, so you can watch.
// Bump this number for a slower run (env E2E_SLOWMO overrides it on bash, but not Windows cmd).
const HEADED_SLOWMO = 1500;
const SLOWMO = Number(process.env.E2E_SLOWMO) || (HEADED ? HEADED_SLOWMO : 0);
const SERVER = path.join(__dirname, '..', '..', '..', 'server_race_results_transform_8018.js');

// --no-sandbox lets Chromium-family browsers run on the Linux server (often as root).
// Firefox/WebKit don't take that arg, so they get a plain launch.
const chromium_launch = { args: ['--no-sandbox'], slowMo: SLOWMO };
const plain_launch = { slowMo: SLOWMO };
// Firefox: disable session restore. Playwright intermittently crashes on context
// teardown with `can't access property "_maybeDontRestoreTabs"` (a bug in Firefox's
// sessionstore that fires AFTER the test body passes). Turning session restore off
// avoids that code path so teardown is clean.
const firefox_launch = { slowMo: SLOWMO, firefoxUserPrefs: {
  'browser.sessionstore.resume_from_crash': false,
  'browser.sessionstore.max_resumed_crashes': 0,
  'browser.sessionstore.interval': 1000000000,
  'toolkit.startup.max_resets': 0
} };

module.exports = defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  timeout: 45000,
  // One retry: a genuine failure fails twice and still surfaces; a flaky browser
  // teardown (see firefox sessionstore note below) passes on the retry.
  retries: 1,
  // Per-assertion timeout. Default is 5s; webkit (the slowest engine) sometimes
  // needs longer to finish the in-browser xlsx parse before #compareCard shows.
  expect: { timeout: 12000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:' + PORT,
    headless: true,
    acceptDownloads: true,
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', testIgnore: /mobile\.spec\.js/,
      use: Object.assign({}, devices['Desktop Chrome'], { launchOptions: chromium_launch }) },
    { name: 'firefox', testIgnore: /(mobile|visual|a11y|metrics_db|metrics_dashboard|metrics_beacon)\.spec\.js/,
      use: Object.assign({}, devices['Desktop Firefox'], { launchOptions: firefox_launch }) },
    { name: 'webkit', testIgnore: /(mobile|visual|a11y|metrics_db|metrics_dashboard|metrics_beacon)\.spec\.js/,
      use: Object.assign({}, devices['Desktop Safari'], { launchOptions: plain_launch }) },
    { name: 'mobile', testMatch: /(mobile|metrics_dashboard)\.spec\.js/,
      use: Object.assign({}, devices['Pixel 5'], { launchOptions: chromium_launch }) }
  ],
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

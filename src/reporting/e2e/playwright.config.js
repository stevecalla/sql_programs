'use strict';
// UI/UX (Playwright) tests for the reporting SPA — a SEPARATE test suite from the code-based unit tests
// (those stay under their own runners; this is browser-driven UX). Mirrors the merge tool's e2e layout
// (src/salesforce_merge/e2e/*).
//
// It drives a real browser against the reporting DEV server (Vite :5174, which proxies /api -> :8021),
// so it exercises the live app exactly as a user does — the point is to catch the render/interaction/
// layout regressions we've been checking by hand. If the dev server isn't already running it is started.
//
// One-time:  npm i -D @playwright/test   (already in the repo-root package.json)
//            npx playwright install chromium
// Auth:      set E2E_USER / E2E_PASS to a valid reporting login (auth.setup.js signs in once; reused).
// Run:       npm run reporting_e2e            (or reporting_e2e_ui for the interactive runner)
const { defineConfig, devices } = require('@playwright/test');
const path = require('node:path');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5174';

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,               // one dev server / one DB — keep it calm
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, 'report') }]],
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    storageState: path.join(__dirname, '.auth', 'state.json'),
    // deck.gl (Flows) needs WebGL; software-render it so headless Chromium can draw it.
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/, use: { storageState: undefined } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
  webServer: {
    command: 'npm run reporting_dev_all',
    url: BASE,
    timeout: 120000,
    reuseExistingServer: true,        // if `npm run reporting_dev_all` is already up, use it
    cwd: path.resolve(__dirname, '..', '..', '..'),   // repo root, where the script is defined
  },
});

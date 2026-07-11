"use strict";
// UI/UX (Playwright) tests for the usat_apps platform — SEPARATE, INDEPENDENT from the node:test unit
// tests. Mirrors src/reporting/e2e exactly: builds the web app into an ISOLATED dist and starts a
// usat_apps server on a dedicated port with throwaway credentials, so nothing here touches
// src/usat_apps/web/dist (the dev/prod bundle) or the real auth store.
//
// Layout: platform specs live in this folder (e2e/*.spec.js); module specs live in a subfolder
// (e2e/participation_maps/*.spec.js). testDir is THIS e2e/ folder — the same structure reporting uses,
// which the Playwright --ui runner lists correctly. (A broad testDir + global testMatch confuses the
// UI's project view, so we avoid it.)
//
// Credentials: generated once, cached in .auth/creds.json (gitignored, GitGuardian-safe). No env var.
// One-time:  npx playwright install chromium
// Run:       npm run usat_apps_e2e      (headless)   /   npm run usat_apps_e2e_ui   (interactive)
const { defineConfig, devices } = require("@playwright/test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.E2E_PORT || "8099";
const BASE = "http://localhost:" + PORT;
const AUTH_DIR = path.join(__dirname, ".auth");

function loadOrCreateCreds() {
  try { return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, "creds.json"), "utf8")); } catch (e) { /* create below */ }
  const creds = { user: "e2e-tester", pass: crypto.randomBytes(18).toString("hex"), secret: crypto.randomBytes(24).toString("hex") };
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(path.join(AUTH_DIR, "creds.json"), JSON.stringify(creds));
  return creds;
}
const CREDS = loadOrCreateCreds();
process.env.E2E_USER = CREDS.user;   // propagate to the setup worker (auth.setup.js reads these)
process.env.E2E_PASS = CREDS.pass;

const repoRoot = path.resolve(__dirname, "..", "..", "..");

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 120000,
  expect: { timeout: 30000 },
  fullyParallel: false,
  workers: 1,   // serialize: the participation COUNT(DISTINCT) queries are heavy; parallel workers contend on the DB and time out
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(__dirname, "report") }]],
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.js/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: path.join(AUTH_DIR, "state.json") },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Build into an ISOLATED dist and serve THAT (USATAPPS_WEB_DIST) — never touches
    // src/usat_apps/web/dist, so running the suite (even on the prod box) can't clobber the bundle.
    command: "npm run usat_apps_build_e2e && node server_usat_apps_8022.js",
    url: BASE + "/api/status",
    reuseExistingServer: true,
    cwd: repoRoot,
    timeout: 180000,
    env: {
      USATAPPS_PORT: PORT,
      USATAPPS_WEB_DIST: path.join(repoRoot, ".usat_apps_e2e_dist"),
      USATAPPS_ADMIN_USER: CREDS.user,
      USATAPPS_ADMIN_PASS: CREDS.pass,
      USATAPPS_SESSION_SECRET: CREDS.secret,
      USATAPPS_DATA_DIR: path.join(AUTH_DIR, "data"),
    },
  },
});

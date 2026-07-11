"use strict";
// One-time sign-in, reused by every spec via storageState. The credentials are the RANDOM per-run values
// playwright.config.js generated and handed to the spawned server — nothing hardcoded, no real password.
// This just reads them back from the env the config set.
const { test: setup, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");

const STATE = path.join(__dirname, ".auth", "state.json");

setup("authenticate", async ({ request }) => {
  setup.setTimeout(120000);  // the cold MySQL warm-up below can be slow on first build
  const user = process.env.E2E_USER;
  const pass = process.env.E2E_PASS;
  if (!user || !pass) {
    throw new Error("E2E credentials missing — run via `npm run usat_apps_e2e` so the config generates them.");
  }
  const res = await request.post("/api/login", { data: { username: user, password: pass } });
  expect(res.ok(), "login with the generated test account should succeed").toBeTruthy();

  // Warm the participation data so specs see LIVE data, not the stale-while-revalidate fallback.
  // force=1 blocks until the MySQL rebuild completes. Best-effort: a brief DB hiccup should not fail
  // setup — specs that need live data will surface it themselves. Uses the just-authenticated session.
  try { await request.get("/api/participation-maps/bootstrap?force=1", { timeout: 100000 }); } catch (e) { /* leave to the specs */ }
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  await request.storageState({ path: STATE });
});

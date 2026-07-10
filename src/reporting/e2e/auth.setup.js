'use strict';
// One-time sign-in, reused by every spec via storageState. The credentials are the RANDOM per-run values
// the config generated and handed to the spawned server (playwright.config.js) — nothing hardcoded, no
// real password. auth.setup.js just reads them back from the env the config set.
const { test: setup, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const STATE = path.join(__dirname, '.auth', 'state.json');

setup('authenticate', async ({ request }) => {
  const user = process.env.E2E_USER;
  const pass = process.env.E2E_PASS;
  if (!user || !pass) {
    throw new Error('E2E credentials missing — run via `npm run reporting_e2e` so the config generates them.');
  }
  const res = await request.post('/api/login', { data: { username: user, password: pass } });
  expect(res.ok(), 'login with the generated test account should succeed').toBeTruthy();
  fs.mkdirSync(path.dirname(STATE), { recursive: true });   // ensure .auth/ exists before writing the session
  await request.storageState({ path: STATE });
});

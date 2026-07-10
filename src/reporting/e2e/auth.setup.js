'use strict';
// One-time sign-in, reused by every spec via storageState (so tests don't each re-login). Uses the real
// /api/login endpoint through the dev proxy — set E2E_USER / E2E_PASS to a valid reporting account.
const { test: setup, expect } = require('@playwright/test');
const path = require('node:path');

const STATE = path.join(__dirname, '.auth', 'state.json');

setup('authenticate', async ({ request }) => {
  const user = process.env.E2E_USER;
  const pass = process.env.E2E_PASS;
  if (!user || !pass) {
    throw new Error('Set E2E_USER and E2E_PASS (a valid reporting login) before running reporting_e2e.');
  }
  const res = await request.post('/api/login', { data: { username: user, password: pass } });
  expect(res.ok(), 'login should succeed — check E2E_USER / E2E_PASS').toBeTruthy();
  await request.storageState({ path: STATE });
});

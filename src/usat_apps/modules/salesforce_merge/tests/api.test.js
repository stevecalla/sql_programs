'use strict';
// API contract tests for the salesforce_merge module. In the platform, merge's own auth/login/admin
// were dropped (the platform owns them), so this suite tests what the MODULE actually guarantees:
// every /api/salesforce-merge/* route is gated by require_panel('merge'). No DB needed — the gate
// resolves before any query. We mount api.mount() on a bare Express app and hit it with fetch.
//   node --test src/usat_apps/modules/salesforce_merge/tests/api.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Isolate the auth data dir BEFORE requiring auth (session secret is resolved/persisted there).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sfmerge-api-'));
process.env.USATAPPS_DATA_DIR = TMP;

const express = require('express');
const api = require('../api');
const session = require('../../../auth/session');
const store = require('../../../auth/auth_store');

// Forge a signed platform session cookie for the authorized-path tests.
function cookieFor(user, role) {
  return session.COOKIE + '=' + session.sign({ user: user, role: role, ts: Date.now() }, store.session_secret());
}

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  api.mount(app);
  await new Promise((resolve) => { server = app.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; resolve(); }); });
});
after(async () => {
  if (server) server.close();
  try { await require('../../../store/db').end(); } catch (e) { /* pool never opened */ }
});

// GET routes the module exposes (POST-only routes would 404 on GET, so we exercise GETs).
const GATED = [
  '/api/salesforce-merge/ping',
  '/api/salesforce-merge/dashboard',
  '/api/salesforce-merge/duplicates',
  '/api/salesforce-merge/cluster',
  '/api/salesforce-merge/merge-queue',
  '/api/salesforce-merge/merge/history',
  '/api/salesforce-merge/merge/progress',
  '/api/salesforce-merge/merge/restore',
  '/api/salesforce-merge/worker/health',
];

test('every domain route is panel-gated: 401 without a session', async () => {
  for (const p of GATED) {
    const r = await fetch(base + p);
    assert.equal(r.status, 401, p + ' should require a session');
  }
});

test('exports are gated too (401 without a session)', async () => {
  for (const p of ['/api/salesforce-merge/duplicates/export', '/api/salesforce-merge/merge/history/export']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 401, p + ' should require a session');
  }
});

test('an admin session passes the merge gate — ping returns ok', async () => {
  const cookie = cookieFor('tester@usat.org', 'admin');
  const r = await fetch(base + '/api/salesforce-merge/ping', { headers: { cookie } });
  assert.equal(r.status, 200, 'authorized ping should be 200');
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.module, 'merge');
});

test('worker/health is reachable with a session (boolean online; false when :8021 is down)', async () => {
  const cookie = cookieFor('tester@usat.org', 'admin');
  const r = await fetch(base + '/api/salesforce-merge/worker/health', { headers: { cookie } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(typeof j.online, 'boolean');
});

'use strict';
// API contract tests for the salesforce_email_queue module: every /api/salesforce-email-queue/* route
// is gated by require_panel('email-queue'). No DB / Salesforce needed — the gate resolves before any
// handler work. Mount api.mount() on a bare Express app and hit it with fetch.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sfeq-api-'));
process.env.USATAPPS_DATA_DIR = TMP;

const express = require('express');
const api = require('../api');
const session = require('../../../auth/session');
const store = require('../../../auth/auth_store');

function cookieFor(user, role) { return session.COOKIE + '=' + session.sign({ user: user, role: role, ts: Date.now() }, store.session_secret()); }

let server, base;
before(async () => {
  const app = express(); app.use(express.json()); api.mount(app);
  await new Promise((resolve) => { server = app.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; resolve(); }); });
});
after(async () => { if (server) server.close(); try { await require('../../../store/db').end(); } catch (e) { /* pool never opened */ } });

const GATED = [
  '/api/salesforce-email-queue/ping',
  '/api/salesforce-email-queue/config',
  '/api/salesforce-email-queue/queues',
  '/api/salesforce-email-queue/statuses',
  '/api/salesforce-email-queue/cases',
  '/api/salesforce-email-queue/status-counts',
  '/api/salesforce-email-queue/thread',
  '/api/salesforce-email-queue/ai/models',
  '/api/salesforce-email-queue/corrections',
  '/api/salesforce-email-queue/context',
];

test('every route is panel-gated: 401 without a session', async () => {
  for (const p of GATED) {
    const r = await fetch(base + p);
    assert.equal(r.status, 401, p + ' should require a session');
  }
});

test('no-SF routes answer 200 with an authorized session', async () => {
  const cookie = cookieFor('skip', 'admin');
  const ping = await fetch(base + '/api/salesforce-email-queue/ping', { headers: { cookie } });
  assert.equal(ping.status, 200);
  assert.equal((await ping.json()).module, 'salesforce_email_queue');
  const cfg = await fetch(base + '/api/salesforce-email-queue/config', { headers: { cookie } });
  assert.equal(cfg.status, 200);
  assert.ok(['prod', 'sandbox'].includes((await cfg.json()).sf_env));
});

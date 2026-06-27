'use strict';
// API integration tests — boots create_app() on an ephemeral port and hits it with fetch.
// No DB needed: status/login/me are DB-free, and the data endpoints are checked only for auth gates.
//   node --test src/salesforce_merge/tests/api.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Ephemeral, randomly-generated test credentials — never hardcoded, so no secret is committed
// (keeps GitGuardian and similar scanners happy). Generated fresh on every run.
const TEST_USER = 'tester';
const TEST_PASS = crypto.randomBytes(12).toString('hex');
process.env.MERGE_ADMIN_USER = TEST_USER;
process.env.MERGE_ADMIN_PASS = TEST_PASS;
process.env.MERGE_SESSION_SECRET = crypto.randomBytes(24).toString('hex');

const { create_app } = require('../../../server_salesforce_merge_8020.js');

let server, base;
before(async () => {
  await new Promise((resolve) => {
    server = create_app().listen(0, () => {
      base = 'http://127.0.0.1:' + server.address().port;
      resolve();
    });
  });
});
after(() => { if (server) server.close(); });

describe('api', () => {
  test('GET /api/status is public and ok', async () => {
    const r = await fetch(base + '/api/status');
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(j.app, 'salesforce_merge');
    assert.equal(j.login_configured, true);
  });

  test('POST /api/login rejects bad credentials (401)', async () => {
    const r = await fetch(base + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'y' }),
    });
    assert.equal(r.status, 401);
  });

  test('login sets a session cookie, then /api/me returns the user', async () => {
    const r = await fetch(base + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
    });
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie');
    assert.ok(cookie && cookie.includes('merge_session='), 'expected a merge_session cookie');

    const me = await fetch(base + '/api/me', { headers: { cookie } });
    const mj = await me.json();
    assert.equal(me.status, 200);
    assert.equal(mj.user, TEST_USER);
    assert.equal(mj.role, 'admin');
  });

  test('GET /api/dashboard is auth-gated (401 without a session)', async () => {
    const r = await fetch(base + '/api/dashboard');
    assert.equal(r.status, 401);
  });

  test('the Phase 1 review endpoints are auth-gated too (401 without a session)', async () => {
    for (const p of ['/api/duplicates', '/api/merge-id', '/api/accounts']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 401, p + ' should require auth');
    }
  });

  test('the export endpoints are auth-gated (401 without a session)', async () => {
    for (const p of ['/api/duplicates/export', '/api/merge-id/export', '/api/accounts/export']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 401, p + ' should require auth');
    }
  });
});

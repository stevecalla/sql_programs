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

// Isolate the file-backed stores to a throwaway temp dir (set before the app/auth modules load).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-api-'));
process.env.MERGE_USERS_FILE = path.join(TMP, 'auth.json');
process.env.MERGE_PANEL_ACCESS_FILE = path.join(TMP, 'panel_access.json');

const { create_app } = require('../../../server_salesforce_merge_8020.js');

// Helper: login and return the session cookie.
async function login(base, username, password) {
  const r = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => ({})) };
}

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

  test('/api/me returns the panel allow-list (admin sees the admin panel)', async () => {
    const { cookie } = await login(base, TEST_USER, TEST_PASS);
    const mj = await (await fetch(base + '/api/me', { headers: { cookie } })).json();
    assert.ok(Array.isArray(mj.panels));
    assert.ok(mj.panels.includes('admin'), 'admin should see the admin panel');
  });
});

describe('admin user management + panel access (admin-gated)', () => {
  let adminCookie;
  before(async () => { adminCookie = (await login(base, TEST_USER, TEST_PASS)).cookie; });

  test('admin routes are 401 without a session', async () => {
    for (const p of ['/api/admin/users', '/api/admin/panel-access']) {
      assert.equal((await fetch(base + p)).status, 401, p);
    }
  });

  test('admin can list users (incl. the .env recovery account)', async () => {
    const j = await (await fetch(base + '/api/admin/users', { headers: { cookie: adminCookie } })).json();
    assert.equal(j.ok, true);
    assert.ok(j.users.some((u) => u.user === TEST_USER && u.source === 'env' && u.removable === false));
  });

  test('admin can add a non-admin user, who is then panel-restricted', async () => {
    const pass = crypto.randomBytes(10).toString('hex');
    // create a 'user' role account, restricted to dashboard + duplicates only
    const add = await fetch(base + '/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ user: 'limited', pass, role: 'user' }),
    });
    assert.equal(add.status, 200);
    await fetch(base + '/api/admin/panel-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ user: 'limited', panels: ['', 'duplicates'] }),
    });

    const { cookie: userCookie } = await login(base, 'limited', pass);
    // me reports the restricted panel set
    const mj = await (await fetch(base + '/api/me', { headers: { cookie: userCookie } })).json();
    assert.deepEqual(mj.panels.sort(), ['', 'duplicates']);
    // allowed panel -> not 403 (may be 500 without a DB, but never a 403 access error)
    assert.notEqual((await fetch(base + '/api/duplicates', { headers: { cookie: userCookie } })).status, 403);
    // disallowed panel -> 403
    assert.equal((await fetch(base + '/api/accounts', { headers: { cookie: userCookie } })).status, 403);
    // admin-only routes -> 403 for a non-admin
    assert.equal((await fetch(base + '/api/admin/users', { headers: { cookie: userCookie } })).status, 403);
  });

  test('admin can set the non-admin default panel set', async () => {
    const r = await fetch(base + '/api/admin/panel-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ default: ['', 'reference'] }),
    });
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.deepEqual(j.access.default, ['', 'reference']);
  });
});

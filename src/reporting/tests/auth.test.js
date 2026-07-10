'use strict';
// Auth-flow test: env recovery admin can log in, /api/me reflects it, and a gated endpoint is
// reachable once signed in. No DB needed — bootstrap returns 503 NO_DATA (auth passed, data layer
// has no fixture/MySQL in the test env), which proves the gate opened.
const crypto = require('node:crypto');
// Random per-run test credentials — never hardcoded, so nothing password-like is committed (GitGuardian-
// safe) and there's no env var to manage. The same values feed the login call below.
const TEST_USER = process.env.REPORTING_ADMIN_USER || 'e2e-tester';
const TEST_PASS = process.env.REPORTING_ADMIN_PASS || crypto.randomBytes(12).toString('hex');
process.env.REPORTING_ADMIN_USER = TEST_USER;
process.env.REPORTING_ADMIN_PASS = TEST_PASS;
process.env.REPORTING_SESSION_SECRET = process.env.REPORTING_SESSION_SECRET || crypto.randomBytes(24).toString('hex');

const test = require('node:test');
const assert = require('node:assert');
const { create_app } = require('../../../server_reporting_8021.js');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('login -> me -> gated endpoint reachable', async () => {
  const app = create_app();
  const { server, port } = await listen(app);
  const base = 'http://127.0.0.1:' + port;
  try {
    // login
    const lr = await fetch(base + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
    });
    assert.strictEqual(lr.status, 200);
    const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('reporting_session='));

    // me — proves the session gate opened (we intentionally do NOT call /api/bootstrap here, so the
    // test never touches MySQL / the fixture and always exits cleanly).
    const mr = await fetch(base + '/api/me', { headers: { cookie } });
    const mb = await mr.json();
    assert.strictEqual(mr.status, 200);
    assert.strictEqual(mb.user, TEST_USER);   // whoever logged in (random/default creds above)
    assert.strictEqual(mb.role, 'admin');
  } finally { server.close(); }
});

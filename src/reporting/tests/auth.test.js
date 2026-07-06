'use strict';
// Auth-flow test: env recovery admin can log in, /api/me reflects it, and a gated endpoint is
// reachable once signed in. No DB needed — bootstrap returns 503 NO_DATA (auth passed, data layer
// has no fixture/MySQL in the test env), which proves the gate opened.
process.env.REPORTING_ADMIN_USER = process.env.REPORTING_ADMIN_USER || 'test_admin';
process.env.REPORTING_ADMIN_PASS = process.env.REPORTING_ADMIN_PASS || 'test_pass';
process.env.REPORTING_SESSION_SECRET = process.env.REPORTING_SESSION_SECRET || 'test_secret_do_not_use_in_prod';

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
      body: JSON.stringify({ username: 'test_admin', password: 'test_pass' }),
    });
    assert.strictEqual(lr.status, 200);
    const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('reporting_session='));

    // me — proves the session gate opened (we intentionally do NOT call /api/bootstrap here, so the
    // test never touches MySQL / the fixture and always exits cleanly).
    const mr = await fetch(base + '/api/me', { headers: { cookie } });
    const mb = await mr.json();
    assert.strictEqual(mr.status, 200);
    assert.strictEqual(mb.user, 'test_admin');
    assert.strictEqual(mb.role, 'admin');
  } finally { server.close(); }
});

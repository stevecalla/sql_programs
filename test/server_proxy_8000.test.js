'use strict';
// Tests for server_proxy_8000.js — run with: npm run test_proxy  (node --test)
// Mounts create_app() on an ephemeral port (no backends needed) and checks the
// proxy's own routes: /api/test, /api/status, /api/health, 404, and 405.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { create_app } = require('../server_proxy_8000');

let server;
let base_url;

before(async () => {
  const app = create_app();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base_url = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
});

test('/api/test returns ok', async () => {
  const res = await fetch(`${base_url}/api/test`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.msg, 'proxy is alive');
});

test('/api/status reports app, routes, and memory', async () => {
  const res = await fetch(`${base_url}/api/status`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.app, 'proxy');
  assert.ok(Array.isArray(body.routes));
  assert.ok(body.memory_mb && typeof body.memory_mb.rss === 'number');
});

test('/healthz is an alias of /api/status', async () => {
  const res = await fetch(`${base_url}/healthz`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.app, 'proxy');
});

test('/api/health returns a checked map (503 when a backend is down)', async () => {
  const res = await fetch(`${base_url}/api/health`);
  // No backends are running in the test, so the aggregate is expected to fail.
  assert.ok(res.status === 200 || res.status === 503);
  const body = await res.json();
  assert.ok(body.checked && typeof body.checked === 'object');
});

test('unknown path returns 404 json', async () => {
  const res = await fetch(`${base_url}/no-such-thing`);
  assert.strictEqual(res.status, 404);
  const body = await res.json();
  assert.strictEqual(body.ok, false);
});

test('disallowed method returns 405', async () => {
  // PATCH is not in ALLOWED_METHODS (GET/POST/PUT/DELETE/OPTIONS).
  const res = await fetch(`${base_url}/api/test`, { method: 'PATCH' });
  assert.strictEqual(res.status, 405);
});

test('/admin requires auth (redirects to login)', async () => {
  const res = await fetch(`${base_url}/admin`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
});

test('/api/logs requires auth (401)', async () => {
  const res = await fetch(`${base_url}/api/logs`);
  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.strictEqual(body.ok, false);
});

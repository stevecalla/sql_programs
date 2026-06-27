'use strict';
// Tests for server_proxy_8000.js — run with: npm run test_proxy
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { create_app } = require('../server_proxy_8000');

let server, base_url;
before(async () => {
  const app = create_app();
  await new Promise((resolve) => { server = app.listen(0, () => { base_url = 'http://127.0.0.1:' + server.address().port; resolve(); }); });
});
after(() => { if (server) server.close(); });

test('/api/test returns ok', async () => {
  const r = await fetch(base_url + '/api/test'); assert.strictEqual(r.status, 200);
  const b = await r.json(); assert.strictEqual(b.ok, true); assert.strictEqual(b.msg, 'proxy is alive');
});
test('/api/status reports app + routes + memory', async () => {
  const r = await fetch(base_url + '/api/status'); assert.strictEqual(r.status, 200);
  const b = await r.json(); assert.strictEqual(b.app, 'proxy'); assert.ok(Array.isArray(b.routes)); assert.ok(b.memory_mb && typeof b.memory_mb.rss === 'number');
});
test('/healthz aliases /api/status', async () => {
  const r = await fetch(base_url + '/healthz'); assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).app, 'proxy');
});
test('/api/health returns a checked map', async () => {
  const r = await fetch(base_url + '/api/health'); assert.ok(r.status === 200 || r.status === 503);
  assert.ok((await r.json()).checked);
});
test('/favicon.svg serves svg', async () => {
  const r = await fetch(base_url + '/favicon.svg'); assert.strictEqual(r.status, 200);
  assert.ok((r.headers.get('content-type') || '').includes('svg'));
});
test('unknown path -> 404 json', async () => {
  const r = await fetch(base_url + '/nope'); assert.strictEqual(r.status, 404); assert.strictEqual((await r.json()).ok, false);
});
test('disallowed method -> 405', async () => {
  const r = await fetch(base_url + '/api/test', { method: 'PATCH' }); assert.strictEqual(r.status, 405);
});
test('/admin requires auth (302)', async () => {
  const r = await fetch(base_url + '/admin', { redirect: 'manual' }); assert.strictEqual(r.status, 302);
});
test('/api/logs requires auth (401)', async () => {
  const r = await fetch(base_url + '/api/logs'); assert.strictEqual(r.status, 401);
});
test('/api/pm2 requires auth (401)', async () => {
  const r = await fetch(base_url + '/api/pm2'); assert.strictEqual(r.status, 401);
});

test('/api/control requires auth (401)', async () => {
  const r = await fetch(base_url + '/api/control/reload-proxy', { method: 'POST' });
  assert.strictEqual(r.status, 401);
});

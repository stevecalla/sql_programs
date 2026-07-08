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
test('disallowed method -> 405', async () => {
  const r = await fetch(base_url + '/api/test', { method: 'PATCH' }); assert.strictEqual(r.status, 405);
});
test('unknown path is forwarded to the / catch-all (usat_apps)', async () => {
  // The management console was retired from the proxy; '/' now routes to usat_apps (:8022).
  // With no backend running in the test harness, the proxy returns 502 (backend unavailable);
  // if usat_apps is up it returns its own 404. Either way it's no longer the proxy's own 404.
  const r = await fetch(base_url + '/nope');
  assert.ok(r.status === 502 || r.status === 404, 'expected forwarded 502/404, got ' + r.status);
});

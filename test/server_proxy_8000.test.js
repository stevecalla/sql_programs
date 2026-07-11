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
  // if usat_apps is up it's a SPA: unknown non-/api paths hit its server-side SPA fallback and
  // return 200 (index.html; the client shows its own 404). Either way it's forwarded, not the proxy's 404.
  const r = await fetch(base_url + '/nope');
  assert.ok(r.status === 200 || r.status === 502, 'expected forwarded 200/502, got ' + r.status);
});

// --- Per-host routing + 404 page (host tag in proxy_routes.js: 'api' = usat-api, 'app' = usat-app) ---
// The gate reads X-Forwarded-Host, so tests set it to simulate each public hostname. Backends aren't
// running here, so a request that PASSES the gate hits the proxy's 502 (backend unavailable).
const APP = 'usat-app.kidderwise.org';
const API = 'usat-api.kidderwise.org';
const xfh = (host, accept) => { const h = { 'x-forwarded-host': host }; if (accept) h.accept = accept; return { headers: h }; };

test('app route (/merge) on the API host -> 404', async () => {
  const r = await fetch(base_url + '/merge', xfh(API)); assert.strictEqual(r.status, 404);
});
test('API route (/events) on the app host -> 404', async () => {
  const r = await fetch(base_url + '/events', xfh(APP)); assert.strictEqual(r.status, 404);
});
test('app route (/merge) on the app host passes the gate (502, backend down in tests)', async () => {
  const r = await fetch(base_url + '/merge', xfh(APP)); assert.strictEqual(r.status, 502);
});
test('API route (/events) on the API host passes the gate (502, backend down in tests)', async () => {
  const r = await fetch(base_url + '/events', xfh(API)); assert.strictEqual(r.status, 502);
});
test('unknown host is rejected on the / front door -> 404', async () => {
  const r = await fetch(base_url + '/', xfh('somewhere-else.example.com')); assert.strictEqual(r.status, 404);
});

test('404 defaults to JSON for API clients', async () => {
  const r = await fetch(base_url + '/merge', xfh(API, 'application/json'));
  assert.strictEqual(r.status, 404);
  assert.ok((r.headers.get('content-type') || '').includes('json'));
  const b = await r.json(); assert.strictEqual(b.ok, false); assert.strictEqual(b.path, '/merge');
});
test('404 returns a styled HTML page when the browser asks for it', async () => {
  const r = await fetch(base_url + '/merge', xfh(API, 'text/html'));
  assert.strictEqual(r.status, 404);
  assert.ok((r.headers.get('content-type') || '').includes('html'));
  const t = await r.text();
  assert.ok(t.includes('404') && t.toLowerCase().includes('not found'), 'HTML body should say 404 / not found');
  assert.ok(t.includes('Go to the app'), 'HTML body should link back to the app');
});

'use strict';
const os = require('os'), path = require('path'), fs = require('fs'), http = require('http');
process.env.EQ_USERS_FILE = path.join(os.tmpdir(), 'eq_routes_users_' + Date.now() + '.json');
process.env.EQ_CORRECTIONS_FILE = path.join(os.tmpdir(), 'eq_routes_corr_' + Date.now() + '.json');
process.env.EQ_CONTEXT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eq_routes_ctx_'));
process.env.EQ_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eq_routes_data_'));   // config.json (admin_landing, ai_models) -> tmp
process.env.SF_EMAIL_QUEUE_ADMIN_USER = 'demo';
process.env.SF_EMAIL_QUEUE_ADMIN_PASS = 'demo';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const mount = require('../web/routes');

let server, base, cookie = '';
function req(method, p, body, ck) {
  return new Promise(function (resolve) {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, ck ? { Cookie: ck } : {}) },
      function (rs) { let d = ''; rs.on('data', function (c) { d += c; }); rs.on('end', function () { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ code: rs.statusCode, headers: rs.headers, json: j }); }); });
    r.on('error', function () { resolve({ code: 0 }); });
    if (data) r.write(data); r.end();
  });
}

before(async function () {
  const app = express(); app.use(express.json()); mount(app);
  await new Promise(function (r) { server = app.listen(0, function () { base = 'http://localhost:' + server.address().port; r(); }); });
});
after(function () { if (server) server.close(); });

test('unauthenticated /api/me is 401', async function () { assert.strictEqual((await req('GET', '/api/me')).code, 401); });
test('bad login is 401', async function () { assert.strictEqual((await req('POST', '/api/login', { user: 'x', pass: 'y' })).code, 401); });
test('good login sets a session cookie', async function () {
  const r = await req('POST', '/api/login', { user: 'demo', pass: 'demo' });
  assert.strictEqual(r.code, 200);
  cookie = (r.headers['set-cookie'] || [''])[0].split(';')[0];
  assert.ok(cookie.indexOf('eq_session=') === 0);
});
test('authenticated /api/me returns the user', async function () {
  const r = await req('GET', '/api/me', null, cookie); assert.strictEqual(r.code, 200); assert.strictEqual(r.json.user, 'demo');
});
test('/api/send is disabled (403)', async function () {
  assert.strictEqual((await req('POST', '/api/send', {}, cookie)).code, 403);
});
test('/api/context lists files (empty to start)', async function () {
  const r = await req('GET', '/api/context?queue=Coaching', null, cookie);
  assert.strictEqual(r.code, 200); assert.ok(Array.isArray(r.json.files));
});
test('corrections can be added and listed via API', async function () {
  const a = await req('POST', '/api/corrections', { note: 'Use a friendly tone', scope: 'global' }, cookie);
  assert.ok(a.json.ok);
  const g = await req('GET', '/api/corrections', null, cookie);
  assert.ok(g.json.corrections.some(function (c) { return c.note === 'Use a friendly tone'; }));
});

test('context file can be uploaded then listed via API', async function () {
  const b64 = Buffer.from('# note\nRecert takes 3 weeks').toString('base64');
  const up = await req('POST', '/api/context', { scope: 'global', queue: 'Coaching', name: 'note.md', content_base64: b64 }, cookie);
  assert.ok(up.json.ok, JSON.stringify(up.json));
  const list = await req('GET', '/api/context?queue=Coaching', null, cookie);
  assert.ok(list.json.files.some(function (x) { return x.name === 'note.md'; }));
});

test('/api/ai/models returns the shared model registry (provider/model/label, one default)', async function () {
  const r = await req('GET', '/api/ai/models', null, cookie);
  assert.strictEqual(r.code, 200);
  assert.ok(Array.isArray(r.json) && r.json.length >= 1);
  r.json.forEach(function (m) { assert.ok(m.provider && m.model && m.label); });
  assert.strictEqual(r.json.filter(function (m) { return m.is_default; }).length, 1);
});

test('/api/admin/config returns admin_landing + the editable ai_models', async function () {
  const r = await req('GET', '/api/admin/config', null, cookie);
  assert.strictEqual(r.code, 200);
  assert.ok(r.json.ok);
  assert.ok(Array.isArray(r.json.choices) && r.json.choices.indexOf('/metrics') >= 0);
  assert.ok(Array.isArray(r.json.ai_models) && r.json.ai_models.length >= 1);
});

test('/api/admin/config saves an edited ai_models list (round-trip)', async function () {
  const models = [
    { provider: 'openai', model: 'gpt-x', label: 'My GPT', is_default: true, price_in: 1.5, price_out: 9 },
    { provider: 'anthropic', model: 'claude-y', label: 'My Claude', price_in: 2, price_out: 8 }
  ];
  const save = await req('POST', '/api/admin/config', { ai_models: models }, cookie);
  assert.strictEqual(save.code, 200);
  assert.ok(save.json.ok);
  const got = save.json.ai_models;
  assert.strictEqual(got.length, 2);
  assert.strictEqual(got[0].model, 'gpt-x');
  assert.strictEqual(got[0].price_in, 1.5);
  assert.strictEqual(got.filter(function (m) { return m.is_default; }).length, 1);
  // and /api/ai/models now reflects the saved list
  const list = await req('GET', '/api/ai/models', null, cookie);
  assert.ok(list.json.some(function (m) { return m.model === 'gpt-x'; }));
});

test('/api/admin/config rejects an empty ai_models list', async function () {
  const r = await req('POST', '/api/admin/config', { ai_models: [] }, cookie);
  assert.strictEqual(r.code, 400);
});

test('show_test_banner round-trips and is exposed on /api/me + config', async function () {
  // default is on (true)
  const cfg0 = await req('GET', '/api/admin/config', null, cookie);
  assert.strictEqual(cfg0.json.show_test_banner, true);
  const me0 = await req('GET', '/api/me', null, cookie);
  assert.strictEqual(me0.json.show_test_banner, true);
  // turn it off
  const off = await req('POST', '/api/admin/config', { show_test_banner: false }, cookie);
  assert.strictEqual(off.code, 200);
  assert.strictEqual(off.json.show_test_banner, false);
  assert.strictEqual((await req('GET', '/api/me', null, cookie)).json.show_test_banner, false);
  // turn it back on (leave config clean for other tests)
  const on = await req('POST', '/api/admin/config', { show_test_banner: true }, cookie);
  assert.strictEqual(on.json.show_test_banner, true);
});

// ---- /admin Operations + Logs (ported from the transform) ----
test('admin-console routes are admin-gated', async function () {
  assert.ok((await req('GET', '/api/admin-console/commands')).code >= 400, 'unauthenticated must be rejected');
  assert.ok((await req('GET', '/api/admin-pm2')).code >= 400, 'unauthenticated must be rejected');
});

test('/api/admin-console/commands returns the allow-list catalog', async function () {
  const r = await req('GET', '/api/admin-console/commands', null, cookie);
  assert.strictEqual(r.code, 200);
  assert.ok(r.json.ok);
  assert.ok(Array.isArray(r.json.sections) && r.json.sections.length >= 1);
  const items = r.json.sections.reduce(function (a, s) { return a.concat(s.items); }, []);
  assert.ok(items.some(function (it) { return it.action === 'test_all' && it.web === 'run'; }), 'catalog has test_all');
  assert.ok(items.every(function (it) { return typeof it.id === 'number' && it.label; }));
  assert.ok(Array.isArray(r.json.runs) && Array.isArray(r.json.audit));
});

test('/api/admin-console/run rejects an unknown id without spawning', async function () {
  const r = await req('POST', '/api/admin-console/run', { id: 999999 }, cookie);
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.json.ok, false);
  assert.match(r.json.error, /unknown/i);
});

test('/api/admin-pm2 reports status (under_pm2:false in tests, no error)', async function () {
  const r = await req('GET', '/api/admin-pm2', null, cookie);
  assert.strictEqual(r.code, 200);
  assert.strictEqual(typeof r.json.under_pm2, 'boolean');
});

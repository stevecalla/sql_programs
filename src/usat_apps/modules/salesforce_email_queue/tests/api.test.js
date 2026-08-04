'use strict';
// API contract tests for the salesforce_email_queue module: every /api/salesforce-email-queue/* route
// is gated by require_panel('email-queue'). No DB / Salesforce needed — the gate resolves before any
// handler work. Mount api.mount() on a bare Express app and hit it with fetch.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sfeq-api-'));
process.env.USATAPPS_DATA_DIR = TMP;
// The module's knowledge/config store keys off EQ_DATA_DIR (not USATAPPS_DATA_DIR); point it — and the
// context folder — at the tmp dir so /admin/config + /context round-trips are hermetic (they persist to
// config.json / the context dir on disk). Mirrors the POC's routes.test.js EQ_DATA_DIR/EQ_CONTEXT_DIR.
process.env.EQ_DATA_DIR = TMP;
process.env.EQ_CONTEXT_DIR = path.join(TMP, 'context');

const express = require('express');
const api = require('../api');
const session = require('../../../auth/session');
const store = require('../../../auth/auth_store');

function cookieFor(user, role) { return session.COOKIE + '=' + session.sign({ user: user, role: role, ts: Date.now() }, store.session_secret()); }
function authedGet(p, cookie) { return fetch(base + p, { headers: { cookie: cookie } }); }
function authedPost(p, body, cookie) {
  return fetch(base + p, { method: 'POST', headers: { cookie: cookie, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
}

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

// ---- Authorized functional contract (admin session). Ported from the POC's routes.test.js, adapted to
// the namespaced /api/salesforce-email-queue/* routes. DB/Salesforce-backed routes (corrections, cases,
// thread, ...) are exercised only by the panel-gate test above — the shared-brain routes below need no
// external services. ----

test('GET /ai/models returns the shared model registry (provider/model/label, exactly one default)', async () => {
  const cookie = cookieFor('skip', 'admin');
  const r = await authedGet('/api/salesforce-email-queue/ai/models', cookie);
  assert.equal(r.status, 200);
  const models = await r.json();
  assert.ok(Array.isArray(models) && models.length >= 1);
  models.forEach((m) => { assert.ok(m.provider && m.model && m.label); });
  assert.equal(models.filter((m) => m.is_default).length, 1);
});

test('GET /admin/config returns admin_landing choices + the editable ai_models (admin only)', async () => {
  const cookie = cookieFor('skip', 'admin');
  const r = await authedGet('/api/salesforce-email-queue/admin/config', cookie);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.ok);
  assert.ok(Array.isArray(j.choices) && j.choices.indexOf('/metrics') >= 0);
  assert.ok(Array.isArray(j.ai_models) && j.ai_models.length >= 1);
  assert.ok(['prod', 'sandbox'].includes(j.sf_env));
});

test('/admin/config is require_admin: 401 without a session, 403 for a non-admin', async () => {
  const anon = await fetch(base + '/api/salesforce-email-queue/admin/config');
  assert.equal(anon.status, 401);
  const asUser = await authedGet('/api/salesforce-email-queue/admin/config', cookieFor('bob', 'user'));
  assert.equal(asUser.status, 403);
});

test('POST /admin/config saves an edited ai_models list (round-trip through /ai/models)', async () => {
  const cookie = cookieFor('skip', 'admin');
  const models = [
    { provider: 'openai', model: 'gpt-x', label: 'My GPT', is_default: true, price_in: 1.5, price_out: 9 },
    { provider: 'anthropic', model: 'claude-y', label: 'My Claude', price_in: 2, price_out: 8 },
  ];
  const save = await authedPost('/api/salesforce-email-queue/admin/config', { ai_models: models }, cookie);
  assert.equal(save.status, 200);
  const sj = await save.json();
  assert.ok(sj.ok);
  assert.equal(sj.ai_models.length, 2);
  assert.equal(sj.ai_models[0].model, 'gpt-x');
  assert.equal(sj.ai_models[0].price_in, 1.5);
  assert.equal(sj.ai_models.filter((m) => m.is_default).length, 1);
  // the shared registry now reflects the saved list (api.js wires ai.set_config_reader -> module config)
  const list = await (await authedGet('/api/salesforce-email-queue/ai/models', cookie)).json();
  assert.ok(list.some((m) => m.model === 'gpt-x'));
});

test('POST /admin/config rejects an empty / non-array ai_models list', async () => {
  const cookie = cookieFor('skip', 'admin');
  assert.equal((await authedPost('/api/salesforce-email-queue/admin/config', { ai_models: [] }, cookie)).status, 400);
  assert.equal((await authedPost('/api/salesforce-email-queue/admin/config', { ai_models: 'nope' }, cookie)).status, 400);
});

test('POST /admin/config round-trips show_test_banner through the module config', async () => {
  const cookie = cookieFor('skip', 'admin');
  // default is on (true)
  assert.equal((await (await authedGet('/api/salesforce-email-queue/admin/config', cookie)).json()).show_test_banner, true);
  // turn it off
  const off = await authedPost('/api/salesforce-email-queue/admin/config', { show_test_banner: false }, cookie);
  assert.equal((await off.json()).show_test_banner, false);
  assert.equal((await (await authedGet('/api/salesforce-email-queue/admin/config', cookie)).json()).show_test_banner, false);
  // turn it back on (leave config clean)
  const on = await authedPost('/api/salesforce-email-queue/admin/config', { show_test_banner: true }, cookie);
  assert.equal((await on.json()).show_test_banner, true);
});

test('GET /admin-console/commands returns the allow-list catalog (contains test_all)', async () => {
  const cookie = cookieFor('skip', 'admin');
  const r = await authedGet('/api/salesforce-email-queue/admin-console/commands', cookie);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.ok);
  assert.ok(Array.isArray(j.sections) && j.sections.length >= 1);
  const items = j.sections.reduce((a, s) => a.concat(s.items), []);
  assert.ok(items.some((it) => it.action === 'test_all' && it.web === 'run'), 'catalog has a test_all run item');
  assert.ok(items.every((it) => typeof it.id === 'number' && it.label));
  assert.ok(Array.isArray(j.runs) && Array.isArray(j.audit));
});

test('POST /admin-console/run rejects an unknown id without spawning', async () => {
  const cookie = cookieFor('skip', 'admin');
  const r = await authedPost('/api/salesforce-email-queue/admin-console/run', { id: 999999 }, cookie);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, false);          // start_run(undefined) returns { ok:false } BEFORE any spawn()
  assert.match(j.error, /unknown/i);
});

test('GET /admin-pm2 reports a boolean under_pm2 (no error in tests)', async () => {
  const cookie = cookieFor('skip', 'admin');
  const r = await authedGet('/api/salesforce-email-queue/admin-pm2', cookie);
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json()).under_pm2, 'boolean');
});

test('GET /context lists context files (filesystem-backed, empty to start)', async () => {
  const cookie = cookieFor('skip', 'admin');
  const r = await authedGet('/api/salesforce-email-queue/context?queue=Coaching', cookie);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.ok && Array.isArray(j.files));
  assert.equal(typeof j.knowledge_chars, 'number');
});

test('POST /context uploads a file then GET /context lists it; empty upload is rejected', async () => {
  const cookie = cookieFor('skip', 'admin');
  const b64 = Buffer.from('# note\nRecert takes 3 weeks').toString('base64');
  const up = await authedPost('/api/salesforce-email-queue/context', { scope: 'global', queue: 'Coaching', name: 'note.md', content_base64: b64 }, cookie);
  assert.equal(up.status, 200);
  const uj = await up.json();
  assert.ok(uj.ok && uj.saved && uj.saved.name === 'note.md');
  const list = await (await authedGet('/api/salesforce-email-queue/context?queue=Coaching', cookie)).json();
  assert.ok(list.files.some((x) => x.name === 'note.md'));
  // empty body -> 400
  assert.equal((await authedPost('/api/salesforce-email-queue/context', { scope: 'global', name: 'x.md', content_base64: '' }, cookie)).status, 400);
});

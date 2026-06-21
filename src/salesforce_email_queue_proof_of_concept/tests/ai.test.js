'use strict';
// Isolate the model registry from any real config.json on the machine: point EQ_DATA_DIR at an empty
// temp dir so models.list() falls back to the built-in defaults (read_config reads this at call time).
const os = require('os'), path = require('path'), fs = require('fs');
process.env.EQ_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eq_ai_data_'));

const test = require('node:test');
const assert = require('node:assert');
const { parse_verdict, respond_to_case } = require('../ai/respond');
const { ask_about_case } = require('../ai/ask');

function mock_conn(routes) {
  return { query: function (soql) { return { execute: function () {
    for (let i = 0; i < routes.length; i++) if (routes[i].match.test(soql)) return Promise.resolve({ records: routes[i].records });
    return Promise.resolve({ records: [] });
  } }; } };
}

const THREAD_ROUTE = { match: /FROM EmailMessage WHERE ParentId/, records: [
  { Id: '02s1', ParentId: '500', Incoming: true, MessageDate: '2026-06-01T10:00:00.000+0000', FromAddress: 'coach@x.com', CreatedBy: { Name: 'Automated Process' }, HasAttachment: false, TextBody: 'Am I certified to coach youth athletes?' }
] };
const HISTORY_ROUTE = { match: /FROM Case WHERE SuppliedEmail/, records: [
  { Id: '500B', CaseNumber: '0009', Subject: 'Past question', Status: 'Closed', CreatedDate: '2026-05-01T10:00:00.000+0000' }
] };

test('parse_verdict reads DRAFT + body', function () {
  const r = parse_verdict('VERDICT: DRAFT\n---\nHello there.');
  assert.strictEqual(r.verdict, 'draft');
  assert.strictEqual(r.body, 'Hello there.');
});

test('parse_verdict reads NEED_INFO', function () {
  const r = parse_verdict('VERDICT: NEED_INFO\n---\n- need membership id');
  assert.strictEqual(r.verdict, 'need_info');
});

test('respond_to_case assembles context and parses provider output', async function () {
  const conn = mock_conn([THREAD_ROUTE, HISTORY_ROUTE]);
  let seen = null;
  const complete = async function (args) { seen = args; return 'VERDICT: DRAFT\n---\nThanks for reaching out.'; };
  const r = await respond_to_case({ conn: conn, case_id: '500', complete: complete });
  assert.strictEqual(r.verdict, 'draft');
  assert.strictEqual(r.body, 'Thanks for reaching out.');
  assert.strictEqual(r.sender_email, 'coach@x.com');
  assert.ok(seen.prompt.indexOf('CURRENT EMAIL THREAD') >= 0);
  assert.ok(seen.prompt.indexOf('Am I certified') >= 0);
  assert.ok(seen.prompt.indexOf('PRIOR CASES FROM THIS SENDER') >= 0);
  assert.ok(seen.system.indexOf('USA Triathlon') >= 0);
});

test('ask_about_case returns the provider answer', async function () {
  const conn = mock_conn([THREAD_ROUTE, HISTORY_ROUTE]);
  const complete = async function () { return 'Based on the thread, yes.'; };
  const r = await ask_about_case({ conn: conn, case_id: '500', question: 'Summarize', complete: complete });
  assert.strictEqual(r.answer, 'Based on the thread, yes.');
});

test('ask_about_case folds prior Q&A history into the prompt', async function () {
  const conn = mock_conn([THREAD_ROUTE, HISTORY_ROUTE]);
  let seen = null;
  const complete = async function (a) { seen = a; return 'ok'; };
  await ask_about_case({ conn: conn, case_id: '500', question: 'follow up', history: [{ q: 'prior q', a: 'prior a' }], complete: complete });
  assert.ok(seen.prompt.indexOf('EARLIER Q&A') >= 0);
  assert.ok(seen.prompt.indexOf('prior q') >= 0);
});

// --- vision: images reach the provider payloads ---
const providers = require('../ai/providers');
test('openai complete embeds images as image_url data URLs', async function () {
  let body = null;
  const transport = async function (url, opts) { body = JSON.parse(opts.body); return { ok: true, json: async function () { return { choices: [{ message: { content: 'ok' } }] }; } }; };
  await providers.complete({ provider: 'openai', system: 'S', prompt: 'P', images: [{ media_type: 'image/png', data_base64: 'AAAA' }], env: { OPENAI_API_KEY: 'k' }, transport: transport });
  const content = body.messages[1].content;
  assert.ok(Array.isArray(content), 'user content is multimodal array');
  assert.ok(content.some(function (c) { return c.type === 'image_url' && /^data:image\/png;base64,AAAA/.test(c.image_url.url); }), 'image_url present');
});
test('anthropic complete embeds images as base64 source', async function () {
  let body = null;
  const transport = async function (url, opts) { body = JSON.parse(opts.body); return { ok: true, json: async function () { return { content: [{ text: 'ok' }] }; } }; };
  await providers.complete({ provider: 'anthropic', system: 'S', prompt: 'P', images: [{ media_type: 'image/jpeg', data_base64: 'BBBB' }], env: { ANTHROPIC_API_KEY: 'k' }, transport: transport });
  const content = body.messages[0].content;
  assert.ok(Array.isArray(content) && content.some(function (c) { return c.type === 'image' && c.source && c.source.data === 'BBBB' && c.source.media_type === 'image/jpeg'; }), 'image source present');
});
test('no images -> plain string content (back-compat)', async function () {
  let body = null;
  const transport = async function (url, opts) { body = JSON.parse(opts.body); return { ok: true, json: async function () { return { choices: [{ message: { content: 'ok' } }] }; } }; };
  await providers.complete({ provider: 'openai', system: 'S', prompt: 'P', env: { OPENAI_API_KEY: 'k' }, transport: transport });
  assert.strictEqual(body.messages[1].content, 'P');
});

// --- single model registry: one source of truth for triage / draft / ask / Ask-box ---
const models = require('../ai/models');
test('registry lists models with provider+model+label and exactly one default', function () {
  const list = models.list();
  assert.ok(Array.isArray(list) && list.length >= 1, 'non-empty list');
  list.forEach(function (m) { assert.ok(m.provider && m.model && m.label, 'each entry has provider/model/label'); });
  assert.strictEqual(list.filter(function (m) { return m.is_default; }).length, 1, 'exactly one is_default');
  assert.strictEqual(models.default_model().model, list.filter(function (m) { return m.is_default; })[0].model);
});
test('OpenAI registry entry tracks OPENAI_MODEL from env', function () {
  const prev = process.env.OPENAI_MODEL;
  process.env.OPENAI_MODEL = 'gpt-test-123';
  try { assert.strictEqual(models.list().filter(function (m) { return m.provider === 'openai'; })[0].model, 'gpt-test-123'); }
  finally { if (prev === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = prev; }
});
test('metrics Ask box shares the SAME registry (re-export)', function () {
  const ask_models = require('../metrics/ask/models');
  assert.deepStrictEqual(ask_models.list(), models.list(), 'ask/models re-exports ai/models');
});
test('registry reads an edited ai_models list from config.json (admin override)', function () {
  const cfgp = path.join(process.env.EQ_DATA_DIR, 'config.json');
  try {
    fs.writeFileSync(cfgp, JSON.stringify({ ai_models: [
      { provider: 'anthropic', model: 'claude-z', label: 'Z', is_default: true, price_in: 2, price_out: 9 }
    ] }));
    const l = models.list();
    assert.strictEqual(l.length, 1);
    assert.strictEqual(l[0].model, 'claude-z');
    assert.strictEqual(l[0].is_default, true);
    assert.strictEqual(models.price_for('claude-z').in, 2);
    assert.strictEqual(models.cost_for('claude-z', 1e6, 1e6), 11);   // 1*2 + 1*9
  } finally { try { fs.unlinkSync(cfgp); } catch (e) {} }   // restore built-in defaults for any later read
});
test('resolve_model: explicit model wins, else env, else provider default', function () {
  assert.strictEqual(providers.resolve_model('anthropic', 'claude-x'), 'claude-x', 'explicit wins');
  assert.strictEqual(providers.resolve_model('openai', null, { OPENAI_MODEL: 'gpt-env' }), 'gpt-env', 'env override');
  assert.strictEqual(providers.resolve_model('anthropic', null, {}), 'claude-sonnet-4-6', 'provider default');
});

// --- token + cost tracking ---
test('price_for returns seeded prices; cost_for multiplies tokens x price', function () {
  const p = models.price_for('claude-sonnet-4-6');
  assert.strictEqual(p.in, 3.00); assert.strictEqual(p.out, 15.00);
  // 1,000,000 in @ $3 + 1,000,000 out @ $15 = $18.00
  assert.strictEqual(models.cost_for('claude-sonnet-4-6', 1000000, 1000000), 18.0);
  // unknown model -> $0 (until priced in /admin)
  assert.strictEqual(models.cost_for('totally-unknown-model', 1000000, 1000000), 0);
});
test('complete() returns { text, usage, model } and captures OpenAI usage', async function () {
  const transport = async function () { return { ok: true, json: async function () { return { choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }; } }; };
  const r = await providers.complete({ provider: 'openai', model: 'gpt-4o-mini', system: 'S', prompt: 'P', env: { OPENAI_API_KEY: 'k' }, transport: transport });
  assert.strictEqual(r.text, 'hi');
  assert.strictEqual(r.model, 'gpt-4o-mini');
  assert.deepStrictEqual(r.usage, { prompt_tokens: 11, completion_tokens: 7 });
});
test('respond_to_case surfaces usage + ai_model (object mock) and stays back-compat (string mock)', async function () {
  const conn = mock_conn([THREAD_ROUTE, HISTORY_ROUTE]);
  const obj = async function () { return { text: 'VERDICT: DRAFT\n---\nHi.', usage: { prompt_tokens: 5, completion_tokens: 3 }, model: 'gpt-4o-mini' }; };
  const r1 = await respond_to_case({ conn: conn, case_id: '500', complete: obj });
  assert.strictEqual(r1.verdict, 'draft');
  assert.deepStrictEqual(r1.usage, { prompt_tokens: 5, completion_tokens: 3 });
  assert.strictEqual(r1.ai_model, 'gpt-4o-mini');
  const str = async function () { return 'VERDICT: DRAFT\n---\nHi.'; };   // legacy string return
  const r2 = await respond_to_case({ conn: conn, case_id: '500', model: 'm-fallback', complete: str });
  assert.strictEqual(r2.verdict, 'draft');
  assert.strictEqual(r2.usage, null);
  assert.strictEqual(r2.ai_model, 'm-fallback');
});

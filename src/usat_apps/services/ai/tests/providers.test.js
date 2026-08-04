'use strict';
// Provider transport layer: vision (images embedded in the openai/anthropic user-content payloads),
// the uniform complete() return shape { text, usage, model }, and resolve_model precedence.
//
// respond_ask.test.js stubs at the `complete` seam (a fake complete() passed into respond/ask). At
// THIS layer complete() is the unit under test, so we stub one level lower: the injectable HTTP
// `transport` (opts.transport) that complete() calls — no network, exactly as the POC did.
const test = require('node:test');
const assert = require('node:assert');
const providers = require('../providers');

// --- vision: images reach the provider payloads ---
test('openai complete embeds images as image_url data URLs', async function () {
  let body = null;
  const transport = async function (url, opts) { body = JSON.parse(opts.body); return { ok: true, json: async function () { return { choices: [{ message: { content: 'ok' } }] }; } }; };
  await providers.complete({ provider: 'openai', system: 'S', prompt: 'P', images: [{ media_type: 'image/png', data_base64: 'AAAA' }], env: { OPENAI_API_KEY: 'k' }, transport: transport });
  const content = body.messages[1].content;
  assert.ok(Array.isArray(content), 'user content is multimodal array');
  assert.ok(content.some(function (c) { return c.type === 'text' && c.text === 'P'; }), 'text part present');
  assert.ok(content.some(function (c) { return c.type === 'image_url' && /^data:image\/png;base64,AAAA/.test(c.image_url.url); }), 'image_url present');
});

test('anthropic complete embeds images as base64 source', async function () {
  let body = null;
  const transport = async function (url, opts) { body = JSON.parse(opts.body); return { ok: true, json: async function () { return { content: [{ text: 'ok' }] }; } }; };
  await providers.complete({ provider: 'anthropic', system: 'S', prompt: 'P', images: [{ media_type: 'image/jpeg', data_base64: 'BBBB' }], env: { ANTHROPIC_API_KEY: 'k' }, transport: transport });
  const content = body.messages[0].content;
  assert.ok(Array.isArray(content), 'user content is a blocks array');
  assert.ok(content.some(function (c) { return c.type === 'text' && c.text === 'P'; }), 'text block present');
  assert.ok(content.some(function (c) { return c.type === 'image' && c.source && c.source.type === 'base64' && c.source.data === 'BBBB' && c.source.media_type === 'image/jpeg'; }), 'image source present');
});

test('no images -> plain string content (back-compat)', async function () {
  let body = null;
  const transport = async function (url, opts) { body = JSON.parse(opts.body); return { ok: true, json: async function () { return { choices: [{ message: { content: 'ok' } }] }; } }; };
  await providers.complete({ provider: 'openai', system: 'S', prompt: 'P', env: { OPENAI_API_KEY: 'k' }, transport: transport });
  assert.strictEqual(body.messages[1].content, 'P');
});

// --- complete() return shape ---
test('complete() returns { text, usage, model } and captures OpenAI usage', async function () {
  const transport = async function () { return { ok: true, json: async function () { return { choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }; } }; };
  const r = await providers.complete({ provider: 'openai', model: 'gpt-4o-mini', system: 'S', prompt: 'P', env: { OPENAI_API_KEY: 'k' }, transport: transport });
  assert.strictEqual(r.text, 'hi');
  assert.strictEqual(r.model, 'gpt-4o-mini');
  assert.deepStrictEqual(r.usage, { prompt_tokens: 11, completion_tokens: 7 });
});

// --- resolve_model precedence (lives in providers.js, not models.js) ---
test('resolve_model: explicit model wins, else env, else provider default', function () {
  assert.strictEqual(providers.resolve_model('anthropic', 'claude-x'), 'claude-x', 'explicit wins');
  assert.strictEqual(providers.resolve_model('openai', null, { OPENAI_MODEL: 'gpt-env' }), 'gpt-env', 'env override');
  assert.strictEqual(providers.resolve_model('anthropic', null, {}), 'claude-sonnet-4-6', 'provider default');
});

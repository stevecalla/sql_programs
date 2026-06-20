'use strict';
// AI provider abstraction. Default = OpenAI (ChatGPT); Anthropic (Claude) selectable. Keys/models
// come from .env. The HTTP transport is injectable (opts.transport) so respond/ask can be unit-
// tested with no network. Returns plain text.

const PROVIDERS = {
  openai: { id: 'openai', label: 'ChatGPT (OpenAI)', env_key: 'OPENAI_API_KEY', env_model: 'OPENAI_MODEL', default_model: 'gpt-4o-mini' },
  anthropic: { id: 'anthropic', label: 'Claude (Anthropic)', env_key: 'ANTHROPIC_API_KEY', env_model: 'ANTHROPIC_MODEL', default_model: 'claude-3-5-sonnet-latest' }
};
const DEFAULT_PROVIDER = 'openai';

function list_providers() {
  return Object.keys(PROVIDERS).map(function (k) { return { id: k, label: PROVIDERS[k].label, is_default: k === DEFAULT_PROVIDER }; });
}
function resolve(provider) {
  const p = PROVIDERS[provider || DEFAULT_PROVIDER];
  if (!p) throw new Error('Unknown provider: ' + provider);
  return p;
}
async function safe_text(res) { try { return await res.text(); } catch (e) { return ''; } }

// complete({ provider, model, system, prompt, env, transport })
async function complete(opts) {
  const o = opts || {};
  const p = resolve(o.provider);
  const env = o.env || process.env;
  const model = o.model || env[p.env_model] || p.default_model;
  const api_key = env[p.env_key];
  const transport = o.transport || (typeof fetch !== 'undefined' ? fetch : null);
  if (!api_key) { const e = new Error(p.label + ' API key missing (' + p.env_key + ')'); e.code = 'NO_API_KEY'; throw e; }
  if (!transport) throw new Error('No fetch transport available');
  if (p.id === 'openai') return openai_complete({ api_key: api_key, model: model, system: o.system, prompt: o.prompt, images: o.images, transport: transport });
  return anthropic_complete({ api_key: api_key, model: model, system: o.system, prompt: o.prompt, images: o.images, transport: transport });
}

function openai_user_content(prompt, images) {
  if (!images || !images.length) return prompt || '';
  const arr = [{ type: 'text', text: prompt || '' }];
  images.forEach(function (im) { arr.push({ type: 'image_url', image_url: { url: 'data:' + im.media_type + ';base64,' + im.data_base64 } }); });
  return arr;
}
async function openai_complete(a) {
  const res = await a.transport('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.api_key },
    body: JSON.stringify({ model: a.model, temperature: 0.2, messages: [{ role: 'system', content: a.system || '' }, { role: 'user', content: openai_user_content(a.prompt, a.images) }] })
  });
  if (!res.ok) throw new Error('OpenAI HTTP ' + res.status + ': ' + (await safe_text(res)));
  const j = await res.json();
  return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
}

function anthropic_user_content(prompt, images) {
  if (!images || !images.length) return prompt || '';
  const arr = [{ type: 'text', text: prompt || '' }];
  images.forEach(function (im) { arr.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data_base64 } }); });
  return arr;
}
async function anthropic_complete(a) {
  const res = await a.transport('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': a.api_key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: a.model, max_tokens: 1024, system: a.system || '', messages: [{ role: 'user', content: anthropic_user_content(a.prompt, a.images) }] })
  });
  if (!res.ok) throw new Error('Anthropic HTTP ' + res.status + ': ' + (await safe_text(res)));
  const j = await res.json();
  return ((j.content && j.content[0] && j.content[0].text) || '').trim();
}

module.exports = { PROVIDERS, DEFAULT_PROVIDER, list_providers, complete };

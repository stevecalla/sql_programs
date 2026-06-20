'use strict';
// Anthropic (Claude) chat adapter — mirrors src/event_analysis/ask.js usage.
async function chat(opts) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.Anthropic({ apiKey: key });
  const resp = await client.messages.create({
    model: opts.model || 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }]
  });
  return (resp.content || []).map(function (b) { return b.text || ''; }).join('');
}
module.exports = { id: 'anthropic', chat: chat, default_model: function () { return 'claude-sonnet-4-6'; } };

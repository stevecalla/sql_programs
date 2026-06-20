'use strict';
// Selectable models for the ask brain. The OpenAI default tracks OPENAI_MODEL from .env.
function list() {
  return [
    { provider: 'openai',    model: process.env.OPENAI_MODEL || 'gpt-4o-mini', label: 'ChatGPT (OpenAI)' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6',                        label: 'Claude Sonnet (rich)' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001',                label: 'Claude Haiku (fast/cheap)' }
  ];
}
module.exports = { list };

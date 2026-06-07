'use strict';
// Selectable models for the ask brain. ADD MODELS HERE — the CLI (`ask:models`) and
// the menu both read this list. The OpenAI default tracks OPENAI_MODEL from .env.
function list() {
  return [
    { provider: 'openai',    model: process.env.OPENAI_MODEL || 'gpt-4o',     label: 'OpenAI' },
    { provider: 'anthropic', model: 'claude-sonnet-4-6',                       label: 'Claude Sonnet (rich)' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001',               label: 'Claude Haiku (fast/cheap)' }
  ];
}
module.exports = { list };

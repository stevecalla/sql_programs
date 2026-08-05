'use strict';
// chatbot settings — the bot's AI choice (provider + model) and other controls. Persisted under a `chatbot`
// key in the SAME external config.json the email queue uses (services/knowledge/data_dir), so it lives with
// the other non-secret app config and is never committed. Namespaced so it never clobbers email-queue keys.
const data_dir = require('../../services/knowledge/data_dir');

function get() {
  let cfg = {};
  try { cfg = data_dir.read_config() || {}; } catch (e) { cfg = {}; }
  const c = (cfg.chatbot && typeof cfg.chatbot === 'object') ? cfg.chatbot : {};
  return { provider: c.provider === 'anthropic' ? 'anthropic' : 'openai', model: String(c.model || '') };
}

function set(partial) {
  partial = partial || {};
  let cfg = {};
  try { cfg = data_dir.read_config() || {}; } catch (e) { cfg = {}; }
  const cur = (cfg.chatbot && typeof cfg.chatbot === 'object') ? cfg.chatbot : {};
  const next = Object.assign({}, cur);
  if (partial.provider !== undefined) next.provider = partial.provider === 'anthropic' ? 'anthropic' : 'openai';
  if (partial.model !== undefined) next.model = String(partial.model || '');
  cfg.chatbot = next;
  data_dir.write_config(cfg);
  return get();
}

module.exports = { get, set };

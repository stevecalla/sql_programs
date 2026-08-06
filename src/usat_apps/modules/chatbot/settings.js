'use strict';
// chatbot settings — the bot's AI choice (provider + model) and other controls. Persisted under a `chatbot`
// key in the SAME external config.json the email queue uses (services/knowledge/data_dir), so it lives with
// the other non-secret app config and is never committed. Namespaced so it never clobbers email-queue keys.
const data_dir = require('../../services/knowledge/data_dir');

// Grounding mode — how tightly the member-facing bot is confined to curated knowledge:
//   'strict' (default) — answer ONLY from the curated KNOWLEDGE + CORRECTIONS; if it isn't there, say so.
//   'broad'            — may also use general USA Triathlon / triathlon knowledge when the curated content
//                        doesn't cover it, but never invents specific policy/prices/dates/contacts and still
//                        refuses off-topic questions. This is a CHATBOT-only control; the email queue is
//                        always strict by design (services/ai enforces NEED_INFO), so it has no such knob.
function norm_grounding(v) { return v === 'broad' ? 'broad' : 'strict'; }

function get() {
  let cfg = {};
  try { cfg = data_dir.read_config() || {}; } catch (e) { cfg = {}; }
  const c = (cfg.chatbot && typeof cfg.chatbot === 'object') ? cfg.chatbot : {};
  return { provider: c.provider === 'anthropic' ? 'anthropic' : 'openai', model: String(c.model || ''), grounding: norm_grounding(c.grounding) };
}

function set(partial) {
  partial = partial || {};
  let cfg = {};
  try { cfg = data_dir.read_config() || {}; } catch (e) { cfg = {}; }
  const cur = (cfg.chatbot && typeof cfg.chatbot === 'object') ? cfg.chatbot : {};
  const next = Object.assign({}, cur);
  if (partial.provider !== undefined) next.provider = partial.provider === 'anthropic' ? 'anthropic' : 'openai';
  if (partial.model !== undefined) next.model = String(partial.model || '');
  if (partial.grounding !== undefined) next.grounding = norm_grounding(partial.grounding);
  cfg.chatbot = next;
  data_dir.write_config(cfg);
  return get();
}

module.exports = { get, set };

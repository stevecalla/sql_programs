'use strict';
// chatbot module API — the internal POC endpoint. POST /api/chatbot/chat grounds an answer on the Team USA
// email-queue knowledge (+ operator corrections) and calls services/ai (OpenAI) with STRICT grounding:
// answer only from the curated knowledge; if it isn't there, say so and point to USA Triathlon. Panel-gated
// ('chatbot'); reuses the shared brain, so a correction that improves the email queue improves the bot too.
const { require_panel } = require('../../auth/require_auth');
const ai = require('../../services/ai');
const kb = require('../../services/knowledge');
const corrections = require('../../services/corrections');
const corr_store = require('../../services/corrections/mysql_store');

const P = '/api/chatbot';
const gate = require_panel('chatbot');
const QUEUE = process.env.CHATBOT_QUEUE || 'TeamUSA';   // which email-queue knowledge scope grounds the bot
const MAX_MSG = 2000;

let _store = null;
async function get_store() { if (!_store) _store = await corr_store.create_store(); return _store; }

function build_system(knowledge, corr) {
  const kblock = (knowledge && String(knowledge).trim()) ? String(knowledge).trim() : '(no knowledge provided)';
  const cblock = (corr && corr.length) ? corr.map(function (c) { return '- ' + c; }).join('\n') : '';
  return [
    'You are the USA Triathlon "Team USA" assistant. You help members and visitors with questions about',
    'USA Triathlon and the Age Group Team USA program ONLY.',
    '',
    'Rules:',
    '- Answer ONLY using the KNOWLEDGE below (and CORRECTIONS). Do not use outside information.',
    "- If the answer is not in the KNOWLEDGE, say you don't have that information and suggest contacting",
    '  USA Triathlon. Do NOT guess or invent policy.',
    "- If the question is unrelated to USA Triathlon / Team USA, politely say that's outside what you can help with.",
    '- Never ask for or reveal personal or member data. Keep answers concise and friendly.',
    '',
    'KNOWLEDGE:',
    kblock,
    cblock ? ('\nCORRECTIONS (authoritative — follow these):\n' + cblock) : '',
  ].join('\n');
}

function mount(app) {
  // GET /api/chatbot/config — the scope + model this POC uses (for the widget header).
  app.get(P + '/config', gate, async function (req, res) {
    let chars = 0;
    try { const k = await kb.load_knowledge(QUEUE); chars = (k && k.length) || 0; } catch (e) { chars = 0; }
    res.json({ ok: true, scope: QUEUE, model: ai.resolve_model('openai', null, process.env), knowledge_chars: chars });
  });

  // POST /api/chatbot/chat  { message, history? } -> { ok, answer, grounded, model }
  app.post(P + '/chat', gate, async function (req, res) {
    const b = req.body || {};
    const message = String(b.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Empty message.' });
    if (message.length > MAX_MSG) return res.status(400).json({ ok: false, error: 'Message too long.' });
    try {
      const knowledge = await kb.load_knowledge(QUEUE);
      let corr = [];
      try { corr = await corrections.grounding_lines(await get_store(), 12, { queue: QUEUE }); } catch (e) { corr = []; }
      const provider = 'openai';
      const model = ai.resolve_model(provider, null, process.env);
      if (!model) return res.status(502).json({ ok: false, error: 'No OpenAI model configured (set OPENAI_API_KEY / OPENAI_MODEL).' });

      // Light conversation memory: recent turns for continuity; the GROUNDING stays the knowledge, not history.
      const hist = Array.isArray(b.history) ? b.history.slice(-6) : [];
      const convo = hist.map(function (h) { return (h.role === 'bot' ? 'Assistant: ' : 'User: ') + String(h.text || ''); }).join('\n');
      const prompt = (convo ? (convo + '\n') : '') + 'User: ' + message + '\nAssistant:';

      const raw = await ai.complete({ provider: provider, model: model, system: build_system(knowledge, corr), prompt: prompt });
      const out = ai.norm_completion(raw, model);
      res.json({ ok: true, answer: (out && out.text ? String(out.text).trim() : ''), grounded: !!(knowledge && knowledge.length), model: out.model || model });
    } catch (e) {
      res.status(502).json({ ok: false, error: (e && e.message) || 'chat failed' });
    }
  });
}

module.exports = { mount };

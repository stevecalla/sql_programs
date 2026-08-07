'use strict';
// Public chatbot surface — the ISOLATED, unauthenticated door for the embeddable web widget.
//
// SAFETY (the wall): answers ONLY from curated knowledge (context files + URL chunks + corrections) via the
// shared grounding path, pinned to ONE public queue, STRICT grounding always. It NEVER touches Salesforce,
// member cases, or PII, and it is NOT behind the platform session. Rate-limited + size-capped. Turns log to
// chatbot_conversations with channel='web-widget' and is_test=1 (test site). Mounted by modules/chatbot/module.js.
//
// Served under /api/* so the SPA catch-all doesn't swallow the widget page. The widget is embedded via an
// <iframe> whose API calls are same-origin (no CORS needed); the parent site is allowed to frame it via a
// CSP frame-ancestors allow-list.
const ai = require('../../services/ai');
const grounding = require('../../services/knowledge/grounding');
const corrections = require('../../services/corrections');
const corr_store = require('../../services/corrections/mysql_store');
const convo_store = require('./conversations');
const settings = require('./settings');
const widget_page = require('./widget_page');
const kb_data_dir = require('../../services/knowledge/data_dir');   // shared config.json — public-bot pin lives here

const PUBLIC_QUEUE = process.env.CHATBOT_PUBLIC_QUEUE || 'Team USA';           // default / fallback only
const CHANNEL = process.env.CHATBOT_PUBLIC_CHANNEL || 'web-widget';            // default / fallback only

// The pinned queue + channel come from server-side config (set by an authenticated operator in the Public
// widget panel), then env, then the defaults above. Read PER REQUEST so a change takes effect without a
// restart. Crucially this is NEVER read from the request — the embed can't repoint the bot via a URL param.
function public_cfg() {
  let c = {}; try { c = kb_data_dir.read_config() || {}; } catch (e) { c = {}; }
  const pb = c.public_bot || {};
  return { queue: pb.queue || PUBLIC_QUEUE, channel: pb.channel || CHANNEL };
}
const IS_TEST = String(process.env.CHATBOT_PUBLIC_IS_TEST || '1') === '1' ? 1 : 0;   // test site => 1
const MAX_MSG = 2000;
const FRAME_ANCESTORS = process.env.CHATBOT_WIDGET_FRAME_ANCESTORS ||
  "'self' https://preview-www.usatriathlon.org https://www.usatriathlon.org https://*.usatriathlon.org";

// Strict, member-facing system prompt (mirrors the chatbot's strict rules; public bot is always strict).
function build_public_system(queue, knowledge, corr) {
  const kblock = (knowledge && String(knowledge).trim()) ? String(knowledge).trim() : '(no knowledge provided)';
  const cblock = (corr && corr.length) ? corr.map(function (c) { return '- ' + c; }).join('\n') : '';
  const name = String(queue || 'this program');
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver' });
  return [
    'You are a USA Triathlon assistant for the "' + name + '" program. You help members and visitors with',
    'questions about USA Triathlon and the ' + name + ' program ONLY.',
    'Today is ' + today + ' (US Mountain Time).',
    '',
    'Rules (STRICT grounding — curated content only):',
    '- Answer ONLY using the KNOWLEDGE below (and CORRECTIONS). Do not use outside information.',
    "- If the answer is not in the KNOWLEDGE, say you don't have that information and suggest contacting",
    '  USA Triathlon. Do NOT guess or invent policy.',
    '- Use today\'s date to resolve "latest", "next", "upcoming", "most recent", or "past": read the dates in',
    '  the KNOWLEDGE and pick the item on the correct side of today (e.g. the most recent past one, or the',
    '  next future one). State the specific date you chose.',
    '- When the KNOWLEDGE contains a relevant link (a URL, often shown as "label (https://…)"), include it in',
    '  your answer as a Markdown link: [label](https://…). Only use URLs that actually appear in the',
    '  KNOWLEDGE — never invent or guess a URL.',
    '- If the question is unrelated to USA Triathlon / ' + name + ", politely say that's outside what you can help with.",
    '- Never ask for or reveal personal or member data. Keep answers concise and friendly.',
    '- Write the program name exactly as: "' + name + '".',
    '',
    'KNOWLEDGE:',
    kblock,
    cblock ? ('\nCORRECTIONS (authoritative — follow these):\n' + cblock) : '',
  ].join('\n');
}

// --- tiny in-memory per-IP rate limiter (no external dependency) ---
const RL_WINDOW_MS = 60 * 1000;
const RL_MAX = Number(process.env.CHATBOT_PUBLIC_RATE || 30);   // requests per IP per minute
const _hits = new Map();
function rate_ok(ip) {
  const now = Date.now(); const k = String(ip || 'unknown');
  let e = _hits.get(k);
  if (!e || now > e.reset) { e = { count: 0, reset: now + RL_WINDOW_MS }; _hits.set(k, e); }
  e.count += 1;
  if (_hits.size > 5000) { for (const [kk, vv] of _hits) { if (now > vv.reset) _hits.delete(kk); } }   // opportunistic cleanup
  return e.count <= RL_MAX;
}
function client_ip(req) { return String((req.ip || (req.socket && req.socket.remoteAddress) || '')).replace('::ffff:', ''); }

let _store = null;
async function get_store() { if (!_store) _store = await corr_store.create_store(); return _store; }

function mount(app) {
  // Embeddable widget page. Framed only by the allow-listed origins (CSP frame-ancestors); no X-Frame-Options.
  app.get('/api/public-chatbot/widget', function (req, res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', 'frame-ancestors ' + FRAME_ANCESTORS);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(widget_page.render({ queue: public_cfg().queue, theme: (req.query.theme === 'dark' ? 'dark' : 'light'), bubble: (req.query.bubble || 'plain'), color: (req.query.color || '') }));
  });

  // GTM loader script — inject via a GTM Custom HTML tag: <script async src=".../widget.js"></script>.
  // It builds the iframe + resizer on the host page (no hand-placed iframe needed).
  app.get('/api/public-chatbot/widget.js', function (req, res) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(widget_page.render_loader());
  });

  // Public ask — curated knowledge only, pinned queue, strict grounding. No auth, rate-limited, size-capped.
  app.post('/api/public-chatbot/ask', async function (req, res) {
    if (!rate_ok(client_ip(req))) return res.status(429).json({ ok: false, error: 'Too many requests — please slow down.' });
    const b = req.body || {};
    const message = String(b.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Empty message.' });
    if (message.length > MAX_MSG) return res.status(400).json({ ok: false, error: 'Message too long.' });
    const pc = public_cfg();
    const queue = pc.queue;   // PINNED server-side (never from the request)
    const conversation_id = (b.conversation_id && String(b.conversation_id).slice(0, 40)) || convo_store.new_conversation_id();
    const turn = Number(b.turn || 0);
    try {
      const g = await grounding.gather(queue, message);
      const knowledge = g.knowledge;
      let corr = [];
      try { corr = await corrections.grounding_lines(await get_store(), 12, { queue: queue }); } catch (e) { corr = []; }
      const st = settings.get();
      const provider = st.provider || 'openai';
      const model = ai.resolve_model(provider, st.model || null, process.env);
      if (!model) return res.status(503).json({ ok: false, error: 'The assistant is not configured yet.' });
      const hist = Array.isArray(b.history) ? b.history.slice(-6) : [];
      const convo = hist.map(function (h) { return (h.role === 'bot' ? 'Assistant: ' : 'User: ') + String(h.text || ''); }).join('\n');
      const prompt = (convo ? (convo + '\n') : '') + 'User: ' + message + '\nAssistant:';
      const t0 = Date.now();
      const raw = await ai.complete({ provider: provider, model: model, system: build_public_system(queue, knowledge, corr), prompt: prompt });
      const latency_ms = Date.now() - t0;
      const out = ai.norm_completion(raw, model);
      const answer = (out && out.text ? String(out.text).trim() : '');
      const grounded = !!(knowledge && knowledge.length);

      res.json({ ok: true, answer: answer, conversation_id: conversation_id });

      // Fire-and-forget logging (never blocks the response): intro (first turn) -> user -> bot, in order.
      const base = { conversation_id: conversation_id, channel: pc.channel, queue: queue, actor: null, is_test: IS_TEST };
      (async function () {
        try {
          if (b.intro && turn === 0) await convo_store.log_turn(Object.assign({}, base, { turn: 0, role: 'bot', text: String(b.intro).slice(0, MAX_MSG) }));
          await convo_store.log_turn(Object.assign({}, base, { turn: turn, role: 'user', text: message }));
          await convo_store.log_turn(Object.assign({}, base, {
            turn: turn, role: 'bot', text: answer, provider: provider, model: out.model || model,
            grounded: grounded, knowledge_chars: (knowledge && knowledge.length) || 0, corrections_used: corr.length, latency_ms: latency_ms,
          }));
        } catch (e) { /* logging must never break the widget */ }
      })();
    } catch (e) { res.status(502).json({ ok: false, error: 'Sorry — something went wrong.' }); }
  });
}

module.exports = { mount, PUBLIC_QUEUE };

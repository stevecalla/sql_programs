'use strict';
// Read-only AI response for a case: load thread + sender history (+ optional attachment text),
// assemble context, call the provider, parse a verdict. SF connection and AI provider are
// INJECTED so this is unit-testable with mocks (no network).
const { build_context } = require('./context');
const { SYSTEM, build_respond_prompt } = require('./prompt');
const providers = require('./providers');

function find_sender_email(thread) {
  const inbound = (thread || []).filter(function (m) { return m.incoming; });
  const first = inbound[0] || (thread || [])[0];
  return (first && first.from_address) || '';
}

function parse_verdict(text) {
  const t = String(text || '');
  const m = t.match(/VERDICT:\s*(DRAFT|NEED_INFO)/i);
  const verdict = (m ? m[1] : 'DRAFT').toUpperCase();
  const sep = t.indexOf('---');
  const body = sep >= 0 ? t.slice(sep + 3).trim() : t.replace(/VERDICT:\s*(DRAFT|NEED_INFO)/i, '').trim();
  return { verdict: verdict === 'NEED_INFO' ? 'need_info' : 'draft', body: body, raw: t };
}

// opts: { conn, case_id, provider, model, faq, corrections, fetch_attachments, complete, env }
async function respond_to_case(opts) {
  const o = opts || {};
  const thread = o.thread;
  if (!Array.isArray(thread)) throw new Error('respond_to_case: thread (array) required');
  const sender_email = find_sender_email(thread);
  const sender_history = o.sender_history || [];
  const attachments_text = o.attachments_text || [];
  const context = build_context({ thread: thread, sender_history: sender_history, attachments_text: attachments_text, faq: o.faq, corrections: o.corrections });
  const complete = o.complete || providers.complete;
  const raw = await complete({ provider: o.provider, model: o.model, system: SYSTEM, prompt: build_respond_prompt(context), images: o.images, env: o.env });
  const c = providers.norm_completion(raw, o.model);
  return Object.assign({ context_chars: context.length, sender_email: sender_email, messages: thread.length, usage: c.usage, ai_model: c.model }, parse_verdict(c.text));
}

module.exports = { respond_to_case, parse_verdict, find_sender_email };

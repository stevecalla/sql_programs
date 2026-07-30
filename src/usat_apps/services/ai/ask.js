'use strict';
// Read-only AI answer to a staff question about a case, grounded in the same context as respond.
// SF connection + provider injected for testability.
const { build_context } = require('./context');
const { SYSTEM, build_ask_prompt } = require('./prompt');
const providers = require('./providers');
const { find_sender_email } = require('./respond');

// opts: { conn, case_id, question, provider, model, faq, corrections, complete, env }
async function ask_about_case(opts) {
  const o = opts || {};
  const thread = o.thread;
  if (!Array.isArray(thread) || !o.question) throw new Error('ask_about_case: thread (array) and question required');
  const sender_email = find_sender_email(thread);
  const sender_history = o.sender_history || [];
  const context = build_context({ thread: thread, sender_history: sender_history, faq: o.faq, corrections: o.corrections });
  const complete = o.complete || providers.complete;
  const raw = await complete({ provider: o.provider, model: o.model, system: SYSTEM, prompt: build_ask_prompt(context, o.question, o.history), images: o.images, env: o.env });
  const c = providers.norm_completion(raw, o.model);
  return { answer: c.text, context_chars: context.length, sender_email: sender_email, usage: c.usage, ai_model: c.model };
}

module.exports = { ask_about_case };

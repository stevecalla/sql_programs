'use strict';
// Read-only AI answer to a staff question about a case, grounded in the same context as respond.
// SF connection + provider injected for testability.
const sf = require('../sf');
const { build_context } = require('./context');
const { SYSTEM, build_ask_prompt } = require('./prompt');
const providers = require('./providers');
const { find_sender_email } = require('./respond');

// opts: { conn, case_id, question, provider, model, faq, corrections, complete, env }
async function ask_about_case(opts) {
  const o = opts || {};
  if (!o.conn || !o.case_id || !o.question) throw new Error('ask_about_case: conn, case_id, question required');
  const thread = await sf.get_thread(o.conn, o.case_id);
  const sender_email = find_sender_email(thread);
  const sender_history = sender_email ? await sf.get_sender_history(o.conn, { email: sender_email, exclude_case_id: o.case_id }) : [];
  const context = build_context({ thread: thread, sender_history: sender_history, faq: o.faq, corrections: o.corrections });
  const complete = o.complete || providers.complete;
  const answer = await complete({ provider: o.provider, model: o.model, system: SYSTEM, prompt: build_ask_prompt(context, o.question, o.history), env: o.env });
  return { answer: answer, context_chars: context.length, sender_email: sender_email };
}

module.exports = { ask_about_case };

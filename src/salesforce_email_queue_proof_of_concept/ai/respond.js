'use strict';
// Read-only AI response for a case: load thread + sender history (+ optional attachment text),
// assemble context, call the provider, parse a verdict. SF connection and AI provider are
// INJECTED so this is unit-testable with mocks (no network).
const sf = require('../sf');
const extract = require('./extract');
const { build_context } = require('./context');
const { SYSTEM, build_respond_prompt } = require('./prompt');
const providers = require('./providers');

function find_sender_email(thread) {
  const inbound = (thread || []).filter(function (m) { return m.incoming; });
  const first = inbound[0] || (thread || [])[0];
  return (first && first.from_address) || '';
}

async function collect_attachment_text(conn, thread) {
  const out = [];
  const list = thread || [];
  for (let i = 0; i < list.length; i++) {
    const atts = list[i].attachments || [];
    for (let j = 0; j < atts.length; j++) {
      const a = atts[j];
      try {
        const buf = await sf.fetch_content_version_bytes(conn, a.content_version_id);
        const r = await extract.extract_text(buf, { file_extension: a.file_extension, title: a.title, content_size: a.content_size });
        out.push({ name: a.title + '.' + a.file_extension, text: r.text, note: r.note });
      } catch (e) { out.push({ name: a.title, text: '', note: '[' + a.title + ': download failed]' }); }
    }
  }
  return out;
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
  if (!o.conn || !o.case_id) throw new Error('respond_to_case: conn and case_id required');
  const thread = await sf.get_thread(o.conn, o.case_id);
  const sender_email = find_sender_email(thread);
  const sender_history = sender_email ? await sf.get_sender_history(o.conn, { email: sender_email, exclude_case_id: o.case_id }) : [];
  const attachments_text = o.fetch_attachments ? await collect_attachment_text(o.conn, thread) : [];
  const context = build_context({ thread: thread, sender_history: sender_history, attachments_text: attachments_text, faq: o.faq, corrections: o.corrections });
  const complete = o.complete || providers.complete;
  const text = await complete({ provider: o.provider, model: o.model, system: SYSTEM, prompt: build_respond_prompt(context), env: o.env });
  return Object.assign({ context_chars: context.length, sender_email: sender_email, messages: thread.length }, parse_verdict(text));
}

module.exports = { respond_to_case, parse_verdict, find_sender_email, collect_attachment_text };

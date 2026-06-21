'use strict';
// Lightweight per-case triage: classify how ready staff are to answer, as a status the UI shows as a
// badge (answer_ready / draft_possible / needs_info / non_actionable). Cheap: bounces/no-reply are
// caught locally (no AI call); otherwise one short model call (subject + latest inbound + FAQ).
// conn + provider injectable for tests. Internal tag only - never written back to Salesforce.
const sf = require('../sf');
const providers = require('./providers');
const spam = require('./spam');

const STATUSES = ['answer_ready', 'draft_possible', 'needs_info', 'awaiting_reply', 'spam', 'non_actionable'];

// Returns a status without an AI call when the case is obviously non-actionable, else null.
function classify_local(thread) {
  const inbound = (thread || []).filter(function (m) { return m.incoming; });
  if (!inbound.length) return { status: 'non_actionable', reason: 'No inbound customer message.' };
  const latest_in = inbound[inbound.length - 1] || {};
  const from = String(latest_in.from_address || '').toLowerCase();
  if (/mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce/.test(from)) return { status: 'non_actionable', reason: 'Automated bounce / no-reply sender.' };
  // Conservative spam heuristic (no AI): only clear cold/bulk/marketing outreach.
  const sp = spam.looks_like_spam(latest_in);
  if (sp) return { status: 'spam', reason: sp.reason };
  const last = thread[thread.length - 1];
  if (last && !last.incoming && !last.automated) return { status: 'awaiting_reply', reason: 'Latest message is a staff reply; awaiting the customer.' };
  return null;
}
function parse_triage(text) {
  const t = String(text || '');
  const m = t.match(/(ANSWER_READY|DRAFT_POSSIBLE|NEEDS_INFO|SPAM|NON_ACTIONABLE)/i);
  const status = (m ? m[1] : 'NEEDS_INFO').toLowerCase();
  const dash = t.indexOf('-');
  const reason = (dash >= 0 ? t.slice(dash + 1) : t.replace(/(ANSWER_READY|DRAFT_POSSIBLE|NEEDS_INFO|SPAM|NON_ACTIONABLE)/i, '')).trim();
  return { status: status, reason: reason.slice(0, 140) };
}

// opts: { conn, case_id, thread?, provider, model, faq, complete, env }
async function triage_case(opts) {
  const o = opts || {};
  if (!o.conn || !o.case_id) throw new Error('triage_case: conn and case_id required');
  const thread = o.thread || await sf.get_thread(o.conn, o.case_id);
  const local = classify_local(thread);
  // Local (no-AI) classification: no model call, so no prompt/reply sizes.
  if (local) return Object.assign({ case_id: o.case_id, prompt_chars: 0, reply_chars: (local.reason || '').length, ai: false, usage: null, ai_model: null }, local);
  const inbound = thread.filter(function (m) { return m.incoming; });
  const latest = inbound[inbound.length - 1] || thread[0] || {};
  const human_answered = thread.some(function (m) { return !m.incoming && !m.automated; });
  const prompt = [
    'Classify how ready USAT staff are to answer the LATEST customer message on this case.',
    'Output ONE token, then " - ", then a reason of <=12 words. Tokens:',
    'ANSWER_READY = context fully answers it; DRAFT_POSSIBLE = mostly, minor gaps;',
    'NEEDS_INFO = missing facts/policy to answer;',
    'SPAM = unsolicited cold/bulk/marketing/sales/SEO/phishing outreach NOT related to USA Triathlon',
    '  membership, events, results, sanctioning, or coaching. Examples: link-building / guest-post / SEO',
    '  pitches, cold B2B sales, web-design/app-dev offers, newsletters or promos with unsubscribe links,',
    '  crypto / loan / investment offers. PREFER SPAM for any cold or bulk marketing unrelated to triathlon,',
    '  even if politely worded.',
    'NON_ACTIONABLE = bounce / no action needed. (An automated auto-acknowledgement does NOT count as answered.)',
    'Already answered by a human: ' + (human_answered ? 'yes' : 'no') + '.',
    '',
    'SENDER: ' + (latest.from_name || '') + ' <' + (latest.from_address || '') + '>',
    'SIGNALS: ' + spam.signal_summary(latest),
    'SUBJECT: ' + (latest.subject || ''),
    'LATEST CUSTOMER MESSAGE:',
    String(latest.text_new || latest.text_raw || '').slice(0, 1200),
    o.faq ? ('\nFAQ / KNOWLEDGE AVAILABLE:\n' + String(o.faq).slice(0, 1500)) : ''
  ].join('\n');
  const complete = o.complete || providers.complete;
  const raw = await complete({ provider: o.provider, model: o.model, system: 'You are a terse triage classifier. Output only: TOKEN - reason.', prompt: prompt, env: o.env });
  const c = providers.norm_completion(raw, o.model);
  return Object.assign({ case_id: o.case_id, prompt_chars: prompt.length, reply_chars: (c.text || '').length, ai: true, usage: c.usage, ai_model: c.model }, parse_triage(c.text));
}

module.exports = { triage_case, parse_triage, classify_local, STATUSES };

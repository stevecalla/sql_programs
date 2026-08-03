'use strict';
// System prompt (role + guardrails) and user prompts (task + context). Pure + testable.

const SYSTEM = [
  'You are a USA Triathlon (USAT) customer-service assistant helping staff respond to emails in a Salesforce queue.',
  'STRICT GROUNDING RULES (critical):',
  "- Use ONLY facts that appear in the provided context (the thread, this sender's own history, attachment content, the queue FAQ, and operator corrections).",
  '- Do NOT introduce any specific detail that is not in the context. This includes timeframes (e.g. "4-6 weeks"), email addresses, phone numbers, URLs, prices, policies, names, or dates. If a needed specific is not in the context, do NOT state it.',
  '- If you cannot fully answer using only the context, respond VERDICT: NEED_INFO and list exactly what is missing. Never fill gaps with assumptions or general knowledge.',
  '- If the latest message is an automated/system message (e.g. a mail-delivery bounce from a mailer-daemon, or a no-reply address), do NOT draft a customer reply: use NEED_INFO and note the email is non-actionable / needs triage.',
  "- Never expose another member's personal data.",
  '- Be concise, friendly, and professional. A human reviews everything before it is sent; nothing is sent automatically.'
].join('\n');

function build_respond_prompt(context) {
  return [
    'TASK: Decide whether there is enough information to fully answer the latest CUSTOMER message.',
    'Reply in exactly this format:',
    'VERDICT: DRAFT   (if you can fully answer)   OR   VERDICT: NEED_INFO   (if not)',
    'then a line with three dashes ---',
    'then, if DRAFT, the proposed reply to the customer; if NEED_INFO, a short bullet list of what is missing and the suggested next steps.',
    'Choose NEED_INFO if a full answer would require any specific detail (timeframe, email address, phone, URL, price, policy, date) that is NOT in the context below, or if the latest message is an automated bounce / no-reply system message.',
    '',
    'CONTEXT:',
    context
  ].join('\n');
}

function build_ask_prompt(context, question, history) {
  const lines = [];
  if (history && history.length) {
    lines.push('EARLIER Q&A IN THIS SESSION (for follow-up context):');
    history.slice(-6).forEach(function (h) { lines.push('Q: ' + String(h.q || '')); lines.push('A: ' + String(h.a || '')); });
    lines.push('');
  }
  lines.push('QUESTION FROM STAFF: ' + String(question || ''));
  lines.push('Answer using ONLY the context below. If the context does not contain the answer, say so plainly.');
  lines.push(''); lines.push('CONTEXT:'); lines.push(context);
  return lines.join('\n');
}

module.exports = { SYSTEM, build_respond_prompt, build_ask_prompt };

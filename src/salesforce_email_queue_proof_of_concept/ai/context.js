'use strict';
// Assemble grounding context from already-fetched data, applying the context rules:
//  tier 1 = this thread (incl. automated messages, marked); tier 2 = this sender's history;
//  tier 4 = queue FAQ; operator corrections appended. Tier 3 (queue-wide learning) is deferred.
// Pure + testable.

function fmt_thread(messages) {
  return (messages || []).map(function (m, i) {
    const who = m.incoming ? 'CUSTOMER' : (m.automated ? 'AUTO-REPLY (system)' : 'AGENT');
    const when = m.message_date_mtn || m.message_date_utc || '';
    const atts = (m.attachments && m.attachments.length)
      ? ('\n  [attachments: ' + m.attachments.map(function (a) { return a.title + '.' + a.file_extension; }).join(', ') + ']') : '';
    const body = (m.text_new || m.text_raw || '').trim();
    return '[' + (i + 1) + '] ' + who + ' - ' + when + '\n' + body + atts;
  }).join('\n\n');
}

function build_context(data) {
  const d = data || {};
  const out = [];
  out.push('=== CURRENT EMAIL THREAD (most important) ===');
  out.push(fmt_thread(d.thread));
  if (d.attachments_text && d.attachments_text.length) {
    out.push('\n=== ATTACHMENT CONTENT ===');
    d.attachments_text.forEach(function (a) { out.push('-- ' + a.name + ' --\n' + (a.text || a.note || '')); });
  }
  if (d.sender_history && d.sender_history.length) {
    out.push('\n=== PRIOR CASES FROM THIS SENDER (same person; safe to reference) ===');
    d.sender_history.forEach(function (c) { out.push('- ' + (c.created_mtn || '') + '  #' + c.case_number + '  [' + c.status + ']  ' + c.subject); });
  }
  if (d.faq) { out.push('\n=== QUEUE FAQ / KNOWLEDGE ==='); out.push(String(d.faq)); }
  if (d.corrections && d.corrections.length) {
    out.push('\n=== OPERATOR CORRECTIONS (follow these) ===');
    d.corrections.forEach(function (c) { out.push('- ' + c); });
  }
  return out.join('\n');
}

module.exports = { build_context, fmt_thread };

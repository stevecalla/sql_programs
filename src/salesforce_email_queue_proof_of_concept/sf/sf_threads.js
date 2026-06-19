'use strict';
// Email-queue thread reads: cases for a queue, and the full ordered thread for one case
// (with quoted-history stripped + attachment files). Connection is INJECTED (mock-testable).
// Reuses race_results_transform's run_soql + date formatting.
const { run_soql, datetime_in_time_zone, DEFAULT_TZ } = require('../../race_results_transform/sf');
const { html_to_text, strip_quoted_history } = require('./text_clean');

function soql_str(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function in_clause(ids) { return ids.map(function (id) { return "'" + soql_str(id) + "'"; }).join(','); }
// ISO offset (e.g. '-06:00') for a YYYY-MM-DD in the given IANA zone, for SOQL datetime literals.
function tz_offset_iso(ymd, tz) {
  try {
    const d = new Date(ymd + 'T12:00:00Z');
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz || DEFAULT_TZ, timeZoneName: 'shortOffset' })
      .formatToParts(d).find(function (p) { return p.type === 'timeZoneName'; }).value;
    const m = String(name).match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!m) return '+00:00';
    return m[1] + String(m[2]).padStart(2, '0') + ':' + (m[3] || '00');
  } catch (e) { return '-07:00'; }
}

// An outbound message created by 'Automated Process'/'System' is an auto-ack, not a human reply.
function is_automated_sender(name) { return /automated|^\s*system\s*$/i.test(String(name || '')); }

// List cases owned by a queue, newest activity first. opts: { queue_id, status:'open'|'closed'|'all', limit, tz }
async function list_queue_cases(conn, opts) {
  const o = opts || {};
  if (!o.queue_id) throw new Error('list_queue_cases: queue_id required');
  const status = o.status || 'open';
  const clause = status === 'open' ? ' AND IsClosed = false'
    : status === 'closed' ? ' AND IsClosed = true'
    : status === 'all' ? ''
    : " AND Status = '" + soql_str(status) + "'";
  const limit = Number(o.limit) > 0 ? Number(o.limit) : 50;
  const tz = o.tz || DEFAULT_TZ;
  const df = /^(LastModifiedDate|CreatedDate)$/.test(o.date_field || '') ? o.date_field : 'LastModifiedDate';
  let dclause = '';
  if (o.date_from && o.date_to) {
    dclause = " AND " + df + " >= " + o.date_from + "T00:00:00" + tz_offset_iso(o.date_from, tz) +
              " AND " + df + " <= " + o.date_to + "T23:59:59" + tz_offset_iso(o.date_to, tz);
  }
  const rows = await run_soql(conn,
    "SELECT Id, CaseNumber, Subject, Status, IsClosed, Priority, Origin, SuppliedEmail, " +
    "ContactId, AccountId, CreatedDate, LastModifiedDate FROM Case WHERE OwnerId = '" +
    soql_str(o.queue_id) + "'" + clause + dclause + " ORDER BY " + df + " DESC LIMIT " + limit);
  return (rows || []).map(function (c) {
    return {
      case_id: c.Id, case_number: c.CaseNumber, subject: c.Subject || '',
      status: c.Status || '', is_closed: !!c.IsClosed, priority: c.Priority || '',
      origin: c.Origin || '', supplied_email: c.SuppliedEmail || '',
      contact_id: c.ContactId || '', account_id: c.AccountId || '',
      created_utc: c.CreatedDate || null, modified_utc: c.LastModifiedDate || null,
      modified_mtn: c.LastModifiedDate ? datetime_in_time_zone(c.LastModifiedDate, tz) : ''
    };
  });
}

// EmailMessage ids -> { emailId: [attachment,...] } via ContentDocumentLink -> ContentVersion.
async function list_attachments(conn, email_ids) {
  const out = {};
  if (!email_ids || !email_ids.length) return out;
  const links = await run_soql(conn,
    "SELECT ContentDocumentId, LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN (" + in_clause(email_ids) + ")");
  const doc_to_email = {}; const doc_ids = [];
  (links || []).forEach(function (l) {
    if (l.ContentDocumentId && !doc_to_email[l.ContentDocumentId]) { doc_to_email[l.ContentDocumentId] = l.LinkedEntityId; doc_ids.push(l.ContentDocumentId); }
  });
  if (!doc_ids.length) return out;
  const vers = await run_soql(conn,
    "SELECT Id, ContentDocumentId, Title, FileExtension, ContentSize FROM ContentVersion " +
    "WHERE IsLatest = true AND ContentDocumentId IN (" + in_clause(doc_ids) + ")");
  (vers || []).forEach(function (v) {
    const eid = doc_to_email[v.ContentDocumentId];
    if (!eid) return;
    (out[eid] = out[eid] || []).push({
      content_version_id: v.Id, content_document_id: v.ContentDocumentId,
      title: v.Title || '', file_extension: String(v.FileExtension || '').toLowerCase(),
      content_size: Number(v.ContentSize || 0)
    });
  });
  return out;
}

// Full thread for one case: ordered messages with raw + stripped text and attachment metadata.
async function get_thread(conn, case_id, opts) {
  const o = opts || {};
  if (!case_id) throw new Error('get_thread: case_id required');
  const tz = o.tz || DEFAULT_TZ;
  const msgs = await run_soql(conn,
    "SELECT Id, ParentId, Incoming, MessageDate, Status, Subject, FromAddress, FromName, " +
    "ToAddress, CcAddress, CreatedBy.Name, HasAttachment, TextBody, HtmlBody " +
    "FROM EmailMessage WHERE ParentId = '" + soql_str(case_id) + "' ORDER BY MessageDate ASC");
  const list = msgs || [];
  const att = await list_attachments(conn, list.filter(function (m) { return m.HasAttachment; }).map(function (m) { return m.Id; }));
  return list.map(function (m) {
    const created_by = (m.CreatedBy && m.CreatedBy.Name) || '';
    const raw = (m.TextBody && String(m.TextBody)) || (m.HtmlBody ? html_to_text(m.HtmlBody) : '');
    return {
      id: m.Id,
      incoming: !!m.Incoming,
      automated: !m.Incoming && is_automated_sender(created_by),
      message_date_utc: m.MessageDate || null,
      message_date_mtn: m.MessageDate ? datetime_in_time_zone(m.MessageDate, tz) : '',
      status: m.Status || '', subject: m.Subject || '',
      from_address: m.FromAddress || '', from_name: m.FromName || '',
      to_address: m.ToAddress || '', cc_address: m.CcAddress || '',
      created_by_name: created_by,
      has_attachment: !!m.HasAttachment,
      text_raw: raw,
      text_new: strip_quoted_history(raw),
      html_body: (m.HtmlBody && String(m.HtmlBody)) || '',
      attachments: att[m.Id] || []
    };
  });
}

// Which of these cases have at least one attachment-bearing email -> { caseId: true }.
async function cases_with_attachments(conn, case_ids) {
  const out = {};
  if (!case_ids || !case_ids.length) return out;
  const rows = await run_soql(conn,
    "SELECT ParentId FROM EmailMessage WHERE HasAttachment = true AND ParentId IN (" + in_clause(case_ids) + ")");
  (rows || []).forEach(function (r) { if (r.ParentId) out[r.ParentId] = true; });
  return out;
}

// Which of these cases contain a URL in any (de-quoted) email body -> { caseId: {count, first} }.
async function cases_with_links(conn, case_ids) {
  const out = {};
  if (!case_ids || !case_ids.length) return out;
  const rows = await run_soql(conn,
    "SELECT ParentId, TextBody FROM EmailMessage WHERE ParentId IN (" + in_clause(case_ids) + ")");
  const RE = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/gi;
  (rows || []).forEach(function (r) {
    if (!r.ParentId || !r.TextBody) return;
    const body = strip_quoted_history(String(r.TextBody));
    const m = body.match(RE);
    if (m && m.length) {
      const cur = out[r.ParentId] || { count: 0, first: '' };
      cur.count += m.length;
      if (!cur.first) cur.first = m[0].replace(/[.,;:)\]]+$/, '');
      out[r.ParentId] = cur;
    }
  });
  return out;
}

// Case counts per Status for a queue -> { by_status: { value: n }, total }.
async function status_counts(conn, queue_id) {
  const out = { by_status: {}, total: 0 };
  if (!queue_id) return out;
  const rows = await run_soql(conn,
    "SELECT Status, COUNT(Id) cnt FROM Case WHERE OwnerId = '" + soql_str(queue_id) + "' GROUP BY Status");
  (rows || []).forEach(function (r) {
    const n = Number(r.cnt != null ? r.cnt : (r.expr0 || 0));
    out.by_status[r.Status || ''] = n; out.total += n;
  });
  return out;
}

// EmailMessage count per case -> { caseId: n }.
async function message_counts(conn, case_ids) {
  const out = {};
  if (!case_ids || !case_ids.length) return out;
  const rows = await run_soql(conn,
    "SELECT ParentId, COUNT(Id) cnt FROM EmailMessage WHERE ParentId IN (" + in_clause(case_ids) + ") GROUP BY ParentId");
  (rows || []).forEach(function (r) { if (r.ParentId) out[r.ParentId] = Number(r.cnt != null ? r.cnt : (r.expr0 || 0)); });
  return out;
}

module.exports = { list_queue_cases, get_thread, list_attachments, cases_with_attachments, cases_with_links, status_counts, message_counts, is_automated_sender };

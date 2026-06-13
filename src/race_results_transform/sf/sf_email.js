'use strict';
// Email-Queue intake: pull spreadsheet attachments off OPEN cases in the Rankings queue (Email-to-Case)
// and normalize them like the Upload-Queue path, so they feed the SAME convert/download pipeline.
// The connection is INJECTED (unit-testable with a mock conn, no network). Chain:
//   Group(Type='Queue') -> Case(OwnerId=queue [, IsClosed=false]) -> EmailMessage(HasAttachment=true)
//   -> ContentDocumentLink -> ContentVersion(IsLatest, ext filter) -> download VersionData.
// Sanction id + program name are best-effort, parsed from the email Subject (placeholder otherwise),
// with an OPTIONAL Program lookup to upgrade a parsed id to the canonical name/sanction.
const { query_in_batches, DEFAULT_EXTS, PROGRAM_OBJECT, SANCTION_FIELD } = require('./sf_client');
const { make_date_filter, datetime_in_time_zone, ymd_in_time_zone, DEFAULT_TZ } = require('./sf_dates');
const { build_download_file_name } = require('./sf_naming');

const MAX_FETCH = 5000;
const DEFAULT_QUEUE = process.env.SF_RANKINGS_QUEUE || 'cfg_Rankings';
// A sanction/event id as a parenthesized number in the subject, e.g. "... (38730) - USAT Results ...".
const SANCTION_RE = (function () {
  if (process.env.SF_EMAIL_SANCTION_RE) { try { return new RegExp(process.env.SF_EMAIL_SANCTION_RE); } catch (e) { /* fall through */ } }
  return /\((\d{3,7})\)/;
})();

// Escape a value for inlining inside a SOQL string literal (queue name comes from env/config).
function soql_str(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// Best-effort sanction + program from an email subject. Returns blanks when nothing matches (the
// common case). Program guess = the text before the "(" with a leading "[EXTERNAL] -" stripped.
function parse_subject(subject, re) {
  const s = String(subject == null ? '' : subject);
  const m = s.match(re || SANCTION_RE);
  if (!m) return { sanction: '', program: '' };
  const program = s.slice(0, m.index)
    .replace(/^\s*\[external\]\s*-\s*/i, '')
    .replace(/[\s\-–]+$/, '')
    .trim();
  return { sanction: m[1] || '', program: program };
}

// Returns normalized records (newest-modified first). opts:
//   { filter:{mode,field,date,start,end,tz}, status:'open'|'all', exts, tz, max_fetch, queue,
//     program_object, sanction_field, sanction_re, enrich_program (default true), quiet }
async function list_email_queue_files(conn, opts) {
  const o = opts || {};
  const tz = (o.filter && o.filter.tz) || o.tz || DEFAULT_TZ;
  const exts = o.exts || DEFAULT_EXTS;
  const queue = o.queue || DEFAULT_QUEUE;
  const sanction_re = o.sanction_re || SANCTION_RE;
  const max_fetch = o.max_fetch || MAX_FETCH;
  const enrich = o.enrich_program !== false;
  const program_object = o.program_object || PROGRAM_OBJECT;
  const sanction_field = o.sanction_field || SANCTION_FIELD;

  // 1. resolve the queue Group id (match DeveloperName or display Name).
  const grp = await conn.query(
    "SELECT Id, Name, DeveloperName FROM Group WHERE Type = 'Queue' AND " +
    "(DeveloperName = '" + soql_str(queue) + "' OR Name = '" + soql_str(queue) + "') LIMIT 1"
  ).execute({ autoFetch: false });
  const queue_rec = (grp && grp.records && grp.records[0]) || null;
  if (!queue_rec) return [];

  // 2. cases owned by the queue, newest-modified first; MT date filter client-side. status maps to the
  //    Case IsClosed flag: 'not_closed' (IsClosed=false, default) · 'closed' (IsClosed=true) · 'all' (no
  //    filter). Legacy aliases 'open'->not_closed, 'not_open'->closed are accepted too.
  const status = o.status || 'not_closed';
  const status_clause = (status === 'closed' || status === 'not_open') ? ' AND IsClosed = true'
    : (status === 'not_closed' || status === 'open') ? ' AND IsClosed = false' : '';
  const case_res = await conn.query(
    "SELECT Id, CaseNumber, Subject, Status, IsClosed, CreatedDate, LastModifiedDate " +
    "FROM Case WHERE OwnerId = '" + queue_rec.Id + "'" + status_clause +
    " ORDER BY LastModifiedDate DESC LIMIT 2000"
  ).execute({ autoFetch: true, maxFetch: max_fetch });
  const keep_date = make_date_filter(o.filter || { mode: 'all', field: 'LastModifiedDate', tz: tz });
  const cases = ((case_res && case_res.records) || []).filter(keep_date);
  if (cases.length === 0) return [];
  const case_by_id = new Map();
  cases.forEach(function (c) { case_by_id.set(c.Id, c); });

  // 3. emails WITH attachments on those cases.
  const emails = await query_in_batches(conn, function (list) {
    return "SELECT Id, ParentId, Subject, FromAddress, FromName, MessageDate, HasAttachment " +
      "FROM EmailMessage WHERE ParentId IN (" + list + ") AND HasAttachment = true";
  }, cases.map(function (c) { return c.Id; }), max_fetch);
  if (emails.length === 0) return [];
  const email_by_id = new Map();
  emails.forEach(function (e) { email_by_id.set(e.Id, e); });

  // 3b. attachment document ids via ContentDocumentLink (canonical Email-to-Case file hop).
  const links = await query_in_batches(conn, function (list) {
    return "SELECT ContentDocumentId, LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN (" + list + ")";
  }, emails.map(function (e) { return e.Id; }), max_fetch);
  const email_by_doc = new Map();   // ContentDocumentId -> the EmailMessage that carried it
  const doc_ids = [];
  links.forEach(function (l) {
    if (l.ContentDocumentId && email_by_id.has(l.LinkedEntityId) && !email_by_doc.has(l.ContentDocumentId)) {
      email_by_doc.set(l.ContentDocumentId, l.LinkedEntityId);
      doc_ids.push(l.ContentDocumentId);
    }
  });
  if (doc_ids.length === 0) return [];

  // 4. the spreadsheet files (latest version per document).
  const versions = await query_in_batches(conn, function (list) {
    return "SELECT Id, ContentDocumentId, Title, FileExtension, FileType, CreatedDate, LastModifiedDate " +
      "FROM ContentVersion WHERE IsLatest = true AND ContentDocumentId IN (" + list + ")";
  }, doc_ids, max_fetch);

  // keep spreadsheets only, dedup by document (IsLatest already gives one version per doc).
  const seen = new Set();
  const files = versions
    .filter(function (v) { return exts.indexOf(String(v.FileExtension || '').toLowerCase()) >= 0; })
    .filter(function (v) { const k = v.ContentDocumentId || v.Id; if (seen.has(k)) return false; seen.add(k); return true; });
  if (files.length === 0) return [];

  // Parse sanction/program from each file's email subject.
  const parsed_by_doc = new Map();
  files.forEach(function (v) {
    const email = email_by_id.get(email_by_doc.get(v.ContentDocumentId)) || {};
    parsed_by_doc.set(v.ContentDocumentId, parse_subject(email.Subject, sanction_re));
  });

  // Optional enrichment: upgrade a PARSED id to the canonical Program name + sanction. Only runs when
  // at least one id parsed (rare), and degrades to the parsed/placeholder values on any error.
  const program_by_sanction = new Map();
  if (enrich) {
    const ids = Array.from(new Set(Array.from(parsed_by_doc.values()).map(function (p) { return p.sanction; }).filter(Boolean)));
    if (ids.length) {
      try {
        const progs = await query_in_batches(conn, function (list) {
          return 'SELECT Id, Name, ' + sanction_field + ' FROM ' + program_object + ' WHERE ' + sanction_field + ' IN (' + list + ')';
        }, ids, max_fetch);
        progs.forEach(function (p) { const key = p[sanction_field]; if (key != null) program_by_sanction.set(String(key), p); });
      } catch (e) {
        if (!o.quiet) console.error('[sf-email] program enrichment skipped: ' + ((e && e.message) || e));
      }
    }
  }

  const out = files.map(function (v) {
    const email = email_by_id.get(email_by_doc.get(v.ContentDocumentId)) || {};
    const c = case_by_id.get(email.ParentId) || {};
    const parsed = parsed_by_doc.get(v.ContentDocumentId) || { sanction: '', program: '' };
    const prog = parsed.sanction ? program_by_sanction.get(String(parsed.sanction)) : null;
    const sanction_id = (prog && prog[sanction_field] != null) ? String(prog[sanction_field]) : (parsed.sanction || '');
    const program_name = (prog && prog.Name) ? prog.Name : (parsed.program || '');
    const sender = email.FromName || email.FromAddress || '';
    return {
      content_version_id: v.Id,
      content_document_id: v.ContentDocumentId,
      title: v.Title,
      file_extension: v.FileExtension,
      file_type: v.FileType,
      case_id: c.Id || '',
      case_number: c.CaseNumber || '',
      status: c.Status || '',
      is_closed: !!c.IsClosed,
      subject: email.Subject || c.Subject || '',
      sender: sender,
      owner_name: sender,   // alias so the shared queue/download wiring (which keys on owner_name) reuses the sender
      sender_email: email.FromAddress || '',
      opened_utc: c.CreatedDate || null,
      modified_utc: c.LastModifiedDate || null,
      opened_mtn: c.CreatedDate ? datetime_in_time_zone(c.CreatedDate, tz) : '',
      modified_mtn: c.LastModifiedDate ? datetime_in_time_zone(c.LastModifiedDate, tz) : '',
      opened_mtn_ymd: c.CreatedDate ? ymd_in_time_zone(c.CreatedDate, tz) : '',
      modified_mtn_ymd: c.LastModifiedDate ? ymd_in_time_zone(c.LastModifiedDate, tz) : '',
      message_date_utc: email.MessageDate || null,
      message_date_mtn: email.MessageDate ? datetime_in_time_zone(email.MessageDate, tz) : '',
      sanction_id: sanction_id,
      program_name: program_name,
      target_name: build_download_file_name(v, program_name, sender, sanction_id)
    };
  });
  out.sort(function (a, b) { return new Date(b.modified_utc || 0) - new Date(a.modified_utc || 0); });
  return out;
}

module.exports = { list_email_queue_files, parse_subject, DEFAULT_QUEUE, SANCTION_RE };

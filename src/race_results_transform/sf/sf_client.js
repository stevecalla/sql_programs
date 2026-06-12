'use strict';
// Salesforce query/enrichment for race-results files. The connection is INJECTED so this is
// unit-testable with a mock conn (no network). Mirrors the archive script's logic:
//   SOSL FIND {Race Results Doc} -> ContentVersion (xls/xlsx/csv)
//   -> MT date filter -> sort newest-first -> enrich Program (ContentDocumentLink) + Owner (User).
const jsforce = require('jsforce');
const { make_date_filter, ymd_in_time_zone, datetime_in_time_zone, DEFAULT_TZ } = require('./sf_dates');
const { build_download_file_name } = require('./sf_naming');

const DEFAULT_EXTS = ['xls', 'xlsx', 'csv'];
const DEFAULT_SEARCH_TERM = 'Race Results Doc';
const MAX_FETCH = 5000;
const BATCH_SIZE = 100;
// The Program (event) object + its Sanctioning ID formula field. Override per-org via env or opts.
const PROGRAM_OBJECT = process.env.SF_PROGRAM_OBJECT || 'Program';
const SANCTION_FIELD = process.env.SF_SANCTION_FIELD || 'cfg_Id__c';

// Build a jsforce connection and log in. cfg from sf_config(). Kept thin so it can be swapped.
async function make_connection(cfg) {
  const conn = new jsforce.Connection({ loginUrl: cfg.login_url, version: cfg.api_version });
  await conn.login(cfg.username, String(cfg.password || '') + String(cfg.security_token || ''));
  return conn;
}

function in_clause(ids) { return ids.map(function (id) { return "'" + String(id).replace(/'/g, '') + "'"; }).join(','); }

async function query_in_batches(conn, build_soql, ids, max_fetch) {
  const out = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const result = await conn.query(build_soql(in_clause(batch))).execute({ autoFetch: true, maxFetch: max_fetch || MAX_FETCH });
    out.push.apply(out, (result && result.records) || []);
  }
  return out;
}

// Returns normalized records (newest first). opts: { search_term, search_terms[], filter, exts, tz,
// max_fetch }. One SOSL term keeps its original unquoted form (behaviour unchanged); multiple terms
// are OR'd together (multi-word phrases quoted) so you can widen recall — e.g.
// ['Race Results Doc','Race Results','Race','Results'] -> FIND {"Race Results Doc" OR ... OR Results}.
async function list_race_results_files(conn, opts) {
  const o = opts || {};
  const tz = (o.filter && o.filter.tz) || o.tz || DEFAULT_TZ;
  const exts = o.exts || DEFAULT_EXTS;
  const terms = (Array.isArray(o.search_terms) && o.search_terms.length)
    ? o.search_terms
    : [o.search_term || DEFAULT_SEARCH_TERM];
  const find_expr = (terms.length === 1)
    ? terms[0]
    : terms.map(function (t) { return /\s/.test(t) ? '"' + String(t).replace(/"/g, '') + '"' : t; }).join(' OR ');

  const search_result = await conn.search(
    'FIND {' + find_expr + '} IN ALL FIELDS RETURNING ContentVersion(' +
    'Id, ContentDocumentId, Title, FileExtension, FileType, FirstPublishLocationId, ' +
    'CreatedDate, LastModifiedDate, CreatedById ' +
    'ORDER BY LastModifiedDate DESC, CreatedDate DESC LIMIT 2000)'
  );

  const found = (search_result && search_result.searchRecords) || [];
  const keep_date = make_date_filter(o.filter || { mode: 'all', field: 'LastModifiedDate', tz: tz });

  const seen_docs = new Set();
  const files = found
    .filter(function (f) { return exts.indexOf(String(f.FileExtension || '').toLowerCase()) >= 0; })
    .filter(keep_date)
    .sort(function (a, b) { return new Date(b.LastModifiedDate) - new Date(a.LastModifiedDate); })
    // Dedup by file (ContentDocumentId): keep one row per document — the newest, since we sorted first.
    // A broader OR'd search can surface the same file via several terms; this guarantees no repeats.
    .filter(function (f) { const k = f.ContentDocumentId || f.Id; if (seen_docs.has(k)) return false; seen_docs.add(k); return true; });

  if (files.length === 0) return [];

  // Program (event) enrichment via ContentDocumentLink: the program NAME comes straight off the
  // polymorphic LinkedEntity; the Sanction ID (a formula field on the Program object) needs a second
  // query against that object by its record id.
  const program_object = o.program_object || PROGRAM_OBJECT;
  const sanction_field = o.sanction_field || SANCTION_FIELD;
  const doc_ids = Array.from(new Set(files.map(function (f) { return f.ContentDocumentId; }).filter(Boolean)));
  const links = doc_ids.length ? await query_in_batches(conn, function (list) {
    return 'SELECT ContentDocumentId, LinkedEntityId, LinkedEntity.Type, LinkedEntity.Name ' +
      'FROM ContentDocumentLink WHERE ContentDocumentId IN (' + list + ')';
  }, doc_ids, o.max_fetch) : [];

  const program_by_doc = new Map();      // ContentDocumentId -> program (event) name
  const program_id_by_doc = new Map();   // ContentDocumentId -> Program record id
  links.forEach(function (link) {
    const le = link.LinkedEntity;
    if (le && le.Type === program_object && !program_by_doc.has(link.ContentDocumentId)) {
      program_by_doc.set(link.ContentDocumentId, le.Name || '');
      if (link.LinkedEntityId) program_id_by_doc.set(link.ContentDocumentId, link.LinkedEntityId);
    }
  });

  // Sanction IDs: query the Program object's Sanctioning ID formula field for the linked programs.
  // The object isn't always directly SOQL-queryable (depends on the connected user's perms/feature
  // licenses), so this degrades gracefully — a failed lookup just leaves sanction_id blank instead
  // of breaking the whole listing.
  const program_ids = Array.from(new Set(Array.from(program_id_by_doc.values()).filter(Boolean)));
  const sanction_by_program = new Map();
  if (program_ids.length) {
    try {
      const programs = await query_in_batches(conn, function (list) {
        return 'SELECT Id, ' + sanction_field + ' FROM ' + program_object + ' WHERE Id IN (' + list + ')';
      }, program_ids, o.max_fetch);
      programs.forEach(function (p) { sanction_by_program.set(p.Id, p[sanction_field] == null ? '' : String(p[sanction_field])); });
    } catch (e) {
      if (!o.quiet) console.error('[sf] sanction lookup skipped (' + program_object + '.' + sanction_field + '): ' + ((e && e.message) || e));
    }
  }

  // Owner names via User.
  const owner_ids = Array.from(new Set(files.map(function (f) { return f.CreatedById; }).filter(Boolean)));
  const users = owner_ids.length ? await query_in_batches(conn, function (list) {
    return 'SELECT Id, Name, Email FROM User WHERE Id IN (' + list + ')';
  }, owner_ids, o.max_fetch) : [];
  const owner_by_id = new Map();
  users.forEach(function (u) { owner_by_id.set(u.Id, u); });

  return files.map(function (f) {
    const program_name = program_by_doc.get(f.ContentDocumentId) || '';
    const sanction_id = sanction_by_program.get(program_id_by_doc.get(f.ContentDocumentId)) || '';
    const owner = owner_by_id.get(f.CreatedById) || {};
    return {
      content_version_id: f.Id,
      content_document_id: f.ContentDocumentId,
      title: f.Title,
      file_extension: f.FileExtension,
      file_type: f.FileType,
      created_date_utc: f.CreatedDate,
      last_modified_date_utc: f.LastModifiedDate,
      created_mtn_ymd: ymd_in_time_zone(f.CreatedDate, tz),
      modified_mtn_ymd: ymd_in_time_zone(f.LastModifiedDate, tz),
      modified_mtn_full: datetime_in_time_zone(f.LastModifiedDate, tz),
      program_name: program_name,
      sanction_id: sanction_id,
      owner_name: owner.Name || '',
      owner_email: owner.Email || '',
      target_name: build_download_file_name(f, program_name, owner.Name || '', sanction_id)
    };
  });
}

// Run a single read-only SOQL SELECT (jsforce `query` only executes SELECT — no DML) and return its
// records. Backs the CLI `sf:soql` discovery command (run as the integration user, who can see the
// files/objects a Workbench login often can't).
async function run_soql(conn, soql, max_fetch) {
  const result = await conn.query(String(soql)).execute({ autoFetch: true, maxFetch: max_fetch || MAX_FETCH });
  return (result && result.records) || [];
}

// Describe an sObject -> { name, label, fields:[{ name, label, type }] }. Backs `sf:describe` so you
// can confirm an object's real API name + its field API names (e.g. Program.cfg_Id__c).
async function describe_object(conn, name) {
  const meta = await conn.sobject(name).describe();
  return {
    name: meta.name,
    label: meta.label,
    fields: (meta.fields || []).map(function (fld) { return { name: fld.name, label: fld.label, type: fld.type }; })
  };
}

module.exports = { make_connection, list_race_results_files, query_in_batches, run_soql, describe_object, DEFAULT_SEARCH_TERM, DEFAULT_EXTS, PROGRAM_OBJECT, SANCTION_FIELD };

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

// Returns normalized records (newest first). opts: { search_term, filter, exts, tz, max_fetch }.
async function list_race_results_files(conn, opts) {
  const o = opts || {};
  const tz = (o.filter && o.filter.tz) || o.tz || DEFAULT_TZ;
  const exts = o.exts || DEFAULT_EXTS;
  const search_term = o.search_term || DEFAULT_SEARCH_TERM;

  const search_result = await conn.search(
    'FIND {' + search_term + '} IN ALL FIELDS RETURNING ContentVersion(' +
    'Id, ContentDocumentId, Title, FileExtension, FileType, FirstPublishLocationId, ' +
    'CreatedDate, LastModifiedDate, CreatedById ' +
    'ORDER BY LastModifiedDate DESC, CreatedDate DESC LIMIT 2000)'
  );

  const found = (search_result && search_result.searchRecords) || [];
  const keep_date = make_date_filter(o.filter || { mode: 'all', field: 'LastModifiedDate', tz: tz });

  const files = found
    .filter(function (f) { return exts.indexOf(String(f.FileExtension || '').toLowerCase()) >= 0; })
    .filter(keep_date)
    .sort(function (a, b) { return new Date(b.LastModifiedDate) - new Date(a.LastModifiedDate); });

  if (files.length === 0) return [];

  // Program names via ContentDocumentLink (Program objects aren't directly SOQL-queryable here).
  const doc_ids = Array.from(new Set(files.map(function (f) { return f.ContentDocumentId; }).filter(Boolean)));
  const links = doc_ids.length ? await query_in_batches(conn, function (list) {
    return 'SELECT ContentDocumentId, LinkedEntityId, LinkedEntity.Type, LinkedEntity.Name ' +
      'FROM ContentDocumentLink WHERE ContentDocumentId IN (' + list + ')';
  }, doc_ids, o.max_fetch) : [];

  const program_by_doc = new Map();
  links.forEach(function (link) {
    const le = link.LinkedEntity;
    if (le && le.Type === 'Program' && !program_by_doc.has(link.ContentDocumentId)) {
      program_by_doc.set(link.ContentDocumentId, le.Name || '');
    }
  });

  // Owner names via User.
  const owner_ids = Array.from(new Set(files.map(function (f) { return f.CreatedById; }).filter(Boolean)));
  const users = owner_ids.length ? await query_in_batches(conn, function (list) {
    return 'SELECT Id, Name, Email FROM User WHERE Id IN (' + list + ')';
  }, owner_ids, o.max_fetch) : [];
  const owner_by_id = new Map();
  users.forEach(function (u) { owner_by_id.set(u.Id, u); });

  return files.map(function (f) {
    const program_name = program_by_doc.get(f.ContentDocumentId) || '';
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
      owner_name: owner.Name || '',
      owner_email: owner.Email || '',
      target_name: build_download_file_name(f, program_name, owner.Name || '')
    };
  });
}

module.exports = { make_connection, list_race_results_files, query_in_batches, DEFAULT_SEARCH_TERM, DEFAULT_EXTS };

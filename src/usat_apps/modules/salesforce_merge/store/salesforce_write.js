'use strict';
// Phase 3b/4 — the ONLY module that WRITES to Salesforce. Everything else in the tool is read-only.
// Uses a dedicated WRITE connection (separate write-user env vars); if those are not set it falls
// back to the read-pipeline creds so a sandbox user that already has merge rights can be used for
// testing. merge() and undelete() go through jsforce's SOAP API (conn.soap). `connect` is injectable.
const { connect_salesforce } = require('../../../../../utilities/salesforce/salesforce_connect');

// Custom fields the optional "stamp survivor as merged" feature writes onto the master.
// These are NOT auto-created — an admin must add them in Salesforce. The stamp is best-effort:
// if they are missing the merge still succeeds and the run notes that the stamp was skipped.
const STAMP_FIELDS = { flag: 'usat_was_merged__c', date: 'usat_was_merged_date__c', by: 'usat_was_merged_by__c' };

function write_creds(is_test) {
  if (is_test) {
    return {
      url: process.env.SF_DEV_LOGIN_URL,
      user: process.env.SF_DEV_WRITE_USERNAME || process.env.SF_DEV_USERNAME,
      pass: process.env.SF_DEV_WRITE_PASSWORD || process.env.SF_DEV_PASSWORD,
      token: process.env.SF_DEV_WRITE_SECURITY_TOKEN || process.env.SF_DEV_SECURITY_TOKEN || '',
    };
  }
  return {
    url: process.env.SF_PROD_LOGIN_URL,
    user: process.env.SF_PROD_WRITE_USERNAME || process.env.SF_PROD_USERNAME,
    pass: process.env.SF_PROD_WRITE_PASSWORD || process.env.SF_PROD_PASSWORD,
    token: process.env.SF_PROD_WRITE_SECURITY_TOKEN || process.env.SF_PROD_SECURITY_TOKEN || '',
  };
}

function using_dedicated_write_user(is_test) {
  return !!(is_test ? process.env.SF_DEV_WRITE_USERNAME : process.env.SF_PROD_WRITE_USERNAME);
}

async function default_write_connect(is_test) {
  // OAuth (single External Client App run-as user) first; SOAP fallback honors a dedicated
  // write user (SF_*_WRITE_*) via role:'write'. write_creds/using_dedicated_write_user stay for the UI.
  const { conn } = await connect_salesforce({ is_test, role: 'write' });
  return conn;
}

const norm = (r) => ({ success: !!(r && r.success), id: r && r.id, errors: (r && r.errors) || [] });

// Merge a master with up to 2 losers in ONE SOAP merge call. `masterFields` (optional) sets
// survivorship values onto the master AS PART of the merge. Verify masterRecord shape in sandbox.
const _sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// Exponential backoff with jitter: ~0.8s, 1.6s, 3.2s, … (base overridable via env so tests run fast).
function _backoff(attempt) { const base = Number(process.env.MERGE_LOCK_BACKOFF_MS) || 800; return Math.round((2 ** (attempt - 1)) * base + Math.random() * (base / 2)); }
// Transient contention that's safe to retry — row locks, lock timeouts, deadlocks, dropped sockets.
// These get MORE likely when multiple workers merge in parallel and managed-package rollups (dlrs,
// Cirrus) touch shared parent records. Everything else (real validation errors) must fail immediately.
function _is_transient(msg) {
  return /UNABLE_TO_LOCK_ROW|unable to obtain exclusive access|lock timeout|deadlock|ECONNRESET|ETIMEDOUT|socket hang up|server unavailable/i.test(String(msg || ''));
}

async function merge_one(conn, masterId, loserIds, masterFields = {}) {
  if (!masterId) throw new Error('merge_one: masterId required');
  const losers = (loserIds || []).filter(Boolean).slice(0, 2);
  if (!losers.length) throw new Error('merge_one: at least one loser required');
  const masterRecord = { type: 'Account', Id: masterId, ...(masterFields || {}) };
  // Retry transient lock/connection contention with bounded backoff so parallel workers don't just fail
  // sets on UNABLE_TO_LOCK_ROW; non-transient (real validation) errors fail on the first try.
  const MAX_TRIES = Math.max(1, Number(process.env.MERGE_LOCK_RETRIES) || 4);
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
    let r = null;
    try {
      const res = await conn.soap.merge({ masterRecord, recordToMergeIds: losers });
      r = Array.isArray(res) ? res[0] : res;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_TRIES && _is_transient(err && err.message)) { await _sleep(_backoff(attempt)); continue; }
      throw err;
    }
    const errText = ((r && r.errors) || []).map((e) => (e && (e.statusCode || e.message)) || '').join('; ');
    if (r && r.success === false && attempt < MAX_TRIES && _is_transient(errText)) { lastErr = errText; await _sleep(_backoff(attempt)); continue; }
    return {
      success: !!(r && r.success),
      id: (r && r.id) || masterId,
      mergedRecordIds: (r && r.mergedRecordIds) || [],
      errors: (r && r.errors) || [],
      attempts: attempt,
    };
  }
  throw new Error('merge failed after ' + MAX_TRIES + ' attempts (transient contention): ' + String((lastErr && lastErr.message) || lastErr));
}

async function undelete(conn, ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return [];
  const res = await conn.soap.undelete(list);
  return (Array.isArray(res) ? res : [res]).map(norm);
}

async function update_record(conn, type, fields) {
  if (!fields || !fields.Id) throw new Error('update_record: Id required');
  const res = await conn.sobject(type).update(fields);
  return norm(res);
}

// Create a record (used by the recreate-from-backup restore path for records purged from the Recycle
// Bin). The new record gets a NEW Salesforce id — external references to the old id won't reconnect.
async function create_record(conn, type, fields) {
  if (!fields || Object.keys(fields).length === 0) throw new Error('create_record: fields required');
  const res = await conn.sobject(type).create(fields);
  return norm(res); // { success, id (new), errors }
}

// Delete a record (used to MOVE a file share on restore/recreate: a ContentDocumentLink's LinkedEntityId
// is not updateable, so a share is moved by creating a new link on the target and deleting the old one).
async function delete_record(conn, type, id) {
  if (!id) throw new Error('delete_record: id required');
  const res = await conn.sobject(type).destroy(id);
  const r = Array.isArray(res) ? res[0] : res;
  return { success: !!(r && (r.success == null ? true : r.success)), id: (r && r.id) || id, errors: (r && r.errors) || [] };
}

// Are the optional stamp fields present on Account for the connected user? (describe-based.) Used to
// notify the user before/after a run whether the "stamp survivor" option will actually write.
async function stamp_fields_status(conn) {
  try {
    const d = await conn.sobject('Account').describe();
    const names = new Set((d.fields || []).map((f) => f.name));
    return { usat_was_merged__c: names.has(STAMP_FIELDS.flag), usat_was_merged_date__c: names.has(STAMP_FIELDS.date), usat_was_merged_by__c: names.has(STAMP_FIELDS.by) };
  } catch (e) { return { usat_was_merged__c: false, usat_was_merged_date__c: false, usat_was_merged_by__c: false, error: e.message }; }
}

// Best-effort lifecycle stamp on the survivor Account, written on EVERY action (merge/restore/recreate).
// `action` is 'MERGE' | 'RESTORE' | 'RECREATE'. The flag reflects the current post-action state:
//   MERGE -> usat_was_merged__c = true (survivor is currently a merge product)
//   RESTORE / RECREATE -> false (the merge was undone / rebuilt)
// The date is the action time; the *_by__c text records "<ACTION> — <actor>" so the last action that
// touched the record is always legible. PER-FIELD + best-effort: describe once (or reuse `statusOpt`),
// write only the fields that exist, and never throw — a missing field or write error just means the
// action proceeds unstamped. Returns { stamped, count, skipped?, error?, payload? }.
async function stamp_survivor(conn, survivorId, action, actor, statusOpt) {
  if (!survivorId) return { stamped: false, count: 0, skipped: 'no survivor id' };
  try {
    const status = statusOpt || await stamp_fields_status(conn);
    const merged = String(action).toUpperCase() === 'MERGE';
    const payload = { Id: survivorId };
    if (status.usat_was_merged__c) payload.usat_was_merged__c = merged;
    if (status.usat_was_merged_date__c) payload.usat_was_merged_date__c = new Date().toISOString();
    if (status.usat_was_merged_by__c) payload.usat_was_merged_by__c = (String(action).toUpperCase() + ' — ' + (actor || 'salesforce_merge_tool')).slice(0, 255);
    const count = Object.keys(payload).length - 1; // minus Id
    if (count <= 0) return { stamped: false, count: 0, skipped: 'no stamp fields on Account' };
    await update_record(conn, 'Account', payload);
    return { stamped: true, count, payload };
  } catch (e) { return { stamped: false, count: 0, error: (e && e.message) || String(e) }; }
}

// Attach a file (the merge dossier) to one or more Salesforce records using Salesforce Files:
// ONE ContentVersion (the file) -> its ContentDocument -> a ContentDocumentLink per target record.
// So a single stored file is shared to many records (survivor + restored/recreated parents + children)
// with no duplication. Best-effort by design: returns per-link success and never throws, so a merge/
// restore is never failed by an attach problem (e.g. the write user lacks Content permissions).
// buffer: a Node Buffer of the .xlsx; recordIds: array of Salesforce record ids to link the file to.
async function attach_file(conn, filename, buffer, recordIds, opts = {}) {
  const out = { attached: false, content_version_id: null, content_document_id: null, links: [], errors: [] };
  try {
    const targets = [...new Set((recordIds || []).filter(Boolean))];
    if (!buffer || !targets.length) { out.errors.push('no buffer or no target records'); return out; }
    const cv = await conn.sobject('ContentVersion').create({
      Title: (opts.title || filename || 'Merge dossier').slice(0, 255),
      PathOnClient: filename || 'merge_dossier.xlsx',
      VersionData: Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64'),
      FirstPublishLocationId: opts.first_publish_location_id || undefined,
    });
    if (!cv || !cv.success || !cv.id) { out.errors.push('ContentVersion create failed'); return out; }
    out.content_version_id = cv.id;
    // The ContentDocumentId is derived by Salesforce from the ContentVersion.
    const q = await conn.query("SELECT ContentDocumentId FROM ContentVersion WHERE Id = '" + String(cv.id).replace(/'/g, '') + "'");
    const docId = q && q.records && q.records[0] && q.records[0].ContentDocumentId;
    if (!docId) { out.errors.push('could not resolve ContentDocumentId'); return out; }
    out.content_document_id = docId;
    for (const rid of targets) {
      try {
        // If the record was set as FirstPublishLocationId it is already linked; skip to avoid a dup-link error.
        if (opts.first_publish_location_id && rid === opts.first_publish_location_id) { out.links.push({ id: rid, success: true, note: 'primary' }); continue; }
        const link = await conn.sobject('ContentDocumentLink').create({ ContentDocumentId: docId, LinkedEntityId: rid, ShareType: 'V', Visibility: 'AllUsers' });
        out.links.push({ id: rid, success: !!(link && link.success) });
      } catch (le) { out.links.push({ id: rid, success: false, error: (le && le.message) || String(le) }); }
    }
    out.attached = out.links.some((l) => l.success);
    return out;
  } catch (e) { out.errors.push((e && e.message) || String(e)); return out; }
}

module.exports = {
  default_write_connect, write_creds, using_dedicated_write_user,
  merge_one, undelete, update_record, create_record, delete_record, stamp_fields_status, stamp_survivor, attach_file, STAMP_FIELDS,
  _is_transient,
};

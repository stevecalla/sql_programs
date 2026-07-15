'use strict';
// Phase 3b/4 — the ONLY module that WRITES to Salesforce. Everything else in the tool is read-only.
// Uses a dedicated WRITE connection (separate write-user env vars); if those are not set it falls
// back to the read-pipeline creds so a sandbox user that already has merge rights can be used for
// testing. merge() and undelete() go through jsforce's SOAP API (conn.soap). `connect` is injectable.
const jsforce = require('jsforce');

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
  const c = write_creds(is_test);
  if (!c.user || !c.pass) throw new Error('write credentials not configured for ' + (is_test ? 'sandbox' : 'production'));
  const conn = new jsforce.Connection({ loginUrl: c.url });
  await conn.login(c.user, c.pass + c.token);
  return conn;
}

const norm = (r) => ({ success: !!(r && r.success), id: r && r.id, errors: (r && r.errors) || [] });

// Merge a master with up to 2 losers in ONE SOAP merge call. `masterFields` (optional) sets
// survivorship values onto the master AS PART of the merge. Verify masterRecord shape in sandbox.
async function merge_one(conn, masterId, loserIds, masterFields = {}) {
  if (!masterId) throw new Error('merge_one: masterId required');
  const losers = (loserIds || []).filter(Boolean).slice(0, 2);
  if (!losers.length) throw new Error('merge_one: at least one loser required');
  const masterRecord = { type: 'Account', Id: masterId, ...(masterFields || {}) };
  const res = await conn.soap.merge({ masterRecord, recordToMergeIds: losers });
  const r = Array.isArray(res) ? res[0] : res;
  return {
    success: !!(r && r.success),
    id: (r && r.id) || masterId,
    mergedRecordIds: (r && r.mergedRecordIds) || [],
    errors: (r && r.errors) || [],
  };
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

// Are the optional stamp fields present on Account for the connected user? (describe-based.) Used to
// notify the user before/after a run whether the "stamp survivor" option will actually write.
async function stamp_fields_status(conn) {
  try {
    const d = await conn.sobject('Account').describe();
    const names = new Set((d.fields || []).map((f) => f.name));
    return { usat_was_merged__c: names.has(STAMP_FIELDS.flag), usat_was_merged_date__c: names.has(STAMP_FIELDS.date), usat_was_merged_by__c: names.has(STAMP_FIELDS.by) };
  } catch (e) { return { usat_was_merged__c: false, usat_was_merged_date__c: false, usat_was_merged_by__c: false, error: e.message }; }
}

module.exports = {
  default_write_connect, write_creds, using_dedicated_write_user,
  merge_one, undelete, update_record, create_record, stamp_fields_status, STAMP_FIELDS,
};

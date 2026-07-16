'use strict';
// Post-merge snapshot — captures the SURVIVOR's field values PLUS Salesforce's own LastModifiedDate at
// the moment a merge finished (after the merge write + the optional stamp). It is the third reference
// point that lets restore tell apart two kinds of change on the survivor:
//   · pre-merge snapshot → post-merge  = what the MERGE itself changed (normal; restore resets these)
//   · post-merge → now                 = what someone EDITED IN SALESFORCE after the merge (the risky ones)
// Comparing the SF LastModifiedDate we recorded here against the survivor's CURRENT LastModifiedDate is a
// cheap, clock-skew-free "was this touched since the merge?" test (SF's own clock, both sides).
// Keep-latest per queue entry. `query` injectable for tests. Written best-effort — never fails a merge.
const { query: real_query } = require('../../../store/db');
const { now_mtn_utc } = require('./timestamps');

const TABLE = 'salesforce_merge_postmerge_snapshot';

const PURPOSE = 'Post-merge survivor baseline: the surviving Account field values + Salesforce '
  + 'LastModifiedDate captured right after a merge finished, so a restore can detect (and diff) changes '
  + 'made to the survivor IN SALESFORCE after the merge — separate from what the merge itself changed. '
  + 'Keyed by queue_id; keep-latest. Read-only backstop.';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  " purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'," +
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' run_id VARCHAR(64) NOT NULL,' +
  ' queue_id INT,' +
  ' survivor_account VARCHAR(32) NOT NULL,' +
  ' source_type VARCHAR(24),' +
  ' source_key TEXT,' +
  ' fields LONGTEXT,' +                       // survivor field values as SF reported them post-merge
  ' sf_last_modified VARCHAR(40),' +          // SF LastModifiedDate at capture (the comparison baseline)
  ' created_at_mtn DATETIME NULL,' +
  ' created_at_utc DATETIME NULL' +
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  try { await query("ALTER TABLE `" + TABLE + "` ADD COLUMN purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'", []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN sf_last_modified VARCHAR(40)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_mtn DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_utc DATETIME NULL', []); } catch (e) { /* exists */ }
  _ensured = true;
}

// KEEP-LATEST per queue entry.
async function save(opts, query = real_query) {
  await ensure_table(query);
  const qid = opts && opts.queue_id != null ? Number(opts.queue_id) : null;
  const ts = now_mtn_utc();
  if (qid != null) await query('DELETE FROM `' + TABLE + '` WHERE queue_id = ?', [qid]);
  await query(
    'INSERT INTO `' + TABLE + '` (run_id, queue_id, survivor_account, source_type, source_key, fields, sf_last_modified, created_at_mtn, created_at_utc) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [String(opts.run_id || ''), qid, String(opts.survivor_account || ''), opts.source_type || null,
     String(opts.source_key || ''), JSON.stringify(opts.fields || {}), opts.sf_last_modified || null, ts.mtn, ts.utc]);
  return { saved: 1 };
}

const parseRow = (r) => (r ? { ...r, fields: (() => { try { return JSON.parse(r.fields); } catch (e) { return r.fields; } })() } : null);

// Latest post-merge snapshot for a queue entry (or null if none — e.g. a set merged before this feature).
async function get(queueId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE queue_id = ? ORDER BY id DESC LIMIT 1', [Number(queueId)]);
  return parseRow((rows || [])[0] || null);
}

// Clean up when a set is removed from the queue (mirrors baseline cleanup).
async function remove(queueId, query = real_query) {
  await ensure_table(query);
  await query('DELETE FROM `' + TABLE + '` WHERE queue_id = ?', [Number(queueId)]);
  return { ok: true };
}

module.exports = { save, get, remove, ensure_table, TABLE, DDL, PURPOSE };

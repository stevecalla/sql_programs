'use strict';
// Stage-time baseline — the field values of the accounts in a merge set AS THE USER REVIEWED THEM
// when the set was added to the queue. Kept per queue entry so the merge can, at process time,
// diff the live records against what was staged and flag anything that DRIFTED in between (e.g. an
// email edited after queueing). Read-only side table; never affects the merge write path.
const { query: real_query } = require('../../../store/db');
const { now_mtn_utc } = require('./timestamps');

const TABLE = 'salesforce_merge_stage_baseline';

// A self-documenting column value (visible in SELECT *) so future readers know what this table is for.
const PURPOSE = 'Stage-time field baseline for the merge drift check: the account field values a reviewer '
  + 'saw when a set was added to the merge queue. At process time the merge diffs live-vs-this to flag fields '
  + 'that changed since staging. One row per queued set (keyed by queue_id, keep-latest).';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  ' queue_id INT NOT NULL,' +
  ' fields LONGTEXT,' +                               // JSON: { [accountId]: { field: value, ... } }
  " purpose VARCHAR(320) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'," +
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' created_at_mtn DATETIME NULL,' +                  // Denver wall-clock, written by the app (event-table convention)
  ' created_at_utc DATETIME NULL,' +                  // UTC wall-clock, written by the app
  ' UNIQUE KEY uq_queue (queue_id)' +
  ") COMMENT='Stage-time field baseline for the merge drift check (live-vs-staged). One row per queued set.'";

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  // Additive columns for tables created before these existed (idempotent).
  try { await query("ALTER TABLE `" + TABLE + "` ADD COLUMN purpose VARCHAR(320) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'", []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_mtn DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_utc DATETIME NULL', []); } catch (e) { /* exists */ }
  _ensured = true;
}

// Upsert the baseline for a queue entry (keep-latest per queue_id).
async function save(queueId, map, query = real_query) {
  await ensure_table(query);
  const qid = Number(queueId);
  if (!Number.isFinite(qid)) return { saved: 0 };
  const json = JSON.stringify(map || {});
  const ts = now_mtn_utc();
  await query('DELETE FROM `' + TABLE + '` WHERE queue_id = ?', [qid]);
  await query('INSERT INTO `' + TABLE + '` (queue_id, fields, created_at_mtn, created_at_utc) VALUES (?, ?, ?, ?)',
    [qid, json, ts.mtn, ts.utc]);
  return { saved: 1, accounts: Object.keys(map || {}).length };
}

// Returns the stored { accountId: fields } map, or null when nothing was captured (e.g. bulk-added).
async function get(queueId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT fields FROM `' + TABLE + '` WHERE queue_id = ? LIMIT 1', [Number(queueId)]);
  if (!rows || !rows.length) return null;
  try { return JSON.parse(rows[0].fields) || null; } catch (e) { return null; }
}

module.exports = { save, get, ensure_table, TABLE, DDL, PURPOSE };

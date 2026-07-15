'use strict';
// Stage-time baseline — the field values of the accounts in a merge set AS THE USER REVIEWED THEM
// when the set was added to the queue. Kept per queue entry so the merge can, at process time,
// diff the live records against what was staged and flag anything that DRIFTED in between (e.g. an
// email edited after queueing). Read-only side table; never affects the merge write path.
const { query: real_query } = require('../../../store/db');

const TABLE = 'salesforce_merge_stage_baseline';
const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  ' queue_id INT NOT NULL,' +
  ' fields LONGTEXT,' +               // JSON: { [accountId]: { field: value, ... } }
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' UNIQUE KEY uq_queue (queue_id)' +
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  _ensured = true;
}

// Upsert the baseline for a queue entry (keep-latest per queue_id).
async function save(queueId, map, query = real_query) {
  await ensure_table(query);
  const qid = Number(queueId);
  if (!Number.isFinite(qid)) return { saved: 0 };
  const json = JSON.stringify(map || {});
  await query('DELETE FROM `' + TABLE + '` WHERE queue_id = ?', [qid]);
  await query('INSERT INTO `' + TABLE + '` (queue_id, fields) VALUES (?, ?)', [qid, json]);
  return { saved: 1, accounts: Object.keys(map || {}).length };
}

// Returns the stored { accountId: fields } map, or null when nothing was captured (e.g. bulk-added).
async function get(queueId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT fields FROM `' + TABLE + '` WHERE queue_id = ? LIMIT 1', [Number(queueId)]);
  if (!rows || !rows.length) return null;
  try { return JSON.parse(rows[0].fields) || null; } catch (e) { return null; }
}

module.exports = { save, get, ensure_table, TABLE, DDL };

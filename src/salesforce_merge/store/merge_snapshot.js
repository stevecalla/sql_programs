'use strict';
// Pre-merge snapshot — captures the FULL current state of every record in a merge set (survivor +
// losers) before a merge runs, so it can serve as the restore baseline. Written by the Phase 3
// process flow even in safe mode (so the backup pipeline is exercised). `query` injectable for tests.
const { query: real_query } = require('./db');

const TABLE = 'salesforce_merge_premerge_snapshot';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' run_id VARCHAR(64) NOT NULL,' +
  ' queue_id INT,' +
  ' source_type VARCHAR(24),' +
  ' source_key TEXT,' +
  ' role VARCHAR(12) NOT NULL,' +                 // 'survivor' | 'loser'
  ' account VARCHAR(32) NOT NULL,' +
  ' contact VARCHAR(32),' +
  ' fields LONGTEXT' +                            // JSON of the full deep-fetched record
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  _ensured = true;
}

// Save one row per account in the set; role is derived from the survivor id.
async function save(runId, entry, accounts, query = real_query) {
  await ensure_table(query);
  const rows = accounts || [];
  let saved = 0;
  for (const a of rows) {
    const role = a.account === entry.survivor_account ? 'survivor' : 'loser';
    await query(
      'INSERT INTO `' + TABLE + '` (run_id, queue_id, source_type, source_key, role, account, contact, fields) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [String(runId), entry.id != null ? Number(entry.id) : null, entry.source_type || null,
       String(entry.source_key || ''), role, String(a.account || ''), a.contact || null,
       JSON.stringify(a)]);
    saved += 1;
  }
  return { saved };
}

async function list_for_run(runId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE run_id = ? ORDER BY id', [String(runId)]);
  return (rows || []).map((r) => ({ ...r, fields: (() => { try { return JSON.parse(r.fields); } catch (e) { return r.fields; } })() }));
}

module.exports = { save, list_for_run, ensure_table, TABLE, DDL };

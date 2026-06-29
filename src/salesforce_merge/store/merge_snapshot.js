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
  ' role VARCHAR(12) NOT NULL,' +
  ' account VARCHAR(32) NOT NULL,' +
  ' contact VARCHAR(32),' +
  ' fields LONGTEXT' +
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  _ensured = true;
}

// Save the pre-merge state for a set: one row per account (role survivor/loser) PLUS one row per
// child record (role 'child', fields = {object,id,parent_field,parent_id}) so restore can re-point
// children later. KEEP-LATEST: clears this entry's prior snapshot first.
async function save(runId, entry, accounts, children = [], query = real_query) {
  await ensure_table(query);
  const qid = entry && entry.id != null ? Number(entry.id) : null;
  if (qid != null) await query('DELETE FROM `' + TABLE + '` WHERE queue_id = ?', [qid]);

  const ins = (role, account, contact, payload) => query(
    'INSERT INTO `' + TABLE + '` (run_id, queue_id, source_type, source_key, role, account, contact, fields) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [String(runId), qid, entry.source_type || null, String(entry.source_key || ''),
     role, String(account || ''), contact || null, JSON.stringify(payload)]);

  let accN = 0; let chN = 0;
  for (const a of (accounts || [])) {
    const role = a.account === entry.survivor_account ? 'survivor' : 'loser';
    await ins(role, a.account, a.contact, a);
    accN += 1;
  }
  for (const ch of (children || [])) {
    await ins('child', ch.account || ch.parent_id, null, ch);
    chN += 1;
  }
  return { saved: accN + chN, accounts: accN, children: chN };
}

async function list_for_entry(queueId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE queue_id = ? ORDER BY id', [Number(queueId)]);
  return (rows || []).map((r) => ({ ...r, fields: (() => { try { return JSON.parse(r.fields); } catch (e) { return r.fields; } })() }));
}

async function list_for_run(runId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE run_id = ? ORDER BY id', [String(runId)]);
  return (rows || []).map((r) => ({ ...r, fields: (() => { try { return JSON.parse(r.fields); } catch (e) { return r.fields; } })() }));
}

module.exports = { save, list_for_run, list_for_entry, ensure_table, TABLE, DDL };

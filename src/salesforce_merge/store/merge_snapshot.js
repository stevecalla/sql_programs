'use strict';
// Pre-merge snapshot — captures the FULL current state of every record in a merge set (survivor +
// losers) before a merge runs, plus each child record, so it can serve as the restore baseline.
// Written on every run (even simulate). `query` injectable for tests.
const { query: real_query } = require('./db');

const TABLE = 'salesforce_merge_premerge_snapshot';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' run_id VARCHAR(64) NOT NULL,' +
  ' queue_id INT,' +
  ' source_type VARCHAR(24),' +
  ' source_key TEXT,' +
  ' role VARCHAR(12) NOT NULL,' +                 // 'survivor' | 'loser' | 'child'
  ' account VARCHAR(32) NOT NULL,' +              // owning account id (for 'child' rows too)
  ' contact VARCHAR(32),' +
  ' child_type VARCHAR(20),' +                    // child rows: 'child' | 'self_account' | 'self_contact'
  ' child_object VARCHAR(80),' +                  // child rows: SObject API name
  ' fields LONGTEXT,' +
  ' survivor_account VARCHAR(32)' +               // the set's surviving master id (same for every row in the set)
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN child_type VARCHAR(20)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN child_object VARCHAR(80)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN survivor_account VARCHAR(32)', []); } catch (e) { /* exists */ }
  _ensured = true;
}

// KEEP-LATEST: clears this entry's prior snapshot first. Each row records the set's survivor_account.
async function save(runId, entry, accounts, children = [], query = real_query) {
  await ensure_table(query);
  const qid = entry && entry.id != null ? Number(entry.id) : null;
  const surv = String(entry.survivor_account || '');
  if (qid != null) await query('DELETE FROM `' + TABLE + '` WHERE queue_id = ?', [qid]);

  const ins = (role, account, contact, childType, childObject, payload) => query(
    'INSERT INTO `' + TABLE + '` (run_id, queue_id, source_type, source_key, role, account, contact, child_type, child_object, fields, survivor_account) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [String(runId), qid, entry.source_type || null, String(entry.source_key || ''),
     role, String(account || ''), contact || null, childType || null, childObject || null, JSON.stringify(payload), surv]);

  let accN = 0; let chN = 0;
  for (const a of (accounts || [])) {
    const role = a.account === entry.survivor_account ? 'survivor' : 'loser';
    await ins(role, a.account, a.contact, null, null, a);
    accN += 1;
  }
  for (const ch of (children || [])) {
    await ins('child', ch.account || ch.parent_id, null, ch.child_type || 'child', ch.object || null, ch);
    chN += 1;
  }
  return { saved: accN + chN, accounts: accN, children: chN };
}

const parseRow = (r) => ({ ...r, fields: (() => { try { return JSON.parse(r.fields); } catch (e) { return r.fields; } })() });

async function list_for_entry(queueId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE queue_id = ? ORDER BY id', [Number(queueId)]);
  return (rows || []).map(parseRow);
}

async function list_for_run(runId, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE run_id = ? ORDER BY id', [String(runId)]);
  return (rows || []).map(parseRow);
}

// Recent snapshot rows for the browse table (newest first). Capped.
async function list_recent(limit = 500, query = real_query) {
  await ensure_table(query);
  const n = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000);
  const rows = await query('SELECT id, created_at, run_id, queue_id, role, child_type, child_object, account, survivor_account, contact, fields FROM `' + TABLE + '` ORDER BY id DESC LIMIT ' + n, []);
  const list = rows || [];
  // Names live on the account (survivor/loser) rows; map account id -> name so child rows can show
  // the name of the account they belong to (children have no Name of their own).
  const nameByAccount = {};
  for (const r of list) {
    if (r.role === 'child') continue;
    try { const fobj = JSON.parse(r.fields); if (fobj && (fobj.Name || fobj.name)) nameByAccount[r.account] = fobj.Name || fobj.name; } catch (e) { /* non-JSON */ }
  }
  return list.map((r) => ({
    run_id: r.run_id, queue_id: r.queue_id, role: r.role, name: nameByAccount[r.account] || '',
    survivor_account: r.survivor_account, account: r.account,
    child_type: r.child_type, child_object: r.child_object, contact: r.contact,
    field: r.fields || '', created_at: r.created_at,
  }));
}

module.exports = { save, list_for_run, list_for_entry, list_recent, ensure_table, TABLE, DDL };

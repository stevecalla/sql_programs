'use strict';
// Merge queue — staging + approval ledger for merge sets assembled in Merge Admin. NOT a Salesforce
// write: it records intent + the reviewer's decision (survivor, losers, overrides, child counts) in a
// local table. Lifecycle: queued -> approved -> (Phase 3) processing -> done/failed -> restored.
// Rows are never auto-cleared (audit + restore baseline). `query` is injectable for tests.
const { query: real_query } = require('../../../store/db');
const { now_mtn_utc } = require('./timestamps');
const cfg = require('../../../../salesforce_duplicates/config');

const TABLE = 'salesforce_merge_queue';

// Self-documenting column (visible in SELECT *) so future readers know what this table is for.
const PURPOSE = 'Staged merge sets: one row per set (chosen survivor, losing accounts, per-field overrides, '
  + 'child counts, environment/org lineage, status queued->approved->done/failed/restored/recreated). Drives '
  + 'Select Merges + Process Merges; never auto-cleared (audit + restore baseline).';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  " purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'," +
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' created_by VARCHAR(120),' +
  ' source_type VARCHAR(24) NOT NULL,' +
  ' source_key TEXT NOT NULL,' +
  ' survivor_account VARCHAR(32) NOT NULL,' +
  ' survivor_contact VARCHAR(32),' +
  ' survivor_name VARCHAR(255),' +
  ' loser_accounts TEXT NOT NULL,' +
  ' loser_count INT NOT NULL DEFAULT 0,' +
  ' master_rule VARCHAR(60),' +
  ' status VARCHAR(20) NOT NULL DEFAULT "queued",' +
  ' notes TEXT,' +
  ' environment VARCHAR(20),' +
  ' org_id VARCHAR(32),' +
  ' field_overrides TEXT,' +
  ' child_counts TEXT,' +
  ' created_at_mtn DATETIME NULL,' +              // Denver wall-clock, written by the app (event-table convention)
  ' created_at_utc DATETIME NULL' +               // UTC wall-clock, written by the app
  ')';

const COLS = 'id, created_at, created_by, source_type, source_key, survivor_account, ' +
  'survivor_contact, survivor_name, loser_accounts, loser_count, master_rule, status, notes, ' +
  'environment, org_id, field_overrides, child_counts, created_at_mtn, created_at_utc';

function as_losers(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v || '').split(';').map((s) => s.trim()).filter(Boolean);
}
const as_json = (v) => (v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v)));
const from_json = (v) => { if (v == null || v === '') return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return v; } };

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  try { await query("ALTER TABLE `" + TABLE + "` ADD COLUMN purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'", []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` MODIFY source_key TEXT NOT NULL', []); } catch (e) { /* ok */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN survivor_name VARCHAR(255)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN field_overrides TEXT', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN child_counts TEXT', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN environment VARCHAR(20)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN org_id VARCHAR(32)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_mtn DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_utc DATETIME NULL', []); } catch (e) { /* exists */ }
  _ensured = true;
}

async function add(entry, query = real_query) {
  await ensure_table(query);
  const losers = as_losers(entry.loser_accounts);
  // Guard against re-adding a set on the basis of its LATEST lifecycle state for this
  // source_key + survivor:
  //   · queued / approved  -> already staged (can't double-stage)
  //   · done / recreated   -> already merged and NOT since restored (the losers are deleted;
  //                            re-merging is meaningless until a restore brings them back)
  //   · restored / failed  -> re-addable (restore is the supported re-merge path; failed can retry)
  const last = await query(
    'SELECT status FROM `' + TABLE + '` WHERE source_key = ? AND survivor_account = ? ORDER BY id DESC LIMIT 1',
    [String(entry.source_key || ''), String(entry.survivor_account || '')]);
  const st = (last && last.length) ? String(last[0].status) : null;
  if (st === 'queued' || st === 'approved') {
    const e = new Error('This set is already in the merge queue — remove it first to re-add.');
    e.code = 'DUPLICATE';
    throw e;
  }
  if (st === 'done' || st === 'recreated') {
    const e = new Error('This set has already been merged — restore it first to re-merge.');
    e.code = 'MERGED';
    throw e;
  }
  const ts = now_mtn_utc();
  const res = await query(
    'INSERT INTO `' + TABLE + '` (created_by, source_type, source_key, survivor_account, ' +
    'survivor_contact, loser_accounts, loser_count, master_rule, status, notes, survivor_name, ' +
    'environment, org_id, field_overrides, child_counts, created_at_mtn, created_at_utc) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [entry.created_by || null, entry.source_type || 'group', String(entry.source_key || ''),
     String(entry.survivor_account || ''), entry.survivor_contact || null,
     losers.join(';'), losers.length, entry.master_rule || null, 'queued', entry.notes || null, entry.survivor_name || null,
     entry.environment || null, entry.org_id || null, as_json(entry.field_overrides), as_json(entry.child_counts), ts.mtn, ts.utc]);
  return { id: (res && res.insertId) || null, loser_count: losers.length };
}

async function list(query = real_query, status = null) {
  await ensure_table(query);
  const filtered = status && status !== 'all';
  const where = filtered ? 'WHERE q.status = ? ' : '';
  const params = filtered ? [String(status)] : [];
  const rows = await query(
    'SELECT q.*, ' +
    "TRIM(CONCAT(COALESCE(s.first_name, ''), ' ', COALESCE(s.last_name, ''))) AS snapshot_name " +
    'FROM `' + TABLE + '` q LEFT JOIN `' + cfg.SNAPSHOT_TABLE_NAME + '` s ON s.salesforce_account_id = q.survivor_account ' +
    where + 'ORDER BY q.id DESC', params);
  return (rows || []).map((r) => ({
    ...r,
    survivor_name: r.survivor_name || r.snapshot_name || '',
    field_overrides: from_json(r.field_overrides),
    child_counts: from_json(r.child_counts),
  }));
}

async function set_status(ids, status, query = real_query) {
  await ensure_table(query);
  const idlist = (Array.isArray(ids) ? ids : [ids]).map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (!idlist.length) return { updated: 0 };
  const ph = idlist.map(() => '?').join(', ');
  const res = await query('UPDATE `' + TABLE + "` SET status = ? WHERE id IN (" + ph + ") AND status = 'queued'",
    [String(status)].concat(idlist));
  return { updated: (res && (res.affectedRows != null ? res.affectedRows : res.changedRows)) || 0 };
}

async function transition(ids, toStatus, fromStatuses, query = real_query) {
  await ensure_table(query);
  const idlist = (Array.isArray(ids) ? ids : [ids]).map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (!idlist.length) return { updated: 0 };
  const ph = idlist.map(() => '?').join(', ');
  let sql = 'UPDATE `' + TABLE + '` SET status = ? WHERE id IN (' + ph + ')';
  const params = [String(toStatus)].concat(idlist);
  if (fromStatuses && fromStatuses.length) {
    sql += ' AND status IN (' + fromStatuses.map(() => '?').join(', ') + ')';
    params.push(...fromStatuses.map(String));
  }
  const res = await query(sql, params);
  return { updated: (res && (res.affectedRows != null ? res.affectedRows : res.changedRows)) || 0 };
}

// Update just the child_counts for a queued row — used to backfill the authoritative live count
// asynchronously after the row is inserted, so the "Add to queue" click isn't blocked by a SF query.
async function set_child_counts(id, child_counts, query = real_query) {
  await ensure_table(query);
  if (id == null) return { updated: 0 };
  const res = await query('UPDATE `' + TABLE + '` SET child_counts = ? WHERE id = ?', [as_json(child_counts), Number(id)]);
  return { updated: (res && (res.affectedRows != null ? res.affectedRows : 0)) || 0 };
}

async function get(id, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT * FROM `' + TABLE + '` WHERE id = ?', [Number(id)]);
  const r = rows && rows[0];
  if (!r) return null;
  return { ...r, field_overrides: from_json(r.field_overrides), child_counts: from_json(r.child_counts) };
}

async function remove(id, query = real_query) {
  await ensure_table(query);
  await query("DELETE FROM `" + TABLE + "` WHERE id = ? AND status IN ('queued', 'approved')", [Number(id)]);
  return { ok: true };
}

async function add_many(entries, query = real_query) {
  await ensure_table(query);
  let queued = 0, skipped = 0, merged = 0;
  const added = [];   // { id, entry } for each newly-inserted set (used to capture stage baselines)
  for (const e of (entries || [])) {
    try { const r = await add(e, query); queued += 1; added.push({ id: r && r.id, entry: e }); }
    catch (err) {
      if (err && err.code === 'DUPLICATE') skipped += 1;
      else if (err && err.code === 'MERGED') merged += 1;
      else throw err;
    }
  }
  return { queued, skipped, merged, added };
}

module.exports = { add, add_many, list, set_status, transition, set_child_counts, get, remove, ensure_table, as_losers, as_json, from_json, TABLE, DDL };

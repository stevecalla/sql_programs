'use strict';
// Merge queue — staging + approval ledger for merge sets assembled in Merge Admin. NOT a Salesforce
// write: it records intent + the reviewer's decision (survivor, losers, overrides, child counts) in a
// local table. Lifecycle: queued -> approved -> (Phase 3) processing -> done/failed -> restored.
// Rows are never auto-cleared (audit + restore baseline). `query` is injectable for tests.
const { query: real_query } = require('./db');
const cfg = require('../../salesforce_duplicates/config');

const TABLE = 'salesforce_merge_queue';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
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
  ' field_overrides TEXT,' +
  ' child_counts TEXT' +
  ')';

const COLS = 'id, created_at, created_by, source_type, source_key, survivor_account, ' +
  'survivor_contact, survivor_name, loser_accounts, loser_count, master_rule, status, notes, ' +
  'field_overrides, child_counts';

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
  try { await query('ALTER TABLE `' + TABLE + '` MODIFY source_key TEXT NOT NULL', []); } catch (e) { /* ok */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN survivor_name VARCHAR(255)', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN field_overrides TEXT', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN child_counts TEXT', []); } catch (e) { /* exists */ }
  _ensured = true;
}

// A set is identified by source_key + survivor while still pending (queued OR approved) — the same
// records can't be staged twice; remove the existing entry to re-add. A done set can be re-queued.
async function add(entry, query = real_query) {
  await ensure_table(query);
  const losers = as_losers(entry.loser_accounts);
  const dup = await query(
    'SELECT id FROM `' + TABLE + "` WHERE source_key = ? AND survivor_account = ? AND status IN ('queued', 'approved') LIMIT 1",
    [String(entry.source_key || ''), String(entry.survivor_account || '')]);
  if (dup && dup.length) {
    const e = new Error('This set is already in the merge queue — remove it first to re-add.');
    e.code = 'DUPLICATE';
    throw e;
  }
  const res = await query(
    'INSERT INTO `' + TABLE + '` (created_by, source_type, source_key, survivor_account, ' +
    'survivor_contact, loser_accounts, loser_count, master_rule, status, notes, survivor_name, ' +
    'field_overrides, child_counts) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [entry.created_by || null, entry.source_type || 'group', String(entry.source_key || ''),
     String(entry.survivor_account || ''), entry.survivor_contact || null,
     losers.join(';'), losers.length, entry.master_rule || null, 'queued', entry.notes || null, entry.survivor_name || null,
     as_json(entry.field_overrides), as_json(entry.child_counts)]);
  return { id: (res && res.insertId) || null, loser_count: losers.length };
}

// list, optionally filtered by status ('queued' default in the UI; 'all'/null = every status).
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

// Approve: move queued entries to 'approved' (the human gate before Phase 3 execution). Only queued
// rows transition; already-approved/done rows are untouched.
async function set_status(ids, status, query = real_query) {
  await ensure_table(query);
  const idlist = (Array.isArray(ids) ? ids : [ids]).map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (!idlist.length) return { updated: 0 };
  const ph = idlist.map(() => '?').join(', ');
  const res = await query('UPDATE `' + TABLE + "` SET status = ? WHERE id IN (" + ph + ") AND status = 'queued'",
    [String(status)].concat(idlist));
  return { updated: (res && (res.affectedRows != null ? res.affectedRows : res.changedRows)) || 0 };
}

// Remove un-stages a queued OR approved entry; done/restored rows are kept (audit + restore).
async function remove(id, query = real_query) {
  await ensure_table(query);
  await query("DELETE FROM `" + TABLE + "` WHERE id = ? AND status IN ('queued', 'approved')", [Number(id)]);
  return { ok: true };
}

// Bulk add — insert many entries, skipping ones already queued/approved.
async function add_many(entries, query = real_query) {
  await ensure_table(query);
  let queued = 0, skipped = 0;
  for (const e of (entries || [])) {
    try { await add(e, query); queued += 1; }
    catch (err) { if (err && err.code === 'DUPLICATE') skipped += 1; else throw err; }
  }
  return { queued, skipped };
}

module.exports = { add, add_many, list, set_status, remove, ensure_table, as_losers, as_json, from_json, TABLE, DDL };

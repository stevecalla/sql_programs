'use strict';
// Merge queue — staging table for merge sets the user assembles in Merge Admin. This is NOT a
// Salesforce write: it only records intent (survivor + losers + provenance) in a NEW local table
// so Phase 3 can later process the queue behind the write chokepoint. `query` is injectable for tests.
const { query: real_query } = require('./db');

const TABLE = 'salesforce_merge_queue';

// source_key holds a consolidated-cluster key (can be long: name|birthdate|zip…) so it is TEXT.
const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' created_by VARCHAR(120),' +
  ' source_type VARCHAR(24) NOT NULL,' +          // 'group' (consolidated cluster) | 'merge_id'
  ' source_key TEXT NOT NULL,' +                  // cluster key or merge id
  ' survivor_account VARCHAR(32) NOT NULL,' +
  ' survivor_contact VARCHAR(32),' +
  ' loser_accounts TEXT NOT NULL,' +              // ';'-joined account ids
  ' loser_count INT NOT NULL DEFAULT 0,' +
  ' master_rule VARCHAR(60),' +                   // how the survivor was chosen
  ' status VARCHAR(20) NOT NULL DEFAULT "queued",' +
  ' notes TEXT' +
  ')';

const COLS = 'id, created_at, created_by, source_type, source_key, survivor_account, ' +
  'survivor_contact, loser_accounts, loser_count, master_rule, status, notes';

function as_losers(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v || '').split(';').map((s) => s.trim()).filter(Boolean);
}

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  // widen source_key on pre-existing tables created as VARCHAR(255) (idempotent; ignore failures)
  try { await query('ALTER TABLE `' + TABLE + '` MODIFY source_key TEXT NOT NULL', []); } catch (e) { /* ok */ }
  _ensured = true;
}

// A set is identified by its source_key + survivor while still queued — the same records can't be
// queued twice; the user removes the existing entry to re-add (e.g. with a different selection).
async function add(entry, query = real_query) {
  await ensure_table(query);
  const losers = as_losers(entry.loser_accounts);
  const dup = await query(
    'SELECT id FROM `' + TABLE + '` WHERE source_key = ? AND survivor_account = ? AND status = "queued" LIMIT 1',
    [String(entry.source_key || ''), String(entry.survivor_account || '')]);
  if (dup && dup.length) {
    const e = new Error('This set is already in the merge queue — remove it first to re-add.');
    e.code = 'DUPLICATE';
    throw e;
  }
  const res = await query(
    'INSERT INTO `' + TABLE + '` (created_by, source_type, source_key, survivor_account, ' +
    'survivor_contact, loser_accounts, loser_count, master_rule, status, notes) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [entry.created_by || null, entry.source_type || 'group', String(entry.source_key || ''),
     String(entry.survivor_account || ''), entry.survivor_contact || null,
     losers.join(';'), losers.length, entry.master_rule || null, 'queued', entry.notes || null]);
  return { id: (res && res.insertId) || null, loser_count: losers.length };
}

async function list(query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT ' + COLS + ' FROM `' + TABLE + '` ORDER BY id DESC', []);
  return rows || [];
}

async function remove(id, query = real_query) {
  await ensure_table(query);
  await query('DELETE FROM `' + TABLE + '` WHERE id = ?', [Number(id)]);
  return { ok: true };
}

module.exports = { add, list, remove, ensure_table, as_losers, TABLE, DDL };

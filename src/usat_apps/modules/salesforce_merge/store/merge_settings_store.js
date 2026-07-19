'use strict';
// Phase 2 (parallel workers) — DB persistence for the operational merge settings, so an admin can tune
// them live (via the Merge Ops panel) with NO env-var edits or redeploy. This is the `source` behind the
// pure resolver in merge_settings.js: values resolve DB -> env -> default. Injectable executor for tests.
const { query: real_query } = require('../../../store/db');
const { now_mtn_utc } = require('./timestamps');
const msettings = require('./merge_settings');

const TABLE = 'salesforce_merge_settings';
const PURPOSE = 'Live operational settings for the merge tool (parallel workers): one row per key. The '
  + 'resolver reads DB here first, then env, then a hard default — so admins tune it without a redeploy.';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' skey VARCHAR(64) PRIMARY KEY,' +
  " purpose VARCHAR(300) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'," +
  ' sval VARCHAR(255) NULL,' +
  ' updated_by VARCHAR(128) NULL,' +
  ' updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +   // auto operational timestamp (server tz)
  ' updated_at_mtn DATETIME NULL,' +             // Denver wall-clock of the LAST save (app-written)
  ' updated_at_utc DATETIME NULL,' +             // UTC wall-clock of the last save
  ' created_at_mtn DATETIME NULL,' +             // Denver wall-clock of FIRST create (app-written; preserved)
  ' created_at_utc DATETIME NULL' +              // UTC wall-clock of first create
  ')';

let _ensured = false;
async function ensure(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  // Idempotent adds so a pre-existing table gains the standard wall-clock columns (every table carries them).
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN updated_at_mtn DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN updated_at_utc DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_mtn DATETIME NULL', []); } catch (e) { /* exists */ }
  try { await query('ALTER TABLE `' + TABLE + '` ADD COLUMN created_at_utc DATETIME NULL', []); } catch (e) { /* exists */ }
  // One-time self-heal: force the wall-clock tail order (updated_at_mtn/utc then created_at_mtn/utc, with
  // created_at_* LAST) when ADD COLUMN appended them out of order. Guarded on ordinal so the (COPY) reorder
  // runs only when needed; never blocks boot.
  try {
    const need = ['updated_at_mtn', 'updated_at_utc', 'created_at_mtn', 'created_at_utc'];
    const pos = await query("SELECT COLUMN_NAME AS c, ORDINAL_POSITION AS p FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN ('updated_at_mtn','updated_at_utc','created_at_mtn','created_at_utc')", [TABLE]);
    const m = {}; (Array.isArray(pos) ? pos : []).forEach((r) => { if (r && r.c) m[r.c] = Number(r.p); });
    const haveAll = need.every((k) => m[k]);
    const ordered = haveAll && need.every((k, i) => i === 0 || m[need[i - 1]] < m[k]);
    if (haveAll && !ordered) {
      await query('ALTER TABLE `' + TABLE + '` MODIFY COLUMN updated_at_mtn DATETIME NULL AFTER updated_at', []);
      await query('ALTER TABLE `' + TABLE + '` MODIFY COLUMN updated_at_utc DATETIME NULL AFTER updated_at_mtn', []);
      await query('ALTER TABLE `' + TABLE + '` MODIFY COLUMN created_at_mtn DATETIME NULL AFTER updated_at_utc', []);
      await query('ALTER TABLE `' + TABLE + '` MODIFY COLUMN created_at_utc DATETIME NULL AFTER created_at_mtn', []);
    }
  } catch (e) { /* best-effort ordering — never blocks boot */ }
  _ensured = true;
}

// Raw stored values as a { key: string } map (only keys present in the table).
async function get_all_raw(query = real_query) {
  await ensure(query);
  const rows = await query('SELECT skey, sval FROM `' + TABLE + '`', []);
  const out = {};
  (rows || []).forEach((r) => { if (r && r.skey != null) out[r.skey] = r.sval; });
  return out;
}

// A `source(key)` function for merge_settings.resolve(), backed by ONE table read cached for this call
// batch (so resolving all keys doesn't hit the DB per key). Pass a fresh source per request.
async function make_source(query = real_query) {
  const raw = await get_all_raw(query);
  return (key) => (Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : null);
}

// Resolve ONE key (DB -> env -> default) using the pure resolver + the DB source.
async function get(key, query = real_query) {
  const source = await make_source(query);
  return msettings.get(key, source);
}

// Resolve EVERY known key -> { value, source, def, kind } for the admin panel.
async function get_all(query = real_query) {
  const source = await make_source(query);
  return msettings.get_all(source);
}

// The most-recent SAVE time across all settings (updated_at_mtn), as the app-written MTN wall-clock string.
// DATE_FORMAT keeps it MTN (a raw DATETIME would be tz-shifted by the driver). null when nothing saved yet.
async function last_saved(query = real_query) {
  await ensure(query);
  const rows = await query("SELECT DATE_FORMAT(MAX(updated_at_mtn), '%Y-%m-%d %H:%i:%s') AS m FROM `" + TABLE + '`', []);
  return (rows && rows[0] && rows[0].m) || null;
}

// Persist one setting (admin PUT). The value is COERCED + CLAMPED through the pure spec before storing, so
// only valid values ever land in the table. Unknown keys are rejected. Returns { key, stored }.
async function set(key, rawValue, actor, query = real_query) {
  await ensure(query);
  if (!msettings.spec(key)) throw new Error('unknown setting: ' + key);
  const coerced = msettings.coerce(key, rawValue);
  const stored = String(coerced);
  const ts = now_mtn_utc();
  // created_at_mtn/utc = FIRST create (set on insert, PRESERVED on update). updated_at_mtn/utc = LAST save
  // (refreshed every write). "Last saved" in the panel reads updated_at_mtn.
  await query(
    'INSERT INTO `' + TABLE + '` (skey, sval, updated_by, updated_at, updated_at_mtn, updated_at_utc, created_at_mtn, created_at_utc) VALUES (?, ?, ?, NOW(), ?, ?, ?, ?) '
    + 'ON DUPLICATE KEY UPDATE sval = VALUES(sval), updated_by = VALUES(updated_by), updated_at = NOW(), '
    + 'updated_at_mtn = VALUES(updated_at_mtn), updated_at_utc = VALUES(updated_at_utc)',
    [String(key), stored, actor || null, ts.mtn, ts.utc, ts.mtn, ts.utc]);
  return { key, stored: coerced };
}

// Persist several settings at once (admin PUT of the whole form). Ignores unknown keys. Returns the
// coerced values that were stored.
async function set_many(obj, actor, query = real_query) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    if (!msettings.spec(k)) continue;
    const r = await set(k, obj[k], actor, query);
    out[k] = r.stored;
  }
  return out;
}

module.exports = { ensure, get, get_all, get_all_raw, make_source, set, set_many, last_saved, TABLE, DDL };

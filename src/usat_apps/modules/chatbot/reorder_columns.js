'use strict';
// One-shot, IDEMPOTENT fix for an EXISTING chatbot_conversations table: put created_at_mtn before
// created_at_utc. `CREATE TABLE IF NOT EXISTS` never restructures a table that already exists, so a table
// created by the original (utc-first) DDL keeps that order until this ALTER runs. Safe to run repeatedly;
// on a fresh DB the table is already mtn-first and this is a no-op. Values are untouched — order only.
//
//   node src/usat_apps/modules/chatbot/reorder_columns.js
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const db = require('../../store/db');
const store = require('./conversations');

async function main() {
  const TABLE = store.TABLE;
  await store.ensure();   // make sure the table exists (fresh DBs get mtn-first automatically)
  console.log('Reordering ' + TABLE + ' so created_at_mtn precedes created_at_utc…');
  await db.query(
    'ALTER TABLE ' + TABLE +
    ' MODIFY COLUMN created_at_mtn DATETIME NOT NULL AFTER is_test,' +
    ' MODIFY COLUMN created_at_utc DATETIME NOT NULL AFTER created_at_mtn'
  );
  const cols = await db.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [TABLE]
  );
  console.log('\nColumn order now:');
  cols.forEach(function (c, i) { console.log('  ' + (i + 1) + '. ' + (c.COLUMN_NAME || c.column_name)); });
  console.log('\nDone. (Values were not changed — order only.)');
  try { if (db.end) await db.end(); } catch (e) { /* ignore */ }
}
main().then(function () { process.exit(0); }).catch(function (e) { console.error('ERROR:', (e && e.message) || e); process.exit(1); });

#!/usr/bin/env node
'use strict';
/**
 * history_test_rows.js — seed or clear SAMPLE rows (ran_by='test') in event_coi_submission_history so you
 * can try the history feature without running the portal. Prints the equivalent MySQL so you can copy it
 * into Workbench if you like. Non-PII sample data only.
 *
 *   node src/usat_apps/modules/event_coi/history_test_rows.js seed    # insert 2 sample runs
 *   node src/usat_apps/modules/event_coi/history_test_rows.js clear   # delete the sample runs
 *
 * Reads DB creds from repo-root .env; does NOT need the :8023 server running.
 */
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* optional */ }
const history = require('./store/submission_history');
const db = require('../../store/db');

const DB = process.env.LOCAL_USAT_SALES_DB || 'usat_sales_db';
const T = '`' + DB + '`.`event_coi_submission_history`';
const mode = String(process.argv[2] || 'seed').toLowerCase();

const SAMPLES = [
  { ran_by: 'test', event_name: 'Sample Tri', event_sanction_id: '123456', requested: 12, submitted: 10, failed: 0, skipped: 2, status: 'partial' },
  { ran_by: 'test', event_name: 'Sample 10K', event_sanction_id: '222222', requested: 3, submitted: 3, failed: 0, skipped: 0, status: 'completed' },
];

async function seed() {
  for (const s of SAMPLES) {
    const a = await history.record_start({ ran_by: s.ran_by, event_name: s.event_name, event_sanction_id: s.event_sanction_id, certificates_requested: s.requested });
    await history.record_finish(a.id, { status: s.status, submitted: s.submitted, failed: s.failed, skipped: s.skipped });
  }
  console.log("\n  Seeded " + SAMPLES.length + " sample run(s) (ran_by='test').");
  const vals = SAMPLES.map((s) => "    ('" + s.ran_by + "','" + s.event_name + "','" + s.event_sanction_id + "'," +
    s.requested + ',' + s.submitted + ',' + s.failed + ',' + s.skipped + ",'" + s.status + "',NOW(),NOW(),NOW(),UTC_TIMESTAMP())").join(',\n');
  console.log('\n  Equivalent MySQL (copy into Workbench):\n');
  console.log('    INSERT INTO ' + T + '\n' +
    '      (ran_by, event_name, event_sanction_id, certificates_requested, certificates_submitted,\n' +
    '       certificates_failed, certificates_skipped, status, started_at, finished_at, created_at_mtn, created_at_utc)\n' +
    '    VALUES\n' + vals + ';');
}

async function clear() {
  const r = await db.query('DELETE FROM `' + DB + '`.`event_coi_submission_history` WHERE ran_by = ?', ['test']);
  console.log("\n  Deleted " + ((r && r.affectedRows) || 0) + " sample run(s) (ran_by='test').");
  console.log('\n  Equivalent MySQL (copy into Workbench):\n');
  console.log('    DELETE FROM ' + T + " WHERE ran_by = 'test';");
}

async function main() {
  try {
    if (mode === 'clear') await clear(); else await seed();
  } catch (e) { console.error('  history test-rows error — is MySQL reachable? (' + ((e && e.message) || e) + ')'); process.exit(1); }
  console.log('');
  try { await db.end(); } catch (e) { /* ignore */ }
  process.exit(0);
}
main();

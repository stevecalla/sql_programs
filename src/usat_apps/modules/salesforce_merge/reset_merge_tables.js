'use strict';
// RESET the merge tool's working tables for a clean test run.
//
// Clears ONLY the merge tool's own tables (queue + the three snapshots + history + run log + dossier
// copies). It does NOT touch the read-only duplicates finder data (salesforce_account_duplicate_snapshot
// and salesforce_duplicate_*), which is the INPUT you merge from — leave those so you still have sets to test.
//
// SANDBOX / testing use. This is destructive (empties the tables). Dry-run by default; --apply to clear.
//
//   node modules/salesforce_merge/reset_merge_tables.js            # dry run — shows row counts, changes nothing
//   node modules/salesforce_merge/reset_merge_tables.js --apply    # actually clear the tables
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }
const { query } = require('../../store/db');

// Order doesn't matter (no cross-table FKs), but grouped logically.
const TABLES = [
  'salesforce_merge_queue',              // staged / approved / done / restored sets
  'salesforce_merge_stage_baseline',     // staging-time field baseline (drift)
  'salesforce_merge_premerge_snapshot',  // full pre-merge backup (survivor/loser/child)
  'salesforce_merge_postmerge_snapshot', // survivor state right after a merge
  'salesforce_merge_history',            // the audit log (incl. dossier links)
  'salesforce_merge_run',                // run/progress logbook
  'salesforce_merge_dossier',            // the DB copies of the dossier .xlsx files
];

async function clear(t) {
  try { await query('TRUNCATE TABLE `' + t + '`', []); return 'truncated'; }
  catch (e) { await query('DELETE FROM `' + t + '`', []); return 'deleted (no TRUNCATE priv)'; }
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log('\n' + (apply ? 'CLEARING' : 'DRY RUN — would clear') + ' the merge tool tables:\n');
  for (const t of TABLES) {
    try {
      const c = await query('SELECT COUNT(*) AS n FROM `' + t + '`', []);
      const n = (c && c[0] && c[0].n) || 0;
      if (apply) { const how = await clear(t); console.log('  ✓ ' + t.padEnd(38) + n + ' rows ' + how); }
      else console.log('  • ' + t.padEnd(38) + n + ' rows');
    } catch (e) { console.log('  ! ' + t.padEnd(38) + 'skipped (' + e.message + ')'); }
  }
  console.log('\nLeft untouched (the finder INPUT): salesforce_account_duplicate_snapshot + salesforce_duplicate_*');
  if (!apply) console.log('\nRe-run with --apply to actually clear them.\n');
  else console.log('\nDone — merge tool state is reset. (Salesforce records/files are separate; clean those in SF.)\n');
  process.exit(0);
}
main().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });

'use strict';
// export_corrections.js — dump salesforce_email_queue_corrections to a JSON file in the SAME shape
// import_corrections.js reads (an array of {id, created_at, active, scope, author, queue, case_id,
// question, note}). Use it to snapshot one environment's corrections, copy the JSON to another env, then run
// import_corrections.js --commit there (idempotent upsert by id). Symmetric with the importer — safe to
// re-run; overwrites the export file each time.
//
//   node src/usat_apps/modules/salesforce_email_queue/export_corrections.js                 # -> <data_dir>/corrections_export.json
//   node src/usat_apps/modules/salesforce_email_queue/export_corrections.js /path/out.json  # explicit output file
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const fs = require('fs');
const db = require('../../store/db');
const store = require('../../services/corrections/mysql_store');   // TABLE + create_store (ensures the table)
const data_dir = require('../../services/knowledge/data_dir');

function to_iso(v) { if (v == null) return ''; if (v instanceof Date) return v.toISOString(); const s = String(v); return s.length >= 10 ? s.replace(' ', 'T') : s; }

async function main() {
  const argv = process.argv.slice(2);
  const pathArg = argv.filter(function (a) { return a.indexOf('--') !== 0; })[0];
  const file = pathArg || process.env.EQ_CORRECTIONS_EXPORT || data_dir.file_sync('corrections_export.json');

  await store.create_store();   // make sure the table exists
  const rows = await db.query(
    'SELECT id, created_at, active, scope, author, queue, case_id, question, note FROM ' + store.TABLE + ' ORDER BY created_at ASC'
  );
  const out = (rows || []).map(function (r) {
    return {
      id: String(r.id), created_at: to_iso(r.created_at), active: (r.active === 0 || r.active === false) ? 0 : 1,
      scope: r.scope || 'global', author: r.author || '', queue: r.queue || '', case_id: r.case_id || '',
      question: r.question || '', note: r.note || '',
    };
  });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');

  console.log('Exported ' + out.length + ' correction(s) from ' + store.TABLE);
  console.log('  file: ' + file);
  console.log('\nNext: copy this file to the target environment and import (idempotent upsert by id):');
  console.log('  node src/usat_apps/modules/salesforce_email_queue/import_corrections.js "' + file + '"            # DRY RUN');
  console.log('  node src/usat_apps/modules/salesforce_email_queue/import_corrections.js "' + file + '" --commit   # import');
  try { if (db.end) await db.end(); } catch (e) { /* ignore */ }
}
main().then(function () { process.exit(0); }).catch(function (e) { console.error('ERROR:', (e && e.message) || e); process.exit(1); });

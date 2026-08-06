'use strict';
// export_urls.js — dump knowledge_sources + knowledge_chunks to a JSON file for EXACT-parity transfer to
// another environment. import_urls.js reads { sources:[...], chunks:[...] } and upserts each source + replaces
// its chunks verbatim (preserving category, seq, text, excluded flags, and timestamps). Overwrites the file.
//   node src/usat_apps/knowledge_sync/export_urls.js                 # -> <data_dir>/knowledge_urls_export.json
//   node src/usat_apps/knowledge_sync/export_urls.js /path/out.json  # explicit output file
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const fs = require('fs');
const db = require('../store/db');
const store = require('../services/knowledge/chunk_store');   // SOURCES / CHUNKS names + ensure()
const data_dir = require('../services/knowledge/data_dir');

// DATETIME columns exported as literal wall-clock strings so they round-trip with no timezone drift.
function DT(col) { return "DATE_FORMAT(`" + col + "`, '%Y-%m-%d %H:%i:%s') `" + col + "`"; }

async function main() {
  const argv = process.argv.slice(2);
  const pathArg = argv.filter(function (a) { return a.indexOf('--') !== 0; })[0];
  const file = pathArg || process.env.KNOWLEDGE_URLS_EXPORT || data_dir.file_sync('knowledge_urls_export.json');

  await store.ensure();   // ensure both tables exist
  const sources = await db.query(
    'SELECT source_ref, source_type, source_title, scope, queue, status, `error`, needs_js, chunk_count, bytes, added_by, snapshot_path, ' +
    DT('fetched_at_mtn') + ', ' + DT('fetched_at_utc') + ', ' + DT('created_at_mtn') + ', ' + DT('created_at_utc') +
    ' FROM ' + store.SOURCES + ' ORDER BY id ASC');
  const chunks = await db.query(
    'SELECT chunk_id, source_ref, source_type, source_title, scope, queue, category, seq, `text`, char_len, excluded, embed_model, ' +
    DT('fetched_at_mtn') + ', ' + DT('fetched_at_utc') + ', ' + DT('created_at_mtn') + ', ' + DT('created_at_utc') +
    ' FROM ' + store.CHUNKS + ' ORDER BY source_ref, seq ASC');

  const out = { exported_at: new Date().toISOString(), source_count: (sources || []).length, chunk_count: (chunks || []).length, sources: sources || [], chunks: chunks || [] };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');

  console.log('Exported ' + out.source_count + ' source(s) + ' + out.chunk_count + ' chunk(s) from ' + store.SOURCES + ' / ' + store.CHUNKS);
  console.log('  file: ' + file);
  console.log('\nNext: copy to the target env and import (exact parity - upsert sources, replace chunks):');
  console.log('  node src/usat_apps/knowledge_sync/import_urls.js "' + file + '"            # DRY RUN');
  console.log('  node src/usat_apps/knowledge_sync/import_urls.js "' + file + '" --commit   # import');
  try { if (db.end) await db.end(); } catch (e) { /* ignore */ }
}
main().then(function () { process.exit(0); }).catch(function (e) { console.error('ERROR:', (e && e.message) || e); process.exit(1); });

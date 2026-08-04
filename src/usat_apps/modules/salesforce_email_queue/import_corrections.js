'use strict';
// import_corrections.js — one-shot, IDEMPOTENT import of the standalone (8019) app's corrections.json into
// the platform DB table salesforce_email_queue_corrections. Run at CUTOVER, AFTER 8019 is stopped, so no new
// corrections can be written to the JSON after the import runs (see the cutover runbook).
//
// The records are field-identical between the JSON and the table
// (id, created_at, active, scope, author, queue, case_id, question, note), and each has a stable string
// `id`, so this upserts by id: a dry-run then a real run, or two real runs, are safe and produce no dups.
//
//   node src/usat_apps/modules/salesforce_email_queue/import_corrections.js            # DRY RUN (default; no writes)
//   node src/usat_apps/modules/salesforce_email_queue/import_corrections.js --commit   # actually import
//   node .../import_corrections.js /path/to/corrections.json [--commit]                # explicit source file
//
// Source resolution when no path arg is given: EQ_CORRECTIONS_FILE > <data_dir>/corrections.json — the SAME
// path the 8019 app writes (services/knowledge/data_dir.file_sync mirrors the POC's data_dir).
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const fs = require('fs');
const db = require('../../store/db');
const store = require('../../services/corrections/mysql_store');   // TABLE, DDL, create_store (ensures the table)
const data_dir = require('../../services/knowledge/data_dir');

function to_sql_dt(iso) { const s = String(iso || '').slice(0, 19).replace('T', ' '); return s || null; }
async function safe_end() { try { if (db.end) await db.end(); } catch (e) { /* ignore */ } }

async function main() {
  const argv = process.argv.slice(2);
  const commit = argv.indexOf('--commit') >= 0;
  const pathArg = argv.filter(function (a) { return a.indexOf('--') !== 0; })[0];
  const file = pathArg || process.env.EQ_CORRECTIONS_FILE || data_dir.file_sync('corrections.json');

  console.log('Corrections import — ' + (commit ? 'COMMIT' : 'DRY RUN (no writes)'));
  console.log('  source file : ' + file);
  console.log('  target table: ' + store.TABLE + '\n');

  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.error('Cannot read source file: ' + e.message); process.exit(1); }
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { console.error('Source is not valid JSON: ' + e.message); process.exit(1); }
  if (!Array.isArray(arr)) { console.error('Expected a JSON array of correction records.'); process.exit(1); }

  // Normalize + validate: every row needs a stable id and a non-empty note.
  const recs = [];
  let invalid = 0;
  for (const e of arr) {
    const note = String((e && e.note) || '').trim();
    const id = (e && e.id != null) ? String(e.id) : '';
    if (!note || !id) { invalid++; continue; }
    recs.push({
      id: id,
      created_at: to_sql_dt(e.created_at) || to_sql_dt(new Date().toISOString()),
      active: (e.active === 0 || e.active === false) ? 0 : 1,
      scope: e.scope || 'global',
      author: e.author || '',
      queue: e.queue || '',
      case_id: e.case_id || '',
      question: e.question || '',
      note: note,
    });
  }
  // De-dupe within the file by id (keep the last occurrence).
  const byId = new Map();
  for (const r of recs) byId.set(r.id, r);
  const unique = Array.from(byId.values());

  // File-side analysis (no DB needed) — always shown so a dry run validates the file even with no DB.
  console.log('  records in file  : ' + arr.length);
  console.log('  valid (id+note)  : ' + recs.length + (invalid ? '   (skipped ' + invalid + ' without id/note)' : ''));
  console.log('  unique by id     : ' + unique.length);

  if (!commit) {
    // Try the DB to show new-vs-existing, but a DRY RUN still succeeds (and validates the file) with no DB.
    try {
      await store.create_store();
      const existing = new Set((await db.query('SELECT id FROM ' + store.TABLE)).map(function (r) { return String(r.id); }));
      const already = unique.filter(function (r) { return existing.has(r.id); }).length;
      console.log('  already in table : ' + already);
      console.log('  NEW to insert    : ' + (unique.length - already));
    } catch (e) {
      console.log('  (could not reach the DB to compare: ' + e.message + ')');
      console.log('  NEW to insert    : up to ' + unique.length + ' (assuming an empty / new table)');
    }
    console.log('\nDRY RUN — nothing written. Re-run with --commit to import (idempotent upsert by id).');
    await safe_end();
    return;
  }

  // COMMIT — the DB is required here.
  await store.create_store();
  const existing = new Set((await db.query('SELECT id FROM ' + store.TABLE)).map(function (r) { return String(r.id); }));
  let ins = 0, upd = 0;
  for (const r of unique) {
    await db.query(
      'INSERT INTO ' + store.TABLE + ' (id, created_at, active, scope, author, queue, case_id, question, note) VALUES (?,?,?,?,?,?,?,?,?) ' +
      'ON DUPLICATE KEY UPDATE created_at=VALUES(created_at), active=VALUES(active), scope=VALUES(scope), author=VALUES(author), queue=VALUES(queue), case_id=VALUES(case_id), question=VALUES(question), note=VALUES(note)',
      [r.id, r.created_at, r.active, r.scope, r.author, r.queue, r.case_id, r.question, r.note]
    );
    if (existing.has(r.id)) upd++; else ins++;
  }
  const total = (await db.query('SELECT COUNT(*) c FROM ' + store.TABLE))[0].c;
  console.log('  already in table : ' + upd);
  console.log('  NEW inserted     : ' + ins);
  console.log('\nImported. inserted=' + ins + '  updated=' + upd + '  — table now holds ' + total + ' row(s).');
  console.log('Keep corrections.json as a backup — this import is idempotent and safe to re-run.');
  await safe_end();
}

main().then(function () { process.exit(0); }).catch(function (e) { console.error('ERROR:', (e && e.message) || e); process.exit(1); });

'use strict';
// import_urls.js — EXACT-parity import of knowledge_sources + knowledge_chunks from export_urls.js JSON.
// Upserts each source (by its unique source_ref+scope+queue) and REPLACES that source's chunks (delete then
// insert verbatim) - preserving category/seq/text/excluded flags and timestamps. Dry-run by default.
//   node src/usat_apps/knowledge_sync/import_urls.js "file.json"            # DRY RUN
//   node src/usat_apps/knowledge_sync/import_urls.js "file.json" --commit   # import
// Source resolution when no path arg: KNOWLEDGE_URLS_FILE > <data_dir>/knowledge_urls_export.json
// Note: the reserved `embedding` BLOB column is not transferred (unused/NULL today); everything else verbatim.
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const fs = require('fs');
const db = require('../store/db');
const store = require('../services/knowledge/chunk_store');
const data_dir = require('../services/knowledge/data_dir');

async function safe_end() { try { if (db.end) await db.end(); } catch (e) { /* ignore */ } }
function ck(o) { return String(o.source_ref || '') + '::' + String(o.scope || '') + '::' + String(o.queue || ''); }

const SRC_COLS = ['source_ref', 'source_type', 'source_title', 'scope', 'queue', 'status', 'error', 'needs_js', 'chunk_count', 'bytes', 'added_by', 'snapshot_path', 'fetched_at_mtn', 'fetched_at_utc', 'created_at_mtn', 'created_at_utc'];
const CHK_COLS = ['chunk_id', 'source_ref', 'source_type', 'source_title', 'scope', 'queue', 'category', 'seq', 'text', 'char_len', 'excluded', 'embed_model', 'fetched_at_mtn', 'fetched_at_utc', 'created_at_mtn', 'created_at_utc'];
function bt(cols) { return cols.map(function (c) { return '`' + c + '`'; }).join(','); }
function ph(n) { return Array(n).fill('?').join(','); }
function vals(cols, row) { return cols.map(function (c) { return row[c] === undefined ? null : row[c]; }); }

async function main() {
  const argv = process.argv.slice(2);
  const commit = argv.indexOf('--commit') >= 0;
  const pathArg = argv.filter(function (a) { return a.indexOf('--') !== 0; })[0];
  const file = pathArg || process.env.KNOWLEDGE_URLS_FILE || data_dir.file_sync('knowledge_urls_export.json');

  console.log('Knowledge URLs import - ' + (commit ? 'COMMIT' : 'DRY RUN (no writes)'));
  console.log('  source file : ' + file);
  console.log('  target      : ' + store.SOURCES + ' + ' + store.CHUNKS + '\n');

  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('Cannot read source file: ' + e.message); process.exit(1); }
  let doc; try { doc = JSON.parse(raw); } catch (e) { console.error('Source is not valid JSON: ' + e.message); process.exit(1); }
  const sources = Array.isArray(doc.sources) ? doc.sources : [];
  const chunks = Array.isArray(doc.chunks) ? doc.chunks : [];
  if (!sources.length && !chunks.length) { console.error('No sources/chunks in the file.'); process.exit(1); }

  const chunksByKey = {};
  chunks.forEach(function (c) { const k = ck(c); (chunksByKey[k] = chunksByKey[k] || []).push(c); });

  console.log('  sources in file : ' + sources.length);
  console.log('  chunks in file  : ' + chunks.length);

  if (!commit) {
    console.log('\nDRY RUN - nothing written. Re-run with --commit to import (upsert sources, replace each source chunks).');
    await safe_end(); return;
  }

  await store.ensure();
  const upd = SRC_COLS.filter(function (c) { return c !== 'source_ref' && c !== 'scope' && c !== 'queue'; }).map(function (c) { return '`' + c + '`=VALUES(`' + c + '`)'; }).join(', ');
  let sUp = 0, cIns = 0;
  for (const s of sources) {
    await db.query('INSERT INTO ' + store.SOURCES + ' (' + bt(SRC_COLS) + ') VALUES (' + ph(SRC_COLS.length) + ') ON DUPLICATE KEY UPDATE ' + upd, vals(SRC_COLS, s));
    sUp++;
    await db.query('DELETE FROM ' + store.CHUNKS + ' WHERE source_ref = ? AND scope = ? AND queue = ?', [s.source_ref, s.scope || '', s.queue || '']);
    const cs = chunksByKey[ck(s)] || [];
    for (const c of cs) {
      await db.query('INSERT INTO ' + store.CHUNKS + ' (' + bt(CHK_COLS) + ') VALUES (' + ph(CHK_COLS.length) + ')', vals(CHK_COLS, c));
      cIns++;
    }
  }
  const sTot = (await db.query('SELECT COUNT(*) c FROM ' + store.SOURCES))[0].c;
  const cTot = (await db.query('SELECT COUNT(*) c FROM ' + store.CHUNKS))[0].c;
  console.log('  sources upserted : ' + sUp);
  console.log('  chunks inserted  : ' + cIns);
  console.log('\nImported. ' + store.SOURCES + ' now holds ' + sTot + ' row(s); ' + store.CHUNKS + ' holds ' + cTot + ' row(s).');
  console.log('\nVerify in MySQL (same DB the platform uses):');
  console.log('  SELECT COUNT(*) FROM ' + store.SOURCES + ';   SELECT COUNT(*) FROM ' + store.CHUNKS + ';');
  await safe_end();
}
main().then(function () { process.exit(0); }).catch(function (e) { console.error('ERROR:', (e && e.message) || e); process.exit(1); });

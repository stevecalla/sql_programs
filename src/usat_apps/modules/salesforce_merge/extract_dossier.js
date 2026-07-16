'use strict';
// Extract a merge dossier (.xlsx) from MySQL to your Downloads folder. Lists the recent dossiers, prompts
// for an id (or take it as an arg), and writes the stored workbook blob to <home>/Downloads/<filename>.
// Byte-exact (writes the raw Buffer) — unlike a mysql-CLI '>' redirect, which corrupts the file on Windows.
// Read-only on the database.
//
//   node src/usat_apps/modules/salesforce_merge/extract_dossier.js          # interactive: list + pick
//   node src/usat_apps/modules/salesforce_merge/extract_dossier.js 123      # non-interactive: id 123
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { query } = require('../../store/db');

async function main() {
  let id = process.argv[2];
  const list = await query('SELECT id, action, survivor_name, filename, byte_size, created_at_mtn FROM salesforce_merge_dossier ORDER BY id DESC LIMIT 30', []);
  if (!list.length) { console.log('No dossiers found in salesforce_merge_dossier.'); process.exit(0); }
  console.log('\nRecent dossiers (newest first):');
  for (const r of list) {
    console.log('  #' + String(r.id).padStart(4) + '  ' + String(r.action || '').padEnd(9) + (String(r.byte_size || 0) + ' B').padEnd(9) + '  ' + (r.created_at_mtn || '') + '  ' + r.filename);
  }
  if (!id) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    id = (await new Promise((res) => rl.question('\nEnter a dossier id to download to Downloads (blank to cancel): ', res))).trim();
    rl.close();
    if (!id) { console.log('Cancelled.'); process.exit(0); }
  }
  const rows = await query('SELECT filename, workbook FROM salesforce_merge_dossier WHERE id = ?', [Number(id)]);
  if (!rows.length || !rows[0].workbook) { console.log('No dossier (or no bytes) for id ' + id + '.'); process.exit(1); }
  const dir = path.join(os.homedir(), 'Downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* exists */ }
  const out = path.join(dir, rows[0].filename);
  fs.writeFileSync(out, rows[0].workbook);
  console.log('\n✓ wrote ' + out + '  (' + rows[0].workbook.length + ' bytes)');
  process.exit(0);
}
main().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });

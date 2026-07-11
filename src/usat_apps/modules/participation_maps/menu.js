#!/usr/bin/env node
'use strict';
/**
 * menu.js — participation_maps module operations (data pipeline + reference).
 *
 *   node src/usat_apps/modules/participation_maps/menu.js
 *
 * Rebuilds the shared participation data the map reads — region_data, ZIP/Census reference tables,
 * summary/flows/events, and the BigQuery load — and shows the current build scope. Launched from the
 * platform menu (src/usat_apps/menu.js -> PARTICIPATION MAPS -> Data pipeline & ops), or run directly.
 *
 * The pipeline scripts are REPO-LEVEL and app-agnostic (src/participation_data/*, reload_region_data.js,
 * show_build_scope.js) — they build the tables any consumer reads, so they survive /reporting's retirement.
 * Self-contained (Node readline, no extra packages); mirrors src/usat_apps/menu.js.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PREFS_FILE = path.join(__dirname, '.menu_prefs.json');

const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m';
const c = (color, t) => `${color}${t}${RESET}`;

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) { /* defaults */ } }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) { /* ignore */ } }
function prompt(rl, q) { return new Promise((res) => rl.question(q, res)); }

function run_cmd(bin, args, label) {
  console.log(c(DIM, `  Running: ${bin} ${args.join(' ')}  (cwd: repo root)  (Ctrl-C to stop)\n`));
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    proc.on('close', (code) => { console.log(code === 0 ? c(GREEN, `\n  ✓ ${label} done.`) : c(RED, `\n  ✗ ${label} exited (${code}).`)); resolve(code); });
  });
}
function open_url(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  try { execSync(cmd, { stdio: 'ignore' }); console.log(c(DIM, `  Opened ${url}`)); }
  catch { console.log(`  Open manually: ${url}`); }
}

const SECTIONS = [
  { label: 'DATA PIPELINE', color: YELLOW, items: [
    { id: 1, label: 'Reload region_data (from CSV)', desc: 'MySQL: drop + recreate region_data from the usat_region_data CSV (state / region / lat-lng). Run after editing the CSV, before step 3i.', bin: 'node', args: ['reload_region_data.js'], cli: 'node reload_region_data.js' },
    { id: 2, label: 'Create ZIP reference table (step 2b)', desc: 'MySQL: rebuild zip_lat_lng_reference (ZIP -> lat/lng/city/state/county) from BigQuery public data.', bin: 'node', args: ['src/participation_data/step_2b_load_zip_reference.js'], cli: 'node src/participation_data/step_2b_load_zip_reference.js' },
    { id: 3, label: 'Create Census population table (step 2c)', desc: 'MySQL: rebuild census_state_population. US Census API (needs CENSUS_API_KEY) or BigQuery 2021 fallback. Powers penetration / per-capita.', bin: 'node', args: ['src/participation_data/step_2c_load_census_population.js'], cli: 'node src/participation_data/step_2c_load_census_population.js' },
    { id: 4, label: 'Build participation summary (step 3i - full)', desc: 'MySQL: rebuild summary + flows + events from the base data (all years). Heavy.', bin: 'node', args: ['src/participation_data/step_3i_create_participation_summary.js'], cli: 'node src/participation_data/step_3i_create_participation_summary.js' },
    { id: 5, label: 'Build participation summary - TEST (2024 & 2025)', desc: 'Same as step 3i but TEST mode (2024 & 2025 only) - faster dev run, same tables, less data.', bin: 'node', args: ['src/participation_data/step_3i_create_participation_summary.js', 'test'], cli: 'node src/participation_data/step_3i_create_participation_summary.js test' },
    { id: 6, label: 'Load metrics to BigQuery (step 3j)', desc: 'Upload summary / flows / events tables to BigQuery (WRITE_TRUNCATE).', bin: 'node', args: ['src/participation_data/step_3j_load_bq_participation_summary_metrics.js'], cli: 'node src/participation_data/step_3j_load_bq_participation_summary_metrics.js' },
    { id: 7, label: 'Show data build scope (test vs full)', desc: 'Print the scope recorded by step 3i - TEST (2024 & 2025) vs FULL, year range, and built-at.', bin: 'node', args: ['show_build_scope.js'], cli: 'node show_build_scope.js' },
  ] },
  { label: 'REFERENCE', color: GREEN, items: [
    { id: 8, label: 'Census API - get a free key', desc: 'US Census API key signup. Add as CENSUS_API_KEY in .env for current ACS 1-yr population in step 2c.', open: 'https://api.census.gov/data/key_signup.html', cli: 'open https://api.census.gov/data/key_signup.html' },
    { id: 9, label: 'About the Census ACS 1-year data', desc: 'US Census ACS 1-year docs - source of the state population used for penetration / per-capita.', open: 'https://www.census.gov/data/developers/data-sets/acs-1year.html', cli: 'open https://www.census.gov/data/developers/data-sets/acs-1year.html' },
  ] },
];
const ALL = SECTIONS.flatMap((s) => s.items);

function print_menu() {
  console.clear();
  console.log(c(BOLD + CYAN, '\n  USAT Apps · Participation maps'));
  console.log(c(DIM, '  ─────────────────────────────────\n'));
  for (const s of SECTIONS) {
    console.log(c(s.color + BOLD, `  ${s.label}`));
    for (const it of s.items) {
      console.log(`  ${c(BOLD, String(it.id).padStart(3) + '.')} ${it.label.padEnd(46)} ${c(DIM, it.desc)}`);
      if (_show_cli && it.cli) console.log('       ' + c(DIM, '$ ' + it.cli));
    }
    console.log('');
  }
  console.log('  ' + c(BOLD + YELLOW, '[t]') + c(DIM, ` toggle CLI (${_show_cli ? 'on' : 'off'})    `) + c(BOLD + YELLOW, '[q]') + c(DIM, ' back / quit') + c(DIM, '    (or 0)'));
}

async function main() {
  load_prefs();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  while (true) {
    print_menu();
    const ans = (await prompt(rl, c(BOLD, '\n  Select: '))).trim().toLowerCase();
    if (ans === 'q' || ans === 'quit' || ans === 'b' || ans === 'back' || ans === '0') { console.log(c(DIM, '\n  Back.')); rl.close(); return; }
    if (ans === 't') { _show_cli = !_show_cli; save_prefs(); continue; }
    const it = ALL.find((x) => x.id === parseInt(ans, 10));
    console.log('');
    if (!it) console.log(c(YELLOW, '  Invalid choice.'));
    else if (it.bin) await run_cmd(it.bin, it.args, it.label);
    else if (it.open) open_url(it.open);
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { SECTIONS, ALL };

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
 *
 * DATA-ONLY: rendering, numbering (by position — never hand-write an id), the CLI toggle, spawn, and quit
 * handling all come from the shared kit. See utilities/menu/menu_kit.js + plans_and_notes/MENU_CONVENTIONS.md.
 */
const path = require('path');
const { runMenu, COLORS } = require('../../../../utilities/menu/menu_kit');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const SECTIONS = [
  { label: 'DATA PIPELINE', color: 'YELLOW', items: [
    { label: 'Reload region_data (from CSV)', desc: 'MySQL: drop + recreate region_data from the usat_region_data CSV (state / region / lat-lng). Run after editing the CSV, before step 3i.', bin: 'node', args: ['reload_region_data.js'], cli: 'node reload_region_data.js' },
    { label: 'Create ZIP reference table (step 2b)', desc: 'MySQL: rebuild zip_lat_lng_reference (ZIP -> lat/lng/city/state/county) from BigQuery public data.', bin: 'node', args: ['src/participation_data/step_2b_load_zip_reference.js'], cli: 'node src/participation_data/step_2b_load_zip_reference.js' },
    { label: 'Create Census population table (step 2c)', desc: 'MySQL: rebuild census_state_population. US Census API (needs CENSUS_API_KEY) or BigQuery 2021 fallback. Powers penetration / per-capita.', bin: 'node', args: ['src/participation_data/step_2c_load_census_population.js'], cli: 'node src/participation_data/step_2c_load_census_population.js' },
    { label: 'Build participation summary (step 3i - full)', desc: 'MySQL: rebuild summary + flows + events from the base data (all years). Heavy.', bin: 'node', args: ['src/participation_data/step_3i_create_participation_summary.js'], cli: 'node src/participation_data/step_3i_create_participation_summary.js' },
    { label: 'Build participation summary - TEST (2024 & 2025)', desc: 'Same as step 3i but TEST mode (2024 & 2025 only) - faster dev run, same tables, less data.', bin: 'node', args: ['src/participation_data/step_3i_create_participation_summary.js', 'test'], cli: 'node src/participation_data/step_3i_create_participation_summary.js test' },
    { label: 'Load metrics to BigQuery (step 3j)', desc: 'Upload summary / flows / events tables to BigQuery (WRITE_TRUNCATE).', bin: 'node', args: ['src/participation_data/step_3j_load_bq_participation_summary_metrics.js'], cli: 'node src/participation_data/step_3j_load_bq_participation_summary_metrics.js' },
    { label: 'Show data build scope (test vs full)', desc: 'Print the scope recorded by step 3i - TEST (2024 & 2025) vs FULL, year range, and built-at.', bin: 'node', args: ['show_build_scope.js'], cli: 'node show_build_scope.js' },
  ] },
  { label: 'REFERENCE', color: 'GREEN', items: [
    { label: 'Census API - get a free key', desc: 'US Census API key signup. Add as CENSUS_API_KEY in .env for current ACS 1-yr population in step 2c.', open: 'https://api.census.gov/data/key_signup.html', cli: 'open https://api.census.gov/data/key_signup.html' },
    { label: 'About the Census ACS 1-year data', desc: 'US Census ACS 1-year docs - source of the state population used for penetration / per-capita.', open: 'https://www.census.gov/data/developers/data-sets/acs-1year.html', cli: 'open https://www.census.gov/data/developers/data-sets/acs-1year.html' },
  ] },
];
const ALL = SECTIONS.flatMap((s) => s.items);

if (require.main === module) {
  runMenu({
    title: 'USAT Apps · Participation maps',
    color: 'CYAN',
    sections: SECTIONS,
    cwd: REPO_ROOT,
    prefsFile: path.join(__dirname, '.menu_prefs.json'),
    back: true,
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SECTIONS, ALL };

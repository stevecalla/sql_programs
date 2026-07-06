'use strict';
/**
 * participation_read.js — builds the dashboard "bootstrap" payload by reading the pre-aggregated
 * reporting tables in local MySQL (usat_sales_db), built by the ETL step_3i:
 *   all_participation_data_with_membership_match_summary  (per year/month x state|region|national)
 *   all_participation_data_with_membership_match_flows     (per year/month x home->event)
 *   all_participation_data_with_membership_match_events    (per year/month x sanctioning event, + lat/lng)
 * These are a few hundred / few thousand rows, so loads are instant (vs aggregating ~6M rows).
 *
 * The per-year roll-up (36 metrics) is participation_agg.buildYear (a 1:1 port of the POC's build_year);
 * static map metadata (centroids, regions, colors, metric list) comes from mapmeta.json. Cached in
 * memory (stale-while-revalidate), with a fixture fallback so the app still runs if MySQL is unreachable.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const META = require('./mapmeta.json');
const data_dir = require('../data_dir');

// Single aggregator: the per-year roll-up is built by the SAME compute.js the client uses (ESM, lazy-imported
// once). Proven byte-identical to the old participation_agg.buildYear via store/verify_agg_parity.js.
let _compute = null;
async function getCompute() { if (!_compute) _compute = await import('../web/src/lib/compute.js'); return _compute; }

const DB_NAME = 'usat_sales_db';
const SUMMARY_TABLE = 'all_participation_data_with_membership_match_summary';
const FLOWS_TABLE = 'all_participation_data_with_membership_match_flows';
const EVENTS_TABLE = 'all_participation_data_with_membership_match_events';

// Self-healing fallback cache — lives in the app data dir (OUTSIDE the repo, next to auth.json), so it never
// churns git and is never committed. The server rewrites it after every successful live MySQL build, so the
// fallback is always the last known-good live payload (no stale/phantom data). Override: REPORTING_FIXTURE_FILE.
const FIXTURE = process.env.REPORTING_FIXTURE_FILE || data_dir.file_sync('participation_bootstrap.json');
const TTL_MS = Number(process.env.REPORTING_BOOTSTRAP_TTL_MS) || 60 * 60 * 1000;

// Persist the live payload to the fallback cache (best-effort; a read-only data dir must not crash the app).
function writeFixture(payload) {
  try { fs.mkdirSync(path.dirname(FIXTURE), { recursive: true }); fs.writeFileSync(FIXTURE, JSON.stringify(payload)); }
  catch (e) { console.warn('[reporting] could not write fallback cache: ' + e.message); }
}

let _cache = null;
let _building = null;
let _lastLiveTry = 0;
const RETRY_MS = Number(process.env.REPORTING_LIVE_RETRY_MS) || 5 * 60 * 1000;
const BUILD_TIMEOUT_MS = Number(process.env.REPORTING_BUILD_TIMEOUT_MS) || 60000;

// One summary row -> the raw array participation_agg expects. away = turnout - home - unknown_home_count
// (unknown = home state missing or not one of the 50 states). unknown_home_count is appended at the end so
// existing indices (home=14, away=15, ironman=16, new=17, unique=18) are unchanged; unknown=19.
function sumToRaw(r) {
  const n = (x) => (x == null ? 0 : Number(x));
  return [r.geo_key, n(r.turnout), n(r.events), n(r.races), n(r.adult), n(r.adult_events), n(r.adult_races),
    n(r.female), n(r.male), n(r.age_4_19), n(r.age_20_29), n(r.age_30_39), n(r.age_40_49), n(r.age_50_59), n(r.age_60_plus),
    n(r.home), n(r.turnout) - n(r.home) - n(r.unknown_home_count), n(r.ironman), n(r.new_count), n(r.unique_athletes),
    n(r.unknown_home_count)];
}

// One events-table row -> the 34-col event array the dashboard expects (mirrors the POC build3 EVCOLS +
// the new Unknown-home columns, grouped with home/away). All metrics computed in SQL — straight map.
// [state, region, name, sanction_id, date, IRONMAN, participants, races, per-race, adult/race, female%,
//  male%, female_n, male_n, age%(4-19..60+), home(20), away(21), unknown_home(22), home%(23), away%(24),
//  unknown_home%(25), new, repeat, new%, repeat%, unique(30), per-participant(31), lat(32), lng(33)].
function evToRow(r) {
  const n = (x) => (x == null ? 0 : Number(x));
  const d = r.event_date == null ? null
    : (r.event_date instanceof Date ? r.event_date.toISOString().slice(0, 10) : String(r.event_date).slice(0, 10));
  return [
    r.event_state, r.region_name, r.event_name, n(r.event_id), d, (n(r.is_ironman_event) > 0 ? 'Yes' : 'No'),
    n(r.turnout), n(r.races), n(r.per_race), n(r.adult_per_race),
    n(r.female_pct), n(r.male_pct), n(r.female), n(r.male),
    n(r.age_4_19_pct), n(r.age_20_29_pct), n(r.age_30_39_pct), n(r.age_40_49_pct), n(r.age_50_59_pct), n(r.age_60_plus_pct),
    n(r.home), n(r.away), n(r.unknown_home_count),
    n(r.home_pct), n(r.away_pct), n(r.unknown_home_pct),
    n(r.new_count), n(r.repeat_count), n(r.new_pct), n(r.repeat_pct),
    n(r.unique_athletes), n(r.per_participant),
    r.lat == null ? null : Number(r.lat), r.lng == null ? null : Number(r.lng),
  ];
}

async function build_from_mysql() {
  const [sumRows, flowRows, evRows] = await Promise.all([
    db.query('SELECT * FROM ' + SUMMARY_TABLE),
    db.query('SELECT * FROM ' + FLOWS_TABLE),
    db.query('SELECT * FROM ' + EVENTS_TABLE),
  ]);

  const stateAnnual = {}, regionAnnual = {}, nationalAnnual = {};
  const rawByYM = {}, monthlyNat = {}, monthsByYear = {};
  let maxParts = 0;

  for (const r of sumRows) {
    const yr = String(r.start_date_year_races);
    const mo = r.start_date_month_races; // null = annual roll-up
    if (mo == null) {
      if (r.geo_level === 'state') { (stateAnnual[yr] = stateAnnual[yr] || []).push(sumToRaw(r)); }
      else if (r.geo_level === 'region') (regionAnnual[yr] = regionAnnual[yr] || []).push(sumToRaw(r));
      else if (r.geo_level === 'national') nationalAnnual[yr] = r;
    } else {
      const key = yr + '-' + mo;
      // rawByYM shape mirrors the POC: { s: {stateCode: raw19}, r: {region: raw19} }, geo_key stripped.
      const slot = (rawByYM[key] = rawByYM[key] || { s: {}, r: {} });
      if (r.geo_level === 'state') slot.s[r.geo_key] = sumToRaw(r).slice(1);
      else if (r.geo_level === 'region') slot.r[r.geo_key] = sumToRaw(r).slice(1);
      else if (r.geo_level === 'national') { monthlyNat[key] = Number(r.turnout); (monthsByYear[yr] = monthsByYear[yr] || new Set()).add(Number(mo)); }
    }
  }
  Object.keys(monthsByYear).forEach((y) => { monthsByYear[y] = Array.from(monthsByYear[y]).sort((a, b) => a - b); });

  const byYear = {}, annualUnique = {};
  const compute = await getCompute();
  const P = { meta: META.meta, abbr: META.abbr, ab2region: META.ab2region, regOrder: META.regOrder, names: META.names, rawByYM: {} };
  for (const yr of Object.keys(nationalAnnual)) {
    const nat = { uniq: Number(nationalAnnual[yr].unique_athletes), part: Number(nationalAnnual[yr].turnout) };
    const s = {}; (stateAnnual[yr] || []).forEach((row) => { s[row[0]] = row[19]; });
    const rr = {}; (regionAnnual[yr] || []).forEach((row) => { rr[row[0]] = row[19]; });
    annualUnique[yr] = { s, r: rr, n: nat.uniq };
    byYear[yr] = compute.buildYearBlock(stateAnnual[yr] || [], regionAnnual[yr] || [], { state: s, region: rr, nat: nat.uniq, approx: false }, P);
  }

  // Events: annual roll-up rows only (one row per event/year) -> pins + Events tab. maxParts = the largest
  // single-event turnout, which the map uses as the pin size reference.
  const eventsByYear = {};
  for (const r of evRows) {
    if (r.start_date_month_races != null) continue;
    const yr = String(r.start_date_year_races);
    const row = evToRow(r);
    (eventsByYear[yr] = eventsByYear[yr] || []).push(row);
    if (row[6] > maxParts) maxParts = row[6];
  }

  const odByYM = {};
  for (const f of flowRows) {
    if (f.start_date_month_races == null) continue; // annual rows are redundant (app sums months)
    const key = f.start_date_year_races + '-' + f.start_date_month_races;
    (odByYM[key] = odByYM[key] || []).push([f.home_state, f.event_state, Number(f.participations)]);
  }

  // "Last refresh" = the source data's own build timestamp, carried from the parent participation table
  // into the summary/flows/events tables (identical across all rows). MTN is shown; UTC feeds the tooltip.
  const fmtTs = (v) => (v == null ? null : new Date(v).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }));
  const src0 = sumRows[0] || {};
  const lastUpdated = fmtTs(src0.created_at_mtn);
  const lastUpdatedUtc = fmtTs(src0.created_at_utc);

  return Object.assign({}, {
    colors: META.colors, evcols: META.evcols, fips2region: META.fips2region, ab2region: META.ab2region,
    rshead: META.rshead, names: META.names, abbr: META.abbr, regs: META.regs, regOrder: META.regOrder,
    centroid: META.centroid, name2ab: META.name2ab, meta: META.meta,
  }, { byYear, monthsByYear, rawByYM, odByYM, annualUnique, monthlyNat, eventsByYear, lastUpdated, lastUpdatedUtc, maxParts });
}

function load_fixture() {
  if (!fs.existsSync(FIXTURE)) {
    const e = new Error('no participation data: MySQL unreachable and no fixture at ' + FIXTURE);
    e.code = 'NO_DATA'; throw e;
  }
  return { payload: JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), source: 'fixture' };
}

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('bootstrap build timed out after ' + ms + 'ms'), { code: 'TIMEOUT' })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function refreshLive() {
  _lastLiveTry = Date.now();
  try {
    const payload = await withTimeout(build_from_mysql(), BUILD_TIMEOUT_MS);
    _cache = { payload, source: 'mysql', at: Date.now() };
    writeFixture(payload);   // refresh the fallback cache with this known-good live build
    console.log('[reporting] live participation payload cached from MySQL (summary tables)');
  } catch (e) {
    console.warn('[reporting] live build failed (' + (e.code || 'error') + '): ' + e.message + ' — keeping ' + (_cache ? _cache.source : 'no cache'));
    if (process.env.REPORTING_STRICT_DB === '1') { _building = null; throw e; }
  } finally { _building = null; }
}

function seedFixture() {
  if (_cache) return;
  try { const r = load_fixture(); _cache = { payload: r.payload, source: 'fixture', at: Date.now() }; } catch (e) { /* no fixture */ }
}

async function get_bootstrap() {
  if (process.env.REPORTING_STRICT_DB === '1') {
    const payload = await withTimeout(build_from_mysql(), BUILD_TIMEOUT_MS);
    _cache = { payload, source: 'mysql', at: Date.now() };
    writeFixture(payload);
    return _cache;
  }
  if (!_cache) seedFixture();
  const stale = !_cache || _cache.source !== 'mysql' || (Date.now() - _cache.at) > TTL_MS;
  if (stale && !_building && (Date.now() - _lastLiveTry) > (_cache ? RETRY_MS : 0)) _building = refreshLive();
  if (_cache) return _cache;
  if (_building) { try { await _building; } catch (e) { /* fall through */ } }
  if (_cache) return _cache;
  const e = new Error('no participation data available'); e.code = 'NO_DATA'; throw e;
}

module.exports = { get_bootstrap, build_from_mysql, FIXTURE };

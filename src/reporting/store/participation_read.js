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
const crypto = require('crypto');
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

// Fingerprint of a serialized payload — lets us persist the fallback cache ONLY when the data actually
// changed, so the file (and its mtime) tracks real data updates instead of churning every refresh.
function sig(json) { return crypto.createHash('sha1').update(json).digest('hex'); }
let _fixtureSig = null;   // sig of whatever is currently on disk; seeded on load, updated on write.
const _uniqueCache = new Map();   // exact-distinct results keyed by selection; cleared on each live rebuild.

// Persist the live payload to the fallback cache. Best-effort (a read-only data dir must not crash the app)
// and change-guarded: if the new payload is byte-identical to what's already cached we skip the write, so
// an unchanged hourly rebuild is a no-op. Only ever called after a SUCCESSFUL live build, so a MySQL outage
// never overwrites the last known-good file.
function writeFixture(payload) {
  try {
    const json = JSON.stringify(payload);
    const s = sig(json);
    if (s === _fixtureSig) return;   // data unchanged — leave the cache (and its timestamp) alone
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, json);
    _fixtureSig = s;
    console.log('[reporting] fallback cache updated — live data changed');
  } catch (e) { console.warn('[reporting] could not write fallback cache: ' + e.message); }
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
  const [sumRows, flowRows, evRows, regionRows] = await Promise.all([
    db.query('SELECT * FROM ' + SUMMARY_TABLE),
    db.query('SELECT * FROM ' + FLOWS_TABLE),
    db.query('SELECT * FROM ' + EVENTS_TABLE),
    // Geography (state list + region membership) from the SAME region_data table step_3i uses, so the app
    // can't drift from the ETL scope. Blank-region codes (military/foreign) are excluded, matching summary.
    db.query("SELECT state_code, state_name, region_name, region_abbr, lat, lng FROM region_data WHERE state_code IS NOT NULL AND region_name IS NOT NULL AND region_name <> '' ORDER BY state_name"),
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

  // Build the geography maps from region_data (single source of truth with step_3i). mapmeta.json now only
  // supplies the static geometry region_data lacks: centroids (+ colors/evcols/fips2region). A geo with no
  // centroid is table-only (DC still fills via Plotly's built-in state geometry; PR/GU/VI are table/total
  // only). Falls back to the static mapmeta lists if region_data is somehow unavailable.
  const useReg = Array.isArray(regionRows) && regionRows.length >= 40;
  const gAbbr = [], gNames = [], gAb2region = {}, gName2ab = {}, gRegs = [], gCentroid = {};
  if (useReg) for (const r of regionRows) {
    gAbbr.push(r.state_code); gNames.push(r.state_name);
    gAb2region[r.state_code] = r.region_name; gName2ab[r.state_name] = r.state_code; gRegs.push(r.region_name);
    if (r.lat != null && r.lng != null) gCentroid[r.state_code] = [Number(r.lng), Number(r.lat)];  // [lng,lat]
  }
  const gRegOrder = (META.regOrder || []).slice();
  if (useReg) for (const rg of gRegs) if (gRegOrder.indexOf(rg) < 0) gRegOrder.push(rg);

  const byYear = {}, annualUnique = {};
  const compute = await getCompute();
  const P = { meta: META.meta, abbr: useReg ? gAbbr : META.abbr, ab2region: useReg ? gAb2region : META.ab2region, regOrder: useReg ? gRegOrder : META.regOrder, names: useReg ? gNames : META.names, rawByYM: {} };
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
  // The IRONMAN flag is only present once the flows ETL has been rebuilt with the is_ironman column. Detect
  // it from the row shape so PRE-reload data still yields full flows (3-tuples) and the IM toggle just stays
  // disabled — rather than dropping every row and blanking the map.
  const flowsHaveIM = flowRows.length > 0 && Object.prototype.hasOwnProperty.call(flowRows[0], 'is_ironman');
  for (const f of flowRows) {
    if (f.start_date_month_races == null) continue; // annual rows are redundant (app sums months)
    const key = f.start_date_year_races + '-' + f.start_date_month_races;
    if (flowsHaveIM) {
      // ROLLUP also emits IRONMAN super-aggregate rows (is_ironman NULL) — skip them so the IM + non-IM
      // leaves aren't double-counted; the app re-sums the two flags itself.
      if (f.is_ironman == null) continue;
      (odByYM[key] = odByYM[key] || []).push([f.home_state, f.event_state, Number(f.participations), Number(f.is_ironman)]);
    } else {
      (odByYM[key] = odByYM[key] || []).push([f.home_state, f.event_state, Number(f.participations)]);
    }
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
    colors: META.colors, evcols: META.evcols, fips2region: META.fips2region, ab2region: useReg ? gAb2region : META.ab2region,
    rshead: META.rshead, names: useReg ? gNames : META.names, abbr: useReg ? gAbbr : META.abbr, regs: useReg ? gRegs : META.regs, regOrder: useReg ? gRegOrder : META.regOrder,
    centroid: useReg ? Object.assign({}, META.centroid, gCentroid) : META.centroid, name2ab: useReg ? gName2ab : META.name2ab, meta: META.meta,
  }, { byYear, monthsByYear, rawByYM, odByYM, annualUnique, monthlyNat, eventsByYear, lastUpdated, lastUpdatedUtc, maxParts });
}

function load_fixture() {
  if (!fs.existsSync(FIXTURE)) {
    const e = new Error('no participation data: MySQL unreachable and no fixture at ' + FIXTURE);
    e.code = 'NO_DATA'; throw e;
  }
  const raw = fs.readFileSync(FIXTURE, 'utf8');
  _fixtureSig = sig(raw);   // baseline: don't rewrite an identical payload after a restart
  return { payload: JSON.parse(raw), source: 'fixture' };
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
    _uniqueCache.clear();    // new data build -> drop memoized exact-distinct results
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

async function get_bootstrap(opts) {
  const force = !!(opts && opts.force);
  if (process.env.REPORTING_STRICT_DB === '1') {
    const payload = await withTimeout(build_from_mysql(), BUILD_TIMEOUT_MS);
    _cache = { payload, source: 'mysql', at: Date.now() };
    writeFixture(payload);
    return _cache;
  }
  if (!_cache) seedFixture();
  // Force-live: rebuild from MySQL now, ignoring the TTL and the retry throttle. Reuses any in-flight
  // build. On failure refreshLive keeps the existing cache and does NOT write the fixture, so the caller
  // just gets the last known-good payload back (source stays 'fixture') — the connection being down never
  // corrupts or overwrites the backup.
  if (force) {
    if (!_building) _building = refreshLive();
    try { await _building; } catch (e) { /* MySQL unreachable — keep whatever cache we have */ }
    if (_cache) return _cache;
    const e = new Error('no participation data available'); e.code = 'NO_DATA'; throw e;
  }
  const stale = !_cache || _cache.source !== 'mysql' || (Date.now() - _cache.at) > TTL_MS;
  if (stale && !_building && (Date.now() - _lastLiveTry) > (_cache ? RETRY_MS : 0)) _building = refreshLive();
  if (_cache) return _cache;
  if (_building) { try { await _building; } catch (e) { /* fall through */ } }
  if (_cache) return _cache;
  const e = new Error('no participation data available'); e.code = 'NO_DATA'; throw e;
}

// ---- On-demand EXACT unique athletes ---------------------------------------------------------------
// unique_athletes is the one non-additive metric: a distinct athlete can appear in many events/states/
// months, so it can't be summed from the pre-aggregated summary. For any selection we count it straight
// from the base athlete-grain table (all_participation_data_with_membership_match) at state + region +
// national grain in one pass each (WITH ROLLUP -> the NULL group row IS the true national distinct).
// Restricted to the app's 50 states so national matches the summary's participant basis. Memoized by
// selection; the cache is cleared whenever a fresh live build lands.
const BASE_TABLE = 'all_participation_data_with_membership_match';
async function unique_for_selection(sel) {
  sel = sel || {};
  const years = (sel.years || []).map(Number).filter((y) => y);
  if (!years.length) return { national: 0, byState: {}, byRegion: {} };
  const months = (sel.months && sel.months.indexOf('all') < 0)
    ? sel.months.map(Number).filter((m) => m >= 1 && m <= 12) : null;
  const region = sel.region || null, state = sel.state || null, ironman = sel.ironman || null;
  const key = JSON.stringify({ y: years.slice().sort((a, b) => a - b), m: months ? months.slice().sort((a, b) => a - b) : 'all', region, state, ironman });
  if (_uniqueCache.has(key)) return _uniqueCache.get(key);

  const where = ['start_date_year_races IN (?)'];
  const params = [years];
  if (state) { where.push('state_code_events = ?'); params.push(state); }
  else { where.push('state_code_events IN (?)'); params.push(META.abbr); }   // 50 states -> match summary basis
  if (months) { where.push('start_date_month_races IN (?)'); params.push(months); }
  if (region) { where.push('region_name = ?'); params.push(region); }
  if (ironman === 'Yes') where.push("is_ironman = 'Y'");
  else if (ironman === 'No') where.push("(is_ironman IS NULL OR is_ironman <> 'Y')");
  const W = where.join(' AND ');

  const [stRows, rgRows] = await Promise.all([
    db.query('SELECT state_code_events AS k, COUNT(DISTINCT id_profiles) AS u FROM ' + BASE_TABLE + ' WHERE ' + W + ' GROUP BY state_code_events WITH ROLLUP', params),
    db.query('SELECT region_name AS k, COUNT(DISTINCT id_profiles) AS u FROM ' + BASE_TABLE + ' WHERE ' + W + ' GROUP BY region_name WITH ROLLUP', params),
  ]);
  const byState = {}; let national = 0;
  for (const r of stRows) { if (r.k == null) national = Number(r.u); else byState[r.k] = Number(r.u); }
  const byRegion = {}; for (const r of rgRows) { if (r.k != null && r.k !== '') byRegion[r.k] = Number(r.u); }
  const out = { national, byState, byRegion };
  _uniqueCache.set(key, out);
  return out;
}

module.exports = { get_bootstrap, build_from_mysql, unique_for_selection, FIXTURE };

'use strict';
/**
 * participation_read.js — builds the "bootstrap" payload the participation dashboard renders, from the
 * local MySQL table all_participation_data_with_membership_match (usat_sales_db). Read-only.
 *
 * Field logic (validated against the POC — see plans_and_notes/FIELD_MAPPING.md):
 *   grain            = id_rr (one participation)         year/month = start_date_year_races / _month_races
 *   event state      = state_code_events (the map keys on this; 50 states only)
 *   home state       = member_state_code_addresses      home = (home state == event state)
 *   gender           = gender_code ('F' / 'M')          IRONMAN = is_ironman = 1
 *   age bands        = age_as_race_results_bin           new = member_created_at_category_starts_mp='created_year'
 *   unique athlete   = id_profiles
 *
 * The per-state / per-region aggregates are rolled up by participation_agg.buildYear (a 1:1 port of the
 * POC's build_year) so byYear matches the standalone. Static map metadata (centroids, regions, colors,
 * metric list) comes from mapmeta.json. Cached in memory, rebuilt on a TTL. Falls back to a fixture if
 * MySQL is unreachable so the app still runs.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const agg = require('./participation_agg');
const META = require('./mapmeta.json');

const ABBR = META.abbr;
const AB2REGION = META.ab2region;
const NAMES = META.names;
const TABLE = 'all_participation_data_with_membership_match';
const STATE_LIST = ABBR.map((a) => "'" + a + "'").join(',');
const ADULT_BINS = "('20-29','30-39','40-49','50-59','60-69','70-79','80-89','90-99')";

const FIXTURE = path.join(__dirname, 'fixtures', 'participation_bootstrap.json');
const TTL_MS = Number(process.env.REPORTING_BOOTSTRAP_TTL_MS) || 60 * 60 * 1000;

let _cache = null;
let _building = null;

function regionCase(col) {
  return 'CASE ' + col + ' ' + ABBR.map((a) => "WHEN '" + a + "' THEN '" + AB2REGION[a] + "'").join(' ') + ' END';
}

// Shared metric columns. `homeExpr` is the boolean that defines "home" (in-state for states, in-region
// for regions). away is derived (turnout - home) in JS.
function metricCols(homeExpr) {
  return [
    'COUNT(id_rr) AS turnout',
    'COUNT(DISTINCT id_events) AS events',
    'COUNT(DISTINCT id_race_rr) AS races',
    'SUM(age_as_race_results_bin IN ' + ADULT_BINS + ') AS adult',
    'COUNT(DISTINCT CASE WHEN age_as_race_results_bin IN ' + ADULT_BINS + ' THEN id_events END) AS aev',
    'COUNT(DISTINCT CASE WHEN age_as_race_results_bin IN ' + ADULT_BINS + ' THEN id_race_rr END) AS arc',
    "SUM(gender_code='F') AS fem",
    "SUM(gender_code='M') AS male",
    "SUM(age_as_race_results_bin IN ('4-9','10-19')) AS a419",
    "SUM(age_as_race_results_bin='20-29') AS a2029",
    "SUM(age_as_race_results_bin='30-39') AS a3039",
    "SUM(age_as_race_results_bin='40-49') AS a4049",
    "SUM(age_as_race_results_bin='50-59') AS a5059",
    "SUM(age_as_race_results_bin IN ('60-69','70-79','80-89','90-99')) AS a60",
    'SUM(' + homeExpr + ') AS home',
    'SUM(is_ironman=1) AS im',
    "SUM(member_created_at_category_starts_mp='created_year') AS newc",
    'COUNT(DISTINCT id_profiles) AS uniq',
  ].join(', ');
}

// mysql2 row object -> the 20-col raw array parseRow expects (away = turnout - home).
function toRaw(key, o) {
  const n = (x) => (x == null ? 0 : Number(x));
  return [key, n(o.turnout), n(o.events), n(o.races), n(o.adult), n(o.aev), n(o.arc), n(o.fem), n(o.male),
    n(o.a419), n(o.a2029), n(o.a3039), n(o.a4049), n(o.a5059), n(o.a60),
    n(o.home), n(o.turnout) - n(o.home), n(o.im), n(o.newc), n(o.uniq)];
}

async function build_from_mysql() {
  const W = 'WHERE state_code_events IN (' + STATE_LIST + ') AND start_date_year_races IS NOT NULL';
  const homeState = 'member_state_code_addresses = state_code_events';
  const homeRegion = regionCase('member_state_code_addresses') + ' = ' + regionCase('state_code_events');

  const full = process.env.REPORTING_FULL_BUILD === '1';
  const H = '/*+ MAX_EXECUTION_TIME(60000) */ ';   // cap each query so a slow scan errors instead of hanging

  // Essential annual aggregates drive byYear + the map — kept lean so bootstrap is fast. The heavier
  // per-month / flows / events queries are gated behind REPORTING_FULL_BUILD (they want indexes + the
  // native tabs that consume them, which are still being built).
  const [annState, annRegion, annNat, upd] = await Promise.all([
    db.query('SELECT ' + H + 'start_date_year_races AS yr, state_code_events AS k, ' + metricCols(homeState) + ' FROM ' + TABLE + ' ' + W + ' GROUP BY yr, k'),
    db.query('SELECT ' + H + 'start_date_year_races AS yr, ' + regionCase('state_code_events') + ' AS k, ' + metricCols(homeRegion) + ' FROM ' + TABLE + ' ' + W + ' GROUP BY yr, k'),
    db.query('SELECT ' + H + 'start_date_year_races AS yr, COUNT(id_rr) AS part, COUNT(DISTINCT id_profiles) AS uniq FROM ' + TABLE + ' ' + W + ' GROUP BY yr'),
    db.query('SELECT ' + H + 'MAX(created_at_mtn) AS mx FROM ' + TABLE),
  ]);

  const byYear = {}, annualUnique = {}, nat = {};
  annNat.forEach((r) => { nat[r.yr] = { uniq: Number(r.uniq), part: Number(r.part) }; });
  const stateByYear = {}, regionByYear = {};
  annState.forEach((r) => { (stateByYear[r.yr] = stateByYear[r.yr] || []).push(toRaw(r.k, r)); });
  annRegion.forEach((r) => { if (r.k) (regionByYear[r.yr] = regionByYear[r.yr] || []).push(toRaw(r.k, r)); });
  let maxParts = 0;
  Object.keys(nat).forEach((y) => {
    byYear[y] = agg.buildYear(stateByYear[y] || [], regionByYear[y] || [], nat[y]);
    const s = {}; (stateByYear[y] || []).forEach((row) => { s[row[0]] = row[19]; if (row[1] > maxParts) maxParts = row[1]; });
    annualUnique[y] = { s };
  });

  const rawByYM = {}, monthlyNat = {}, monthsByYear = {}, odByYM = {}, eventsByYear = {};
  if (full) {
    const [monState, monNat, flows, events] = await Promise.all([
      db.query('SELECT ' + H + 'start_date_year_races AS yr, start_date_month_races AS mo, state_code_events AS k, ' + metricCols(homeState) + ' FROM ' + TABLE + ' ' + W + ' GROUP BY yr, mo, k'),
      db.query('SELECT ' + H + 'start_date_year_races AS yr, start_date_month_races AS mo, COUNT(id_rr) AS n FROM ' + TABLE + ' ' + W + ' GROUP BY yr, mo'),
      db.query('SELECT ' + H + 'start_date_year_races AS yr, start_date_month_races AS mo, member_state_code_addresses AS h, state_code_events AS e, COUNT(id_rr) AS n FROM ' + TABLE +
        ' WHERE state_code_events IN (' + STATE_LIST + ') AND member_state_code_addresses IN (' + STATE_LIST + ') AND member_state_code_addresses <> state_code_events GROUP BY yr, mo, h, e'),
      db.query('SELECT ' + H + 'start_date_year_races AS yr, id_events AS eid, MAX(name_events) AS nm, MAX(state_code_events) AS st, MAX(id_sanctioning_events) AS sanc, MAX(is_ironman) AS im, COUNT(id_rr) AS parts, COUNT(DISTINCT id_profiles) AS uniq FROM ' + TABLE + ' ' + W + ' GROUP BY yr, id_events'),
    ]);
    monState.forEach((r) => { const key = r.yr + '-' + r.mo; (rawByYM[key] = rawByYM[key] || []).push(toRaw(r.k, r)); });
    monNat.forEach((r) => { monthlyNat[r.yr + '-' + r.mo] = Number(r.n); (monthsByYear[r.yr] = monthsByYear[r.yr] || new Set()).add(Number(r.mo)); });
    Object.keys(monthsByYear).forEach((y) => { monthsByYear[y] = Array.from(monthsByYear[y]).sort((a, b) => a - b); });
    flows.forEach((r) => { const key = r.yr + '-' + r.mo; (odByYM[key] = odByYM[key] || []).push([r.h, r.e, Number(r.n)]); });
    events.forEach((r) => { const parts = Number(r.parts); const st = r.st; (eventsByYear[r.yr] = eventsByYear[r.yr] || []).push([st, AB2REGION[st] || '', r.nm, r.sanc, null, (Number(r.im) === 1 ? 'Yes' : 'No'), parts, Number(r.uniq)]); });
  } else {
    Object.keys(byYear).forEach((y) => { monthsByYear[y] = []; });   // month selector not built yet
  }

  const lastUpdated = upd && upd[0] && upd[0].mx ? new Date(upd[0].mx).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }) : null;

  return Object.assign({}, {
    colors: META.colors, evcols: META.evcols, fips2region: META.fips2region, ab2region: META.ab2region,
    rshead: META.rshead, names: META.names, abbr: META.abbr, regs: META.regs, regOrder: META.regOrder,
    centroid: META.centroid, name2ab: META.name2ab, meta: META.meta,
  }, { byYear, monthsByYear, rawByYM, odByYM, annualUnique, monthlyNat, eventsByYear, lastUpdated, maxParts });
}

function load_fixture() {
  if (!fs.existsSync(FIXTURE)) {
    const e = new Error('no participation data: MySQL unreachable and no fixture at ' + FIXTURE);
    e.code = 'NO_DATA'; throw e;
  }
  return { payload: JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), source: 'fixture' };
}

// Never let a slow/hung query block a request forever — race the build against a timeout, then fall
// back to the fixture (unless REPORTING_STRICT_DB=1, which surfaces the real error while tuning).
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('bootstrap build timed out after ' + ms + 'ms'), { code: 'TIMEOUT' })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function assemble() {
  try {
    const ms = Number(process.env.REPORTING_BUILD_TIMEOUT_MS) || 90000;
    return { payload: await withTimeout(build_from_mysql(), ms), source: 'mysql' };
  } catch (e) {
    if (process.env.REPORTING_STRICT_DB === '1') throw e;
    console.warn('[reporting] MySQL build failed (' + (e.code || 'error') + '), using fixture: ' + e.message);
    return load_fixture();
  }
}

async function get_bootstrap() {
  if (_cache && (Date.now() - _cache.at) < TTL_MS) return _cache;
  if (_building) return _building;
  _building = assemble()
    .then((r) => { _cache = { payload: r.payload, source: r.source, at: Date.now() }; _building = null; return _cache; })
    .catch((e) => { _building = null; throw e; });
  return _building;
}

module.exports = { get_bootstrap, build_from_mysql, FIXTURE };

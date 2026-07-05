'use strict';
/**
 * participation_read.js — builds the dashboard "bootstrap" payload by reading the pre-aggregated
 * reporting tables in local MySQL (usat_sales_db), built by the ETL step_3i:
 *   all_participation_data_with_membership_match_summary  (per year/month x state|region|national)
 *   all_participation_data_with_membership_match_flows     (per year/month x home->event)
 * These are a few hundred / few thousand rows, so loads are instant (vs aggregating ~6M rows).
 *
 * The per-year roll-up (36 metrics) is participation_agg.buildYear (a 1:1 port of the POC's build_year);
 * static map metadata (centroids, regions, colors, metric list) comes from mapmeta.json. Cached in
 * memory (stale-while-revalidate), with a fixture fallback so the app still runs if MySQL is unreachable.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const agg = require('./participation_agg');
const META = require('./mapmeta.json');

const DB_NAME = 'usat_sales_db';
const SUMMARY_TABLE = 'all_participation_data_with_membership_match_summary';
const FLOWS_TABLE = 'all_participation_data_with_membership_match_flows';

const FIXTURE = path.join(__dirname, 'fixtures', 'participation_bootstrap.json');
const TTL_MS = Number(process.env.REPORTING_BOOTSTRAP_TTL_MS) || 60 * 60 * 1000;

let _cache = null;
let _building = null;
let _lastLiveTry = 0;
const RETRY_MS = Number(process.env.REPORTING_LIVE_RETRY_MS) || 5 * 60 * 1000;
const BUILD_TIMEOUT_MS = Number(process.env.REPORTING_BUILD_TIMEOUT_MS) || 60000;

// One summary row -> the 20-col raw array participation_agg expects (away = turnout - home).
function sumToRaw(r) {
  const n = (x) => (x == null ? 0 : Number(x));
  return [r.geo_key, n(r.turnout), n(r.events), n(r.races), n(r.adult), n(r.adult_events), n(r.adult_races),
    n(r.female), n(r.male), n(r.age_4_19), n(r.age_20_29), n(r.age_30_39), n(r.age_40_49), n(r.age_50_59), n(r.age_60_plus),
    n(r.home), n(r.turnout) - n(r.home), n(r.ironman), n(r.new_count), n(r.unique_athletes)];
}

async function build_from_mysql() {
  const [sumRows, flowRows, metaRows] = await Promise.all([
    db.query('SELECT * FROM ' + SUMMARY_TABLE),
    db.query('SELECT * FROM ' + FLOWS_TABLE),
    db.query("SELECT CREATE_TIME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?", [DB_NAME, SUMMARY_TABLE]),
  ]);

  const stateAnnual = {}, regionAnnual = {}, nationalAnnual = {};
  const rawByYM = {}, monthlyNat = {}, monthsByYear = {};
  let maxParts = 0;

  for (const r of sumRows) {
    const yr = String(r.start_date_year_races);
    const mo = r.start_date_month_races; // null = annual roll-up
    if (mo == null) {
      if (r.geo_level === 'state') { const raw = sumToRaw(r); (stateAnnual[yr] = stateAnnual[yr] || []).push(raw); if (raw[1] > maxParts) maxParts = raw[1]; }
      else if (r.geo_level === 'region') (regionAnnual[yr] = regionAnnual[yr] || []).push(sumToRaw(r));
      else if (r.geo_level === 'national') nationalAnnual[yr] = r;
    } else {
      const key = yr + '-' + mo;
      if (r.geo_level === 'state') (rawByYM[key] = rawByYM[key] || []).push(sumToRaw(r));
      else if (r.geo_level === 'national') { monthlyNat[key] = Number(r.turnout); (monthsByYear[yr] = monthsByYear[yr] || new Set()).add(Number(mo)); }
    }
  }
  Object.keys(monthsByYear).forEach((y) => { monthsByYear[y] = Array.from(monthsByYear[y]).sort((a, b) => a - b); });

  const byYear = {}, annualUnique = {};
  for (const yr of Object.keys(nationalAnnual)) {
    const nat = { uniq: Number(nationalAnnual[yr].unique_athletes), part: Number(nationalAnnual[yr].turnout) };
    byYear[yr] = agg.buildYear(stateAnnual[yr] || [], regionAnnual[yr] || [], nat);
    const s = {}; (stateAnnual[yr] || []).forEach((row) => { s[row[0]] = row[19]; });
    annualUnique[yr] = { s };
  }

  const odByYM = {};
  for (const f of flowRows) {
    if (f.start_date_month_races == null) continue; // annual rows are redundant (app sums months)
    const key = f.start_date_year_races + '-' + f.start_date_month_races;
    (odByYM[key] = odByYM[key] || []).push([f.home_state, f.event_state, Number(f.participations)]);
  }

  const lastUpdated = metaRows && metaRows[0] && metaRows[0].t ? new Date(metaRows[0].t).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }) : null;

  return Object.assign({}, {
    colors: META.colors, evcols: META.evcols, fips2region: META.fips2region, ab2region: META.ab2region,
    rshead: META.rshead, names: META.names, abbr: META.abbr, regs: META.regs, regOrder: META.regOrder,
    centroid: META.centroid, name2ab: META.name2ab, meta: META.meta,
  }, { byYear, monthsByYear, rawByYM, odByYM, annualUnique, monthlyNat, eventsByYear: {}, lastUpdated, maxParts });
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

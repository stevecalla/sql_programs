// Client-side aggregation ported 1:1 from the POC dashboard so the native page supports multi-year and
// month multi-select. Given selected years + months, it sums the per-(year,month) raw slices in the
// bootstrap payload (rawByYM) and re-derives the 36 metrics — identical math to the standalone build.
//
// Payload pieces used: byYear (exact single-year blocks), rawByYM {s:{ab:[19]}, r:{region:[19]}},
// monthlyNat (national turnout/month), annualUnique {s,r,n}, monthsByYear, meta ([label,fmt]), abbr,
// ab2region, regOrder, names.
//
// Raw 19-col order (per state / per region, matches participation_read.js, geo_key stripped):
//   [turnout, events, races, adult, adultEvents, adultRaces, female, male,
//    age4_19, age20_29, age30_39, age40_49, age50_59, age60, home, away, ironman, new, unique, unknown_home]
//   away = turnout - home - unknown_home (unknown = home state missing or not one of the 50 states).

const sum = (a) => (a || []).reduce((t, v) => t + (Number(v) || 0), 0);

function metricByLabel(yearBlock, label) {
  const m = (yearBlock && yearBlock.metrics || []).find((x) => x.label === label);
  return m ? m.statez : [];
}

function fmtLab(v, fmt) {
  if (v == null) return 'n/a';
  if (fmt === 2) return v.toFixed(1);
  return fmt === 1 ? v + '%' : Number(v).toLocaleString();
}

// Metric value #idx for a summed raw array r (+ its unique count uq). Mirrors the POC mv() switch.
function mv(r, idx, uq) {
  const T = r[0];
  switch (idx) {
    case 0: return r[0]; case 1: return r[1]; case 2: return r[2];
    case 3: return r[1] ? Math.round(r[0] / r[1]) : null; case 4: return r[2] ? Math.round(r[0] / r[2]) : null;
    case 5: return r[4] ? Math.round(r[3] / r[4]) : null; case 6: return r[5] ? Math.round(r[3] / r[5]) : null;
    case 7: return T ? Math.round(100 * r[6] / T) : null; case 8: return T ? Math.round(100 * r[7] / T) : null;
    case 9: return r[6]; case 10: return r[7];
    case 11: return T ? Math.round(100 * r[8] / T) : null; case 12: return T ? Math.round(100 * r[9] / T) : null; case 13: return T ? Math.round(100 * r[10] / T) : null;
    case 14: return T ? Math.round(100 * r[11] / T) : null; case 15: return T ? Math.round(100 * r[12] / T) : null; case 16: return T ? Math.round(100 * r[13] / T) : null;
    case 17: return r[8]; case 18: return r[9]; case 19: return r[10]; case 20: return r[11]; case 21: return r[12]; case 22: return r[13];
    case 23: return r[14]; case 24: return r[15];
    case 25: return T ? Math.round(100 * r[14] / T) : null;
    case 26: return T ? Math.round(100 * r[15] / T) : null;
    case 27: return r[16]; case 28: return T ? Math.round(100 * r[16] / T) : null;
    case 29: return r[17]; case 30: return r[0] - r[17]; case 31: return T ? Math.round(100 * r[17] / T) : null; case 32: return T ? Math.round(100 * (r[0] - r[17]) / T) : null;
    case 33: return uq == null ? null : uq; case 34: return (uq != null && T) ? Math.round(100 * uq / T) : null; case 35: return (uq != null && uq) ? Math.round(r[0] / uq * 10) / 10 : null;
    case 36: return r[19]; case 37: return T ? Math.round(100 * r[19] / T) : null;   // unknown_home count / %
    case 38: return r[14]; case 39: return r[15];                                     // known-home / known-away count (= home / away count)
    case 40: { const kn = r[14] + r[15]; return kn ? Math.round(100 * r[14] / kn) : null; }  // known-home % = home / (home+away)
    case 41: { const kn = r[14] + r[15]; return kn ? Math.round(100 * r[15] / kn) : null; }  // known-away % = away / (home+away)
    default: return null;
  }
}

// Sum the raw state/region arrays across the selected (year-month) keys.
function aggregate(keys, rawByYM) {
  const S = {}, R = {};
  keys.forEach((k) => {
    const d = rawByYM[k]; if (!d) return;
    for (const ab in d.s) { if (!S[ab]) S[ab] = new Array(20).fill(0); const v = d.s[ab]; for (let i = 0; i < 20; i++) S[ab][i] += v[i]; }
    for (const rg in d.r) { if (!R[rg]) R[rg] = new Array(20).fill(0); const w = d.r[rg]; for (let i = 0; i < 20; i++) R[rg][i] += w[i]; }
  });
  return { S, R };
}

// (year,month) keys for the current selection, intersected with the months that exist per year.
export function resolveSlices(selYears, selMonths, monthsByYear) {
  const keys = [];
  selYears.forEach((y) => {
    const mos = (selMonths.indexOf('all') >= 0)
      ? (monthsByYear[y] || [])
      : selMonths.map(Number).filter((m) => (monthsByYear[y] || []).indexOf(m) >= 0);
    mos.forEach((m) => keys.push(y + '-' + m));
  });
  return keys;
}

// Unique counts for the selection. Exact for a single full year or single month; summed (approx) otherwise.
function resolveUniq(selYears, selMonths, keys, p) {
  if (selYears.length === 1 && selMonths.indexOf('all') >= 0) {
    const au = p.annualUnique[selYears[0]] || { s: {}, r: {}, n: 0 };
    return { state: au.s || {}, region: au.r || {}, nat: au.n, approx: false };
  }
  if (keys.length === 1) {
    const d = p.rawByYM[keys[0]] || { s: {}, r: {} }, st = {}, rg = {};
    for (const ab in d.s) st[ab] = d.s[ab][18];
    for (const r in d.r) rg[r] = d.r[r][18];
    return { state: st, region: rg, nat: p.monthlyNat[keys[0]], approx: false };
  }
  const st = {}, rg = {}; let nat = 0;
  keys.forEach((k) => {
    const d = p.rawByYM[k]; if (!d) return;
    for (const ab in d.s) st[ab] = (st[ab] || 0) + d.s[ab][18];
    for (const r in d.r) rg[r] = (rg[r] || 0) + d.r[r][18];
    nat += (p.monthlyNat[k] || 0);
  });
  return { state: st, region: rg, nat, approx: true };
}

// Aggregate a set of slices into a year-block { metrics, cards, rsrows, nat, approxUniq }. Mirrors POC computeAgg.
function computeAgg(keys, uq, p) {
  const { S, R } = aggregate(keys, p.rawByYM);
  const meta = p.meta, abbr = p.abbr, ab2region = p.ab2region, regOrder = p.regOrder, names = p.names;

  const metrics = meta.map((mm, idx) => {
    const fmt = mm[1];
    const statez = abbr.map((ab) => (S[ab] ? mv(S[ab], idx, uq.state[ab]) : null));
    const rvals = {}; for (const rg in R) rvals[rg] = mv(R[rg], idx, uq.region[rg]);
    const regionz = abbr.map((ab) => { const rg = ab2region[ab]; return (rg in rvals) ? rvals[rg] : null; });
    const vals = statez.filter((v) => v != null);
    const mn = vals.length ? Math.min.apply(null, vals) : 0, mx = vals.length ? Math.max.apply(null, vals) : 0;
    const labels = abbr.map((ab, i) => (statez[i] == null ? ab : (ab + '<br>' + fmtLab(statez[i], fmt))));
    const regionlabels = regOrder.map((rg) => ((rg in rvals && rvals[rg] != null) ? (rg + '<br>' + fmtLab(rvals[rg], fmt)) : (rg + '<br>n/a')));
    return { label: mm[0], ispct: fmt === 1, dec: fmt === 2, statez, regionz, mn, mx, labels, regionlabels };
  });

  const present = abbr.filter((ab) => S[ab]);
  const nm = (ab) => names[abbr.indexOf(ab)];
  const tt = present.slice().sort((a, b) => S[b][0] - S[a][0]).slice(0, 8).map((ab) => [ab, nm(ab), S[ab][0]]);
  const hs = (ab) => Math.round(100 * S[ab][14] / S[ab][0]);   // rounded home share % (sort + value, matches server)
  const th = present.filter((ab) => S[ab][0] > 0).sort((a, b) => hs(b) - hs(a)).slice(0, 8).map((ab) => [ab, nm(ab), hs(ab)]);
  const ti = present.slice().sort((a, b) => S[b][16] - S[a][16]).slice(0, 8).map((ab) => [ab, nm(ab), S[ab][16]]);
  const cards = { 'Top participation states': tt, 'Highest home share': th, 'Top IRONMAN states': ti };

  const rsrows = []; let Tt = 0, Et = 0, Rt = 0, Ht = 0, At = 0, IMt = 0, Nt = 0, RPt = 0, FNt = 0, MNt = 0, C4 = 0, Ut = 0;
  regOrder.filter((rg) => R[rg]).forEach((rg) => {
    const v = R[rg]; const hp = v[0] ? Math.round(100 * v[14] / v[0]) : 0; const awp = v[0] ? Math.round(100 * v[15] / v[0]) : 0; const u = uq.region[rg]; const per = u ? Math.round(v[0] / u * 10) / 10 : null;
    rsrows.push([rg, v[0], v[1], (v[1] ? Math.round(v[0] / v[1]) : 0), (v[2] ? Math.round(v[0] / v[2]) : 0), (v[0] ? Math.round(100 * v[6] / v[0]) : 0), v[6], v[7], (v[0] ? Math.round(100 * v[8] / v[0]) : 0), hp, awp, (v[0] ? Math.round(100 * v[19] / v[0]) : 0), v[16], v[17], v[0] - v[17], u, per]);
    Tt += v[0]; Et += v[1]; Rt += v[2]; Ht += v[14]; At += v[15]; IMt += v[16]; Nt += v[17]; RPt += (v[0] - v[17]); FNt += v[6]; MNt += v[7]; C4 += v[8]; Ut += v[19];
  });
  const hpT = Tt ? Math.round(100 * Ht / Tt) : 0, awpT = Tt ? Math.round(100 * At / Tt) : 0, natU = uq.nat;
  rsrows.push(['US total', Tt, Et, (Et ? Math.round(Tt / Et) : 0), (Rt ? Math.round(Tt / Rt) : 0), (Tt ? Math.round(100 * FNt / Tt) : 0), FNt, MNt, (Tt ? Math.round(100 * C4 / Tt) : 0), hpT, awpT, (Tt ? Math.round(100 * Ut / Tt) : 0), IMt, Nt, RPt, natU, (natU ? Math.round(Tt / natU * 10) / 10 : null)]);

  return { metrics, cards, rsrows, nat: { uniq: natU, part: Tt }, approxUniq: uq.approx };
}

// The current year-block for a selection. Single full year -> exact prebuilt block; otherwise aggregate.
export function getYearBlock(p, selYears, selMonths) {
  if (selYears.length === 1 && selMonths.indexOf('all') >= 0 && p.byYear[selYears[0]]) return p.byYear[selYears[0]];
  const keys = resolveSlices(selYears, selMonths, p.monthsByYear);
  return computeAgg(keys, resolveUniq(selYears, selMonths, keys, p), p);
}

// Build one year's block from its ANNUAL raw rows (the summary month=NULL ROLLUP rows, which carry EXACT
// distinct counts). A thin wrapper over computeAgg — feeds the annual state/region slices as a single key,
// so there is ONE aggregation implementation (replaces the separate server participation_agg.buildYear).
//   annualStateRows / annualRegionRows: raw rows WITH the geo_key at index 0 (i.e. sumToRaw output).
//   uq: { state:{ab:uniq}, region:{rg:uniq}, nat:uniq } (from annualUnique). p: meta bundle + rawByYM.
export function buildYearBlock(annualStateRows, annualRegionRows, uq, p) {
  const slot = { s: {}, r: {} };
  (annualStateRows || []).forEach((row) => { slot.s[row[0]] = row.slice(1); });
  (annualRegionRows || []).forEach((row) => { slot.r[row[0]] = row.slice(1); });
  const pp = Object.assign({}, p, { rawByYM: Object.assign({}, p.rawByYM, { __annual__: slot }) });
  return computeAgg(['__annual__'], uq, pp);
}

// Headline KPIs from a year-block (works for single or multi selection).
export function kpisFromYB(yb) {
  if (!yb) return null;
  const participants = sum(metricByLabel(yb, 'Participants'));
  const home = sum(metricByLabel(yb, 'Home (count)'));
  const away = sum(metricByLabel(yb, 'Away (count)'));
  return {
    participants,
    unique: yb.nat ? yb.nat.uniq : null,
    home, away,
    homePct: participants ? Math.round((100 * home) / participants) : null,
    approx: !!yb.approxUniq,
  };
}

// National headline numbers for a single year (all months) — kept for callers that pass a year string.
export function headlineKPIs(payload, year) {
  const yb = payload && payload.byYear && payload.byYear[String(year)];
  return kpisFromYB(yb);
}

export function availableYears(payload) {
  return payload && payload.byYear ? Object.keys(payload.byYear).sort() : [];
}

// Unique athletes for one year restricted to a month list (mirrors the POC uqForYear). Exact when the
// months cover the whole year (uses annualUnique); otherwise sums the per-month raw unique counts (approx).
function uqForYear(p, y, mos) {
  const full = mos.length === (p.monthsByYear[y] || []).length;
  if (full) { const au = p.annualUnique[y] || { s: {}, r: {}, n: 0 }; return { state: au.s || {}, region: au.r || {}, nat: au.n, approx: false }; }
  const st = {}, rg = {}; let nat = 0;
  mos.forEach((m) => {
    const d = p.rawByYM[y + '-' + m]; if (!d) return;
    for (const ab in d.s) st[ab] = (st[ab] || 0) + d.s[ab][18];
    for (const r in d.r) rg[r] = (rg[r] || 0) + d.r[r][18];
    nat += (p.monthlyNat[y + '-' + m] || 0);
  });
  return { state: st, region: rg, nat, approx: true };
}

// Year-over-year change per state for one metric (mirrors the POC applyYoY). Compares fromYear -> toYear.
// Only months present in BOTH years are used (so a partial "to" year compares like-for-like against the
// same months of the baseline). Returns per-state colored z (zc), true change (z, null = n/a), the label
// text, hover customdata rows, and a "new" mask for states that went 0 -> n (no % is defined there).
//   mode: 'pct' (% change, 1 dp) | 'abs' (absolute change). metricIdx selects which metric.
export function computeYoY(p, fromYear, toYear, selMonths, metricIdx, mode) {
  const abbr = p.abbr, names = p.names, regOrder = p.regOrder, ab2region = p.ab2region, abs = mode === 'abs';
  const fromMos = p.monthsByYear[fromYear] || [], toMos = p.monthsByYear[toYear] || [];
  const mos = (selMonths.indexOf('all') >= 0)
    ? fromMos.filter((m) => toMos.indexOf(m) >= 0)
    : selMonths.map(Number).filter((m) => fromMos.indexOf(m) >= 0 && toMos.indexOf(m) >= 0);
  const fs = mos.map((m) => fromYear + '-' + m), ts = mos.map((m) => toYear + '-' + m);
  const fa = computeAgg(fs, uqForYear(p, fromYear, mos), p);
  const ta = computeAgg(ts, uqForYear(p, toYear, mos), p);
  const label = fa.metrics[metricIdx].label;
  const A = fa.metrics[metricIdx].statez, B = ta.metrics[metricIdx].statez;

  // Region from/to values (regionz is per-abbr; the same value repeats for every state in a region).
  const rvA = {}, rvB = {};
  abbr.forEach((ab, i) => { const rg = ab2region[ab]; rvA[rg] = fa.metrics[metricIdx].regionz[i]; rvB[rg] = ta.metrics[metricIdx].regionz[i]; });
  const AR = regOrder.map((rg) => rvA[rg]), BR = regOrder.map((rg) => rvB[rg]);

  // Build a change series for a set of entities (states or regions). short = label code, name = hover name.
  const mk = (Aa, Ba, shortArr, nameArr) => {
    const newmask = shortArr.map((s, i) => !abs && (Aa[i] || 0) === 0 && (Ba[i] || 0) > 0);
    const z = shortArr.map((s, i) => {
      const a = Aa[i] || 0, b = Ba[i] || 0;
      if (a === 0 && b === 0) return null;
      if (abs) return b - a;
      if (a === 0) return null;
      return Math.round(1000 * (b - a) / a) / 10;
    });
    const fp = z.filter((v) => v != null && v > 0);
    const maxPos = fp.length ? Math.max.apply(null, fp) : 100;
    const zc = shortArr.map((s, i) => (newmask[i] ? maxPos : z[i]));
    const chStr = (i) => (newmask[i]
      ? '0 → ' + (Ba[i] || 0).toLocaleString() + ' (new)'
      : (z[i] == null ? 'n/a' : (z[i] > 0 ? '+' : '') + z[i].toLocaleString() + (abs ? '' : '%')));
    const cd = shortArr.map((s, i) => [nameArr[i], (Aa[i] || 0).toLocaleString(), (Ba[i] || 0).toLocaleString(), chStr(i)]);
    const lbl = shortArr.map((s, i) => (newmask[i]
      ? s + '<br>0 → ' + (Ba[i] || 0).toLocaleString()
      : (z[i] == null ? s : s + '<br>' + (z[i] > 0 ? '+' : '') + z[i].toLocaleString() + (abs ? '' : '%'))));
    const maxAbs = Math.max.apply(null, zc.map((v) => (v == null ? 0 : Math.abs(v))).concat([1]));
    return { z, zc, cd, lbl, newmask, maxAbs };
  };

  const S = mk(A, B, abbr, names);
  const R = mk(AR, BR, regOrder, regOrder);
  // Per-state view of the region values, so the choropleth can shade each state by its region's growth.
  const abbrRegZc = abbr.map((ab) => { const j = regOrder.indexOf(ab2region[ab]); return j >= 0 ? R.zc[j] : null; });
  const abbrRegCd = abbr.map((ab) => { const j = regOrder.indexOf(ab2region[ab]); return j >= 0 ? R.cd[j] : [ab2region[ab], '', '', 'n/a']; });

  return {
    mos, label, abs, approx: fa.approxUniq || ta.approxUniq,
    z: S.z, zc: S.zc, cd: S.cd, lbl: S.lbl, maxAbs: S.maxAbs,
    regZ: R.z, regZc: R.zc, regCd: R.cd, regLbl: R.lbl, regMaxAbs: R.maxAbs,
    abbrRegZc, abbrRegCd,
  };
}

// Sum the home->event flow rows (odByYM) across slices -> { flows:[home,event,n], inb, outb }.
export function aggregateFlows(keys, odByYM) {
  const agg = {}, inb = {}, outb = {};
  keys.forEach((k) => {
    const rows = odByYM[k]; if (!rows) return;
    rows.forEach((r) => {
      const kk = r[0] + '|' + r[1];
      agg[kk] = (agg[kk] || 0) + r[2];
      outb[r[0]] = (outb[r[0]] || 0) + r[2];
      inb[r[1]] = (inb[r[1]] || 0) + r[2];
    });
  });
  const flows = Object.keys(agg).map((k) => { const pr = k.split('|'); return [pr[0], pr[1], agg[k]]; });
  return { flows, inb, outb };
}

// In-state (home) participations per state across slices (raw index 14). Used for matrix diagonals.
export function homeByState(keys, rawByYM) {
  const h = {};
  keys.forEach((k) => { const d = rawByYM[k]; if (!d) return; for (const ab in d.s) h[ab] = (h[ab] || 0) + d.s[ab][14]; });
  return h;
}

// Pure module-scope constants + helpers extracted from ParticipationMap.jsx (no React, no component state)
// so the map component file stays focused on rendering/interaction. Everything here is stateless: metric
// metadata, formatters, colorscale sampling, CSV export, CDN loaders, and view/palette constants.
import { trackExport } from '../lib/track.js';

// Plain-language description per metric (for hover tooltips). Full definitions live on the Reference tab.
export const METRIC_DESC = {
  'Participants': 'Count of participation records (event starts). One athlete racing 3 times counts as 3.',
  'Events': 'Distinct events in the period.',
  'Races': 'Distinct races (an event can hold several races).',
  'Per event': 'Participants ÷ Events — average field size per event.',
  'Per race': 'Participants ÷ Races — average field size per race.',
  'Adult per event': 'Adult participations ÷ Events.',
  'Adult per race': 'Adult participations ÷ Races.',
  'Female (count)': 'Number of female participations.',
  'Male (count)': 'Number of male participations.',
  'Home (count)': 'In-state participations (athlete home state = event state).',
  'Away (count)': 'Cross-state participations (home is a 50-state code ≠ event state).',
  'Home %': 'In-state share of ALL participations (home ÷ total). Sums with Away % and Unknown home % to 100%.',
  'Away %': 'Cross-state share of ALL participations (away ÷ total).',
  'Unknown home (count)': 'Participations whose home state is missing or not a 50-state code.',
  'Unknown home %': 'Unknown-home share of ALL participations (unknown ÷ total).',
  'Known home (count)': 'In-state participations (same value as Home count; shown on the known-home basis).',
  'Known away (count)': 'Cross-state participations (same value as Away count; shown on the known-home basis).',
  'Known home %': 'In-state share of KNOWN-home participations — home ÷ (home + away), excludes Unknown. This is the deck definition.',
  'Known away %': 'Cross-state share of KNOWN-home participations — away ÷ (home + away), excludes Unknown.',
  'IRONMAN (count)': 'IRONMAN-race participations.',
  'IRONMAN share %': 'IRONMAN participations ÷ all participations.',
  'New (count)': 'First-time athletes (joined this year).',
  'Repeat (count)': 'Returning athletes.',
  'New %': 'New ÷ Participants.',
  'Repeat %': 'Repeat ÷ Participants.',
  'Unique participants': 'Distinct athletes (deduplicated).',
  '% unique participants': 'Unique ÷ Participants.',
  'Avg races / participant': 'Participants ÷ Unique — average races per athlete.',
  'Adult participants': 'Participations by athletes aged 20+ (age bins 20-29…90-99). Count of race entries, not unique athletes.',
  'Non-adult participants': 'Participations by athletes under 20 (youth 4-19), plus any with no age recorded — i.e. Participants − Adult participants.',
  'Adult %': 'Adult participations ÷ all participations. Adult % + Non-adult % = 100%.',
  'Non-adult %': 'Non-adult (youth / unknown-age) participations ÷ all participations. Adult % + Non-adult % = 100%.',
  'Adult participation / 1,000 pop': 'Adult participations at in-state events ÷ state population × 1,000 (US Census, from step 2c). Supply-side per-capita reach.',
  'Population (Census)': 'State resident population (US Census ACS 1-year, loaded by step 2c).',
  'Home penetration / 1,000 pop': 'Distinct adult residents who race ÷ state population × 1,000 — residents racing per 1,000, counted once whether they race at home or away (demand-side reach).',
};
// Metric dropdown grouping — related metrics sit together with an <optgroup> divider between them.
// Each entry lists the metric INDICES (into the meta / metrics array) shown under that heading, in
// display order. Participation (0-6) stays first, in its original order. Values are the true metric
// index so metricIdx semantics are unchanged; a group is skipped if none of its metrics exist yet.
export const METRIC_GROUPS = [
  { label: 'Participation', idxs: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Adult vs non-adult', idxs: [42, 43, 44, 45] },
  { label: 'Gender', idxs: [7, 8, 9, 10] },
  { label: 'Age bands', idxs: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] },
  { label: 'Home / Away — of total', idxs: [23, 24, 36, 25, 26, 37] },
  { label: 'Home / Away — known basis (excl. Unknown)', idxs: [38, 39, 40, 41] },
  { label: 'IRONMAN', idxs: [27, 28] },
  { label: 'New vs Repeat', idxs: [29, 30, 31, 32] },
  { label: 'Unique athletes', idxs: [33, 34, 35] },
  { label: 'Travel flow (state ↔ state)', idxs: [46, 47, 48] },
  { label: 'Penetration & Opportunity', idxs: [51, 49, 50] },
];

export function metricDesc(label, popSrc) {
  if (!label) return '';
  let d = METRIC_DESC[label];
  if (!d) {
    if (/^Age .* %$/.test(label)) d = 'Share of participations in the ' + label.replace(' %', '') + ' age band.';
    else if (/^Age .* \(count\)$/.test(label)) d = 'Number of participations in the ' + label.replace(' (count)', '') + ' age band.';
    else if (/%$/.test(label)) d = label.replace(' %', '') + ' as a percentage of participations.';
    else if (/\(count\)$/.test(label)) d = 'Number of ' + label.replace(' (count)', '') + ' participations.';
    else d = label;
  }
  // Append the live Census population source to the population / penetration metric tooltips.
  if (popSrc && /(Population|penetration|\/ 1,000 pop)/i.test(label)) d += '  ·  Population source: ' + popSrc;
  return d;
}

export const MI = { PARTS: 0, PERRACE: 4, FEM: 7, HOME: 25, IMSHARE: 28, NEWCT: 29 };
export const MON3 = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MON_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function labelText(sy, sm) {
  const yp = (sy || []).slice().sort().join(', ');
  const mp = (!sm || sm.indexOf('all') >= 0) ? 'all months' : sm.slice().map(Number).sort((a, b) => a - b).map((m) => MON3[m]).join(', ');
  return yp + ' · ' + mp;
}
export function suf(sy, sm) { return (sy || []).join('-') + ((!sm || sm.indexOf('all') >= 0) ? '' : '_' + sm.join('-')); }
export function downloadCSV(fname, header, rows) {
  try { trackExport('participation-maps', 'map', 'csv'); } catch (e) { /* analytics best-effort */ }
  const esc = (v) => { v = (v == null) ? '' : ('' + v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = header.map(esc).join(',') + '\n' + rows.map((r) => r.map(esc).join(',')).join('\n');
  const b = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = fname; a.click();
}
// The unique family (Unique participants / % unique / Avg races per participant) is non-additive, so its
// per-slice values can't be summed. When the server has returned exact distincts for the current selection
// (uniqueData: { national, byState, byRegion }), this rebuilds those three metrics' statez/regionz/labels
// from the true distinct counts. Any other metric passes through unchanged.
export const UNIQ_IDX = { 33: 'count', 34: 'pct', 35: 'perpart' };
export function adjustUnique(base, idx, yb, uniqueData, p) {
  if (!base || !uniqueData || !yb || !(idx in UNIQ_IDX)) return base;
  const kind = UNIQ_IDX[idx];
  const abbr = p.abbr, ab2region = p.ab2region, regOrder = p.regOrder;
  const turn = yb.metrics[0].statez, regTurn = yb.metrics[0].regionz;   // participants (additive) per state / region
  const uState = uniqueData.byState || {}, uRegion = uniqueData.byRegion || {};
  const fmt = base.ispct ? 1 : (base.dec ? 2 : 0);
  const calc = (u, t) => {
    if (u == null) return null;
    if (kind === 'count') return u;
    if (kind === 'pct') return t ? Math.round(100 * u / t) : null;
    return u ? Math.round((t / u) * 100) / 100 : null;   // races per participant (2 dp)
  };
  const lab = (v) => (v == null ? 'n/a' : (fmt === 2 ? v.toFixed(2) : (fmt === 1 ? v + '%' : Number(v).toLocaleString())));
  const statez = abbr.map((ab, i) => calc(uState[ab] == null ? null : uState[ab], turn[i]));
  const regionz = abbr.map((ab, i) => calc(uRegion[ab2region[ab]] == null ? null : uRegion[ab2region[ab]], regTurn[i]));
  const vals = statez.filter((v) => v != null);
  const mn = vals.length ? Math.min.apply(null, vals) : 0, mx = vals.length ? Math.max.apply(null, vals) : 0;
  const labels = abbr.map((ab, i) => (statez[i] == null ? ab : ab + '<br>' + lab(statez[i])));
  const regionlabels = regOrder.map((rg) => { const i = abbr.findIndex((ab) => ab2region[ab] === rg); const v = i >= 0 ? regionz[i] : null; return v == null ? rg + '<br>n/a' : rg + '<br>' + lab(v); });
  return Object.assign({}, base, { statez, regionz, mn, mx, labels, regionlabels });
}
export const PIN_NON = '#082240', PIN_IM = '#C20E2F';
// Diverging palettes for the YoY map (a growth map needs +/- around 0, not a sequential ramp). The mid is
// injected theme-aware at render; "Reverse shades" swaps the negative/positive ends.
export const YOY_SCALES = [
  { name: 'Red → Green', neg: '#A32D2D', pos: '#27500A' },
  { name: 'Red → Blue', neg: '#A32D2D', pos: '#185FA5' },
  { name: 'Amber → Teal', neg: '#854F0B', pos: '#0F6E56' },
  { name: 'Magenta → Green', neg: '#72243E', pos: '#3B6D11' },
];
export function fmtEvDate(v) {
  if (!v) return '';
  const s = String(v); const m = +s.substr(5, 2), d = +s.substr(8, 2), y = s.substr(0, 4);
  return (MON3[m] || '') + ' ' + d + ', ' + y;
}

export function fmtVal(v, ispct, dec) {
  if (v == null) return 'n/a';
  if (dec) return Number(v).toFixed(2);
  return ispct ? v + '%' : Number(v).toLocaleString();
}
export function fmtShort(v) { if (v >= 1e6) return (v / 1e6) + 'M'; if (v >= 1e3) return (v / 1e3) + 'k'; return '' + v; }
export function parseRGB(c) {
  if (c[0] === '#') { const h = c.slice(1); const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h; return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]; }
  const m = c.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
}
export function sampleScale(scale, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < scale.length; i++) {
    if (t <= scale[i][0]) {
      const a = scale[i - 1], b = scale[i];
      const f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
      const ca = parseRGB(a[1]), cb = parseRGB(b[1]);
      return [0, 1, 2].map((k) => ca[k] + (cb[k] - ca[k]) * f);
    }
  }
  return parseRGB(scale[scale.length - 1][1]);
}
// Contrast-aware label color. Samples the ACTUAL fill each state receives — it mirrors Plotly's
// z -> [zmin,zmax] -> colorscale mapping (so it respects log / clip / rank / reverse and any palette)
// then picks dark or light text by luminance. No-data states fall back to the theme foreground so
// they stay legible. This is what makes every label dark-mode aware, not just the spotlighted ones.
export function labColor(zArr, zmin, zmax, scale, reverse, dark) {
  const vals = zArr.filter((v) => v != null);
  const lo = (zmin == null || isNaN(zmin)) ? (vals.length ? Math.min.apply(null, vals) : 0) : zmin;
  const hi = (zmax == null || isNaN(zmax)) ? (vals.length ? Math.max.apply(null, vals) : 1) : zmax;
  return zArr.map((v) => {
    if (v == null) return dark ? '#e2e8f0' : '#334155';
    let t = hi > lo ? (v - lo) / (hi - lo) : 0;
    t = Math.max(0, Math.min(1, t));
    if (reverse) t = 1 - t;
    const [r, g, b] = sampleScale(scale, t);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#0f172a' : '#ffffff';
  });
}
export function logTicks(mx) {
  const tv = [], tt = [];
  for (let pw = 0; Math.pow(10, pw) <= mx * 1.2; pw++) { const val = Math.pow(10, pw); tv.push(Math.log10(val + 1)); tt.push(fmtShort(val)); }
  return { tv, tt };
}
// Load topojson-client from CDN once (used to merge state borders into region outlines).
export function loadTopojson() {
  return new Promise((res, rej) => {
    if (window.topojson) return res(window.topojson);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/topojson-client@3';
    s.onload = () => res(window.topojson); s.onerror = rej;
    document.head.appendChild(s);
  });
}
// deck.gl (3D arcs for the Flows map) — lazy-loaded from CDN the first time Flows is opened.
export function loadDeck() {
  return new Promise((res, rej) => {
    if (window.deck) return res(window.deck);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/deck.gl@8.9.35/dist.min.js';
    s.onload = () => res(window.deck); s.onerror = rej;
    document.head.appendChild(s);
  });
}
export const FLOW_VIEW0 = { longitude: -96, latitude: 38.5, zoom: 3.4, pitch: 38, bearing: 0 };
export const FLOW_VIEW_FLAT = { longitude: -96, latitude: 38.5, zoom: 3.5, pitch: 0, bearing: 0 };  // Net view: top-down so nothing is clipped
export const REGION_PALETTE = ['#4C78A8', '#F58518', '#54A24B', '#B279A2', '#E45756', '#72B7B2', '#EECA3B', '#9D755D'];  // categorical region colors (Regions reference map)
export const FLOW_GEO_URL = 'https://cdn.jsdelivr.net/gh/PublicaMundi/MappingAPI@master/data/geojson/us-states.json';

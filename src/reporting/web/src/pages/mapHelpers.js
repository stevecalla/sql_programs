// Pure module-scope constants + helpers extracted from ParticipationMap.jsx (no React, no component state)
// so the map component file stays focused on rendering/interaction. Everything here is stateless: metric
// metadata, formatters, colorscale sampling, CSV export, CDN loaders, and view/palette constants.
import { trackExport } from '../lib/track.js';
import { OPP_C, OPP_LABEL } from './opportunity.jsx';

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
  'Home (count)': 'In-state PARTICIPATIONS (race entries where athlete home state = event state) — not unique athletes. Home + Away + Unknown home = total participations.',
  'Away (count)': 'Cross-state PARTICIPATIONS (race entries where home is a 50-state code ≠ event state) — not unique athletes.',
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
  'In-state penetration / 1,000 adults': 'Distinct adult (20+) residents who raced ONLY in their home state (home-only, never traveled out) ÷ ADULT population × 1,000 — identical to the Opportunity tab’s in-state penetration. A subset of all-states.',
  'Population (Census)': 'State resident population (US Census ACS 1-year, loaded by step 2c; also split into adult 20+ / youth <20).',
  'All-states penetration / 1,000 adults': 'Distinct adult (20+) residents who raced anywhere ÷ ADULT population × 1,000 — identical to the Opportunity tab’s all-states penetration (member-matched residents, adult denominator), counted once whether they raced at home or away.',
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

// Shared Plotly geo layout for the plain (non-mapbox) choropleth maps. Scale is the current zoom level.
export function geoLayout(zoom) {
  return {
    geo: { scope: 'usa', bgcolor: 'rgba(0,0,0,0)', lakecolor: 'rgba(0,0,0,0)', projection: { scale: zoom } },
    margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: 'rgba(0,0,0,0)', height: 560,
  };
}

// Regions reference map: states tinted by their region (categorical) + region borders + state/region labels.
// Pure trace builder (the component keeps the Plotly.react call + click handler).
export function buildRegionTraces(p, { dark, regionMesh, regionCentroids }) {
  const { abbr, names, regs, regOrder, centroid } = p;
  const nR = regOrder.length || 1;
  const cs = []; regOrder.forEach((rg, i) => { const c = REGION_PALETTE[i % REGION_PALETTE.length]; cs.push([i / nR, c]); cs.push([(i + 1) / nR, c]); });
  const rgi = (rg) => { const i = regOrder.indexOf(rg); return i < 0 ? 0 : i; };
  const z = abbr.map((ab, k) => (rgi(regs[k]) + 0.5) / nR);
  const cd = abbr.map((ab, k) => '<b>' + names[k] + '</b><br>' + regs[k] + ' region');
  const traces = [{
    type: 'choropleth', locationmode: 'USA-states', locations: abbr, z, zmin: 0, zmax: 1,
    customdata: cd, hovertemplate: '%{customdata}<extra></extra>',
    colorscale: cs, showscale: false, opacity: 0.5,
    marker: { line: { color: dark ? '#334155' : '#cbd5e1', width: 0.5 } },
  }];
  if (regionMesh) traces.push({ type: 'scattergeo', mode: 'lines', lon: regionMesh.lon, lat: regionMesh.lat, line: { width: 2.4, color: dark ? '#e2e8f0' : '#0f172a' }, hoverinfo: 'skip', showlegend: false });
  traces.push({ type: 'scattergeo', locationmode: 'USA-states', mode: 'text',
    lon: abbr.map((ab) => (centroid[ab] ? centroid[ab][0] : null)), lat: abbr.map((ab) => (centroid[ab] ? centroid[ab][1] : null)),
    text: abbr, textfont: { size: 11, color: dark ? '#e2e8f0' : '#334155' }, hoverinfo: 'skip', showlegend: false });
  const rlon = regOrder.map((rg) => (regionCentroids[rg] ? regionCentroids[rg][0] : null));
  const rlat = regOrder.map((rg) => (regionCentroids[rg] ? regionCentroids[rg][1] : null));
  const halo = dark ? '#0b1220' : '#ffffff';
  const rlabels = regOrder.map((rg) => rg.toUpperCase());
  const D = 0.18;  // tight outline offsets (a crisp halo, not spread-out duplicate copies)
  [[D, 0], [-D, 0], [0, D], [0, -D], [D, D], [D, -D], [-D, D], [-D, -D]].forEach(([dx, dy]) => {
    traces.push({ type: 'scattergeo', mode: 'text', lon: rlon.map((v) => (v == null ? null : v + dx)), lat: rlat.map((v) => (v == null ? null : v + dy)), text: rlabels, textfont: { size: 17, color: halo, family: 'Arial Black, Arial, sans-serif' }, hoverinfo: 'skip', showlegend: false });
  });
  traces.push({ type: 'scattergeo', mode: 'text', lon: rlon, lat: rlat, text: rlabels, textfont: { size: 17, color: dark ? '#f1f5f9' : '#0f172a', family: 'Arial Black, Arial, sans-serif' }, hoverinfo: 'skip', showlegend: false });
  return traces;
}

// Opportunity classification map: states shaded by band (leader / mid / under / floor) vs the national
// home-penetration benchmark, with contrast-aware two-line labels. Pure trace builder.
export function buildOpportunityTraces(p, oppData, { dark, showLabels, showOutlines, oppValues, regionMesh }) {
  const { abbr, names, centroid } = p;
  const byAb = {}; if (oppData) oppData.rows.forEach((r) => { byAb[r.ab] = r; });
  const BAND_I = { floor: 0, under: 1, mid: 2, leader: 3 };
  const C = [OPP_C.floor, OPP_C.under, OPP_C.mid, OPP_C.leader];
  const cs = [[0, C[0]], [0.249, C[0]], [0.251, C[1]], [0.499, C[1]], [0.501, C[2]], [0.749, C[2]], [0.751, C[3]], [1, C[3]]];
  const z = abbr.map((ab) => { const r = byAb[ab]; return r && r.band ? BAND_I[r.band] : null; });
  const cd = abbr.map((ab, k) => {
    const r = byAb[ab];
    if (!r || r.band == null) return '<b>' + names[k] + '</b><br>No penetration data';
    const bl = oppData.basisIn ? 'In-state' : 'All-states';
    return '<b>' + names[k] + '</b> — ' + OPP_LABEL[r.band]
      + '<br>' + bl + ' penetration: ' + r.dPen + ' / 1k  (national ' + oppData.dNational + ')'
      + '<br>Gap: ' + (r.dGap > 0 ? '+' : '') + r.dGap + ' / 1k'
      + (r.dHeadroom ? '<br>Headroom: ~' + r.dHeadroom.toLocaleString() + ' more athletes to reach national' : '<br>At or above the national rate');
  });
  const traces = [{
    type: 'choropleth', locationmode: 'USA-states', locations: abbr, z, zmin: 0, zmax: 3,
    customdata: cd, hovertemplate: '%{customdata}<extra></extra>',
    colorscale: cs, showscale: false, opacity: 0.96,
    marker: { line: { color: dark ? '#334155' : '#cbd5e1', width: 0.5 } },
  }];
  if (regionMesh && showOutlines) traces.push({ type: 'scattergeo', mode: 'lines', lon: regionMesh.lon, lat: regionMesh.lat, line: { width: 2.2, color: dark ? '#e2e8f0' : '#0f172a' }, hoverinfo: 'skip', showlegend: false });
  if (showLabels || oppValues) {
    const groups = {};
    abbr.forEach((ab) => {
      const c = centroid[ab]; if (!c) return; const r = byAb[ab]; const band = r && r.band;
      const col = (band === 'leader' || band === 'floor' || band === 'mid') ? '#ffffff'
        : band === 'under' ? '#3f2d00' : (dark ? '#e2e8f0' : '#1e293b');
      const t = (oppValues && r && r.dPen != null) ? ab + '<br>' + r.dPen.toFixed(2) : ab;
      (groups[col] = groups[col] || { lon: [], lat: [], text: [] });
      groups[col].lon.push(c[0]); groups[col].lat.push(c[1]); groups[col].text.push(t);
    });
    Object.keys(groups).forEach((col) => traces.push({ type: 'scattergeo', locationmode: 'USA-states', mode: 'text',
      lon: groups[col].lon, lat: groups[col].lat, text: groups[col].text,
      textfont: { size: 11, color: col, family: 'Arial, sans-serif' }, hoverinfo: 'skip', showlegend: false }));
  }
  return traces;
}

// Pins-over-basemap (scattermapbox) markers, sized by participants, split IRONMAN vs non. Pure trace
// builder; the component keeps the mapbox layout (pan/zoom is a ref) + relayout/click handlers.
export function buildPinTraces(pinEvents, p, { dark }) {
  const sr = (2 * (p.maxParts || 1)) / (40 * 40);
  const bmt = [];
  [['No', PIN_NON], ['Yes', PIN_IM]].forEach(([flag, color]) => {
    const rows = pinEvents.filter((r) => r[5] === flag);
    if (!rows.length) return;
    bmt.push({
      type: 'scattermapbox', mode: 'markers', lon: rows.map((r) => r[33]), lat: rows.map((r) => r[32]),
      marker: { size: rows.map((r) => r[6] || 0), sizemode: 'area', sizeref: sr, sizemin: 3, color, opacity: 0.82 },
      customdata: rows.map((r) => ['<b>' + r[2] + '</b><br>' + r[0] + ' · ' + r[1] + ' · ' + fmtEvDate(r[4]) + '<br>' + (r[6] || 0).toLocaleString() + ' participants · ' + (r[30] || 0).toLocaleString() + ' unique' + (flag === 'Yes' ? '<br><b>IRONMAN</b>' : ''), r[0]]),
      hovertemplate: '%{customdata[0]}<extra></extra>', showlegend: false,
    });
  });
  return bmt;
}

// Main state/region map: metric choropleth (value/rank, linear/log, color-max clip) OR YoY diverging fill
// OR neutral base (Pins look), plus contrast-aware state/region labels, the top-N gold spotlight (or YoY top
// movers), and the event-pins overlay. Pure trace builder — the component keeps Plotly.react + click. `opts`
// bundles the display-option state it reads.
export function buildChoroplethTraces(p, yb, opts) {
  const {
    metricIdx, uniqueData, colorIdx, view, fillMode, colorMode, logMode, clipMax, reverse, dark,
    spotN, showLabels, showOutlines, showPins, pinEvents, regionMesh, regionCentroids,
    yoyData, yoyColorIdx, yoyFrom, yoyTo, yoyTop,
  } = opts;
  const m = adjustUnique(yb.metrics[metricIdx] || yb.metrics[0], metricIdx, yb, uniqueData, p);
  const { abbr, names, regs, regOrder, centroid } = p;
  const scale = (p.colors[colorIdx] && p.colors[colorIdx].scale) || [[0, '#eef2ff'], [1, '#082240']];
  const fillOn = fillMode !== 'none';
  const yoyOn = fillMode === 'yoy' && !!yoyData;
  const yoyRegion = yoyOn && view === 'region';
  const yoyPal = YOY_SCALES[yoyColorIdx] || YOY_SCALES[0];
  const yoyLo = reverse ? yoyPal.pos : yoyPal.neg, yoyHi = reverse ? yoyPal.neg : yoyPal.pos;
  const yoyDiv = [[0, yoyLo], [0.5, dark ? '#0b1220' : '#f8fafc'], [1, yoyHi]];
  const yoyHover = yoyOn
    ? '<b>%{customdata[0]}</b><br>' + yoyFrom + ': %{customdata[1]} ' + yoyData.label
      + '<br>' + yoyTo + ': %{customdata[2]}<br>Change: %{customdata[3]}<extra></extra>'
    : '';

  const order = m.statez.map((v, k) => [v == null ? -Infinity : v, k]).sort((a, b) => b[0] - a[0]);
  const rank = new Array(m.statez.length); let valid = 0;
  order.forEach((x, ix) => { rank[x[1]] = ix + 1; if (x[0] !== -Infinity) valid++; });
  const N = m.statez.length;

  const regVal = {}; regOrder.forEach((rg) => { const i = regs.indexOf(rg); regVal[rg] = i >= 0 ? m.regionz[i] : null; });
  const regRankNames = regOrder.slice().sort((a, b) => (regVal[b] || 0) - (regVal[a] || 0));
  const regRank = {}; regRankNames.forEach((rg, ix) => { regRank[rg] = ix + 1; });
  const NR = regOrder.length;

  const T = yb.metrics[MI.PARTS].statez, PR = yb.metrics[MI.PERRACE].statez, FEM = yb.metrics[MI.FEM].statez,
    HOME = yb.metrics[MI.HOME].statez, IMS = yb.metrics[MI.IMSHARE].statez, NEWc = yb.metrics[MI.NEWCT].statez;

  const cdState = m.statez.map((v, k) => {
    const np = T[k] ? Math.round(100 * NEWc[k] / T[k]) : 0;
    return '<b>' + names[k] + '</b> · rank #' + rank[k] + ' of ' + valid + '<br>' + m.label + ': ' + fmtVal(v, m.ispct, m.dec)
      + '<br>Participants ' + (T[k] || 0).toLocaleString() + ' · Per race ' + (PR[k] == null ? '-' : PR[k])
      + '<br>IM ' + (IMS[k] || 0) + '% · Female ' + (FEM[k] || 0) + '% · Home ' + (HOME[k] || 0) + '% · New ' + np + '%';
  });
  const cdRegion = abbr.map((ab, k) => {
    const rg = regs[k];
    return '<b>' + rg + ' region</b> · rank #' + regRank[rg] + ' of ' + NR + '<br>' + m.label + ': '
      + fmtVal(m.regionz[k], m.ispct, m.dec) + '<br>' + names[k];
  });

  const isRegion = view === 'region';
  const canLog = logMode && !m.ispct && !m.dec;
  const tz = (v) => (v == null ? null : (canLog ? Math.log10(v + 1) : v));

  let z, cbTitle, tickvals = null, ticktext = null, zauto = true, zmin, zmax;
  if (colorMode === 'rank') {
    z = isRegion ? abbr.map((ab, k) => NR - regRank[regs[k]] + 1) : m.statez.map((v, k) => N - rank[k] + 1);
    cbTitle = 'Rank (dark = top)';
    const RN = isRegion ? NR : N;
    tickvals = isRegion ? [RN, 1] : [N, Math.max(1, N - 9), Math.max(1, N - 24), 1];
    ticktext = isRegion ? ['#1', '#' + RN] : ['#1', '#10', '#25', '#' + valid];
  } else {
    z = (isRegion ? m.regionz : m.statez).map(tz);
    cbTitle = m.label;
    if (canLog) { const lt = logTicks(m.mx); tickvals = lt.tv; ticktext = lt.tt; }
    if (clipMax !== '' && !isNaN(parseFloat(clipMax))) { zauto = false; zmin = tz(m.mn); zmax = tz(parseFloat(clipMax)); }
  }

  const neutralFill = dark ? '#1e293b' : '#e5e9f0';
  const traces = [yoyOn ? {
    type: 'choropleth', locationmode: 'USA-states', locations: abbr, z: yoyRegion ? yoyData.abbrRegZc : yoyData.zc,
    customdata: yoyRegion ? yoyData.abbrRegCd : yoyData.cd, hovertemplate: yoyHover,
    colorscale: yoyDiv, reversescale: false, zmid: 0, zauto: true,
    marker: { line: { color: dark ? '#334155' : '#cbd5e1', width: 0.5 } },
    colorbar: { title: { text: yoyData.label + ' · ' + (yoyData.abs ? 'change' : '% change') }, thickness: 12, ticksuffix: yoyData.abs ? '' : '%' },
  } : fillOn ? {
    type: 'choropleth', locationmode: 'USA-states', locations: abbr, z,
    customdata: isRegion ? cdRegion : cdState, hovertemplate: '%{customdata}<extra></extra>',
    colorscale: scale, reversescale: reverse, zauto, zmin, zmax,
    marker: { line: { color: dark ? '#334155' : '#cbd5e1', width: 0.5 } },
    colorbar: {
      title: { text: cbTitle }, thickness: 12,
      ticksuffix: (m.ispct && colorMode === 'value' && !canLog) ? '%' : '',
      tickvals, ticktext,
    },
  } : {
    type: 'choropleth', locationmode: 'USA-states', locations: abbr, z: abbr.map(() => 0),
    customdata: isRegion ? cdRegion : cdState, hovertemplate: '%{customdata}<extra></extra>',
    colorscale: [[0, neutralFill], [1, neutralFill]], showscale: false,
    marker: { line: { color: dark ? '#334155' : '#cbd5e1', width: 0.5 } },
  }];

  if ((showOutlines || view === 'region' || view === 'both') && regionMesh) {
    traces.push({
      type: 'scattergeo', mode: 'lines', lon: regionMesh.lon, lat: regionMesh.lat,
      line: { width: 2.2, color: dark ? '#e2e8f0' : '#0f172a' }, hoverinfo: 'skip', showlegend: false,
    });
  }
  if (!yoyOn && showLabels && (view === 'state' || view === 'both')) {
    traces.push({
      type: 'scattergeo', locationmode: 'USA-states', mode: 'text',
      lon: abbr.map((ab) => (centroid[ab] ? centroid[ab][0] : null)),
      lat: abbr.map((ab) => (centroid[ab] ? centroid[ab][1] : null)),
      text: m.labels, textfont: { size: 11, color: fillOn ? labColor(z, zauto ? null : zmin, zauto ? null : zmax, scale, reverse, dark) : (dark ? '#e2e8f0' : '#334155') },
      hoverinfo: 'skip', showlegend: false,
    });
  }
  if (yoyOn && showLabels && (view === 'state' || view === 'both')) {
    traces.push({
      type: 'scattergeo', locationmode: 'USA-states', mode: 'text',
      lon: abbr.map((ab) => (centroid[ab] ? centroid[ab][0] : null)),
      lat: abbr.map((ab) => (centroid[ab] ? centroid[ab][1] : null)),
      text: yoyData.lbl,
      textfont: { size: 11, color: yoyData.zc.map((v) => ((v != null && Math.abs(v) / yoyData.maxAbs > 0.5) ? '#ffffff' : (dark ? '#e2e8f0' : '#0f172a'))) },
      hoverinfo: 'skip', showlegend: false,
    });
  }
  if (yoyOn && showLabels && (view === 'region' || view === 'both')) {
    const rlon = regOrder.map((rg) => (regionCentroids[rg] ? regionCentroids[rg][0] : null));
    const rlat = regOrder.map((rg) => (regionCentroids[rg] ? regionCentroids[rg][1] : null));
    if (view === 'both') {
      const halo = dark ? '#0b1220' : '#ffffff';
      const offs = [[0.55, 0], [-0.55, 0], [0, 0.4], [0, -0.4], [0.42, 0.32], [-0.42, 0.32], [0.42, -0.32], [-0.42, -0.32]];
      offs.forEach(([dx, dy]) => {
        traces.push({
          type: 'scattergeo', mode: 'text',
          lon: rlon.map((v) => (v == null ? null : v + dx)),
          lat: rlat.map((v) => (v == null ? null : v + dy)),
          text: yoyData.regLbl, textfont: { size: 16, color: halo },
          hoverinfo: 'skip', showlegend: false,
        });
      });
    }
    traces.push({
      type: 'scattergeo', mode: 'text', lon: rlon, lat: rlat,
      text: yoyData.regLbl,
      textfont: { size: view === 'both' ? 16 : 14, color: view === 'both' ? '#C20E2F' : (dark ? '#e2e8f0' : '#0f172a') },
      hoverinfo: 'skip', showlegend: false,
    });
  }
  if (!yoyOn && showLabels && (view === 'region' || view === 'both')) {
    const rlon = regOrder.map((rg) => (regionCentroids[rg] ? regionCentroids[rg][0] : null));
    const rlat = regOrder.map((rg) => (regionCentroids[rg] ? regionCentroids[rg][1] : null));
    const regZ = regOrder.map((rg) => tz(regVal[rg]));
    if (view === 'both') {
      const halo = dark ? '#0b1220' : '#ffffff';
      const offs = [[0.55, 0], [-0.55, 0], [0, 0.4], [0, -0.4], [0.42, 0.32], [-0.42, 0.32], [0.42, -0.32], [-0.42, -0.32]];
      offs.forEach(([dx, dy]) => {
        traces.push({
          type: 'scattergeo', mode: 'text',
          lon: rlon.map((v) => (v == null ? null : v + dx)),
          lat: rlat.map((v) => (v == null ? null : v + dy)),
          text: m.regionlabels, textfont: { size: 16, color: halo },
          hoverinfo: 'skip', showlegend: false,
        });
      });
    }
    traces.push({
      type: 'scattergeo', mode: 'text', lon: rlon, lat: rlat,
      text: m.regionlabels,
      textfont: { size: view === 'both' ? 16 : 14, color: view === 'both' ? '#C20E2F' : (fillOn ? labColor(regZ, zauto ? null : zmin, zauto ? null : zmax, scale, reverse, dark) : (dark ? '#e2e8f0' : '#0f172a')) },
      hoverinfo: 'skip', showlegend: false,
    });
  }
  if (spotN && (fillOn || showPins) && !yoyOn) {
    const top = order.filter((x) => x[0] !== -Infinity).slice(0, spotN);
    const goldAbbr = top.slice(0, 10).map((x) => abbr[x[1]]);
    traces.push({
      type: 'choropleth', locationmode: 'USA-states', locations: goldAbbr, z: goldAbbr.map(() => 1),
      colorscale: [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']], showscale: false, hoverinfo: 'skip',
      marker: { line: { color: '#D4920A', width: 2.5 } },
    });
    traces.push({
      type: 'scattergeo', mode: 'markers+text',
      lon: top.map((x) => centroid[abbr[x[1]]][0]),
      lat: top.map((x) => centroid[abbr[x[1]]][1] + 1.6),
      text: top.map((_, i) => '' + (i + 1)),
      marker: { size: 21, color: '#D4920A', line: { width: 1.5, color: 'white' } },
      textfont: { size: 12, color: 'white' }, textposition: 'middle center',
      hoverinfo: 'skip', showlegend: false,
    });
  }
  if (yoyOn && !yoyRegion && yoyTop && yoyTop !== 'off') {
    const kd = yoyTop[0], nn = parseInt(yoyTop.slice(1), 10);
    let ix = abbr.map((ab, i) => [yoyData.z[i], i]).filter((x) => x[0] != null);
    if (kd === 'g') ix.sort((a, b) => b[0] - a[0]);
    else if (kd === 'd') ix.sort((a, b) => a[0] - b[0]);
    else ix.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
    ix = ix.slice(0, nn);
    const gold = ix.map((x) => abbr[x[1]]);
    traces.push({
      type: 'choropleth', locationmode: 'USA-states', locations: gold, z: gold.map(() => 1),
      colorscale: [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']], showscale: false, hoverinfo: 'skip',
      marker: { line: { color: '#D4920A', width: 2.5 } },
    });
    traces.push({
      type: 'scattergeo', mode: 'markers+text',
      lon: ix.map((x) => centroid[abbr[x[1]]][0]),
      lat: ix.map((x) => centroid[abbr[x[1]]][1] + 1.6),
      text: ix.map((_, i) => '' + (i + 1)),
      marker: { size: 21, color: '#D4920A', line: { width: 1.5, color: 'white' } },
      textfont: { size: 12, color: 'white' }, textposition: 'middle center',
      hoverinfo: 'skip', showlegend: false,
    });
  }
  if (showPins && pinEvents.length) {
    const sr = (2 * (p.maxParts || 1)) / (40 * 40);
    const layers = [['No', PIN_NON], ['Yes', PIN_IM]];
    layers.forEach(([flag, color]) => {
      const rows = pinEvents.filter((r) => r[5] === flag);
      if (!rows.length) return;
      traces.push({
        type: 'scattergeo', mode: 'markers', lon: rows.map((r) => r[33]), lat: rows.map((r) => r[32]),
        marker: {
          size: rows.map((r) => r[6] || 0), sizemode: 'area', sizeref: sr, sizemin: 3,
          color, opacity: 0.62, line: { width: 0.4, color: 'white' },
        },
        customdata: rows.map((r) => [
          '<b>' + r[2] + '</b><br>' + r[0] + ' · ' + r[1] + ' · ' + fmtEvDate(r[4])
          + '<br>' + (r[6] || 0).toLocaleString() + ' participants · ' + (r[30] || 0).toLocaleString() + ' unique'
          + (flag === 'Yes' ? '<br><b>IRONMAN</b>' : ''),
          r[0],
        ]),
        hovertemplate: '%{customdata[0]}<extra></extra>', showlegend: false,
      });
    });
  }
  return traces;
}

// deck.gl layers for the Flows (3D arcs) map: net-flow state fill, optional region outlines, focus-state
// route arcs, net-flow text labels, and the top-N gold outline + rank badges. Pure builder — the component
// keeps the deck instance, tooltip, onClick, and stat line. `deck` is the loaded deck.gl global; `geo` is
// the US-states GeoJSON; ctx bundles the aggregated flow data + display options.
export function buildFlowLayers(deck, geo, ctx) {
  const { p, name2ab, net, maxNet, arcs, maxArc, arcsOn, keys, showLabels, showOutlines, regionMesh, dark, A, flowFocus, flowDir, flowTop } = ctx;
  const layers = [];
  layers.push(new deck.GeoJsonLayer({
    id: 'st', data: geo, stroked: true, filled: true,
    getFillColor: (f) => { const ab = name2ab[f.properties.name]; if (!ab) return [241, 245, 249, 110]; const nv = net[ab] || 0; const t = Math.min(1, Math.abs(nv) / maxNet); const al = 40 + Math.round(160 * t); return nv >= 0 ? [194, 14, 47, al] : [24, 95, 165, al]; },
    getLineColor: [255, 255, 255], lineWidthMinPixels: 1, pickable: true, updateTriggers: { getFillColor: [keys.join(), maxNet] },
  }));
  // Region outlines (optional): rebuild deck paths from the Plotly mesh ({lon,lat} with null separators).
  if (showOutlines && regionMesh) {
    const paths = []; let cur = [];
    for (let i = 0; i < regionMesh.lon.length; i++) {
      const lo = regionMesh.lon[i], la = regionMesh.lat[i];
      if (lo == null || la == null) { if (cur.length > 1) paths.push(cur); cur = []; }
      else cur.push([lo, la]);
    }
    if (cur.length > 1) paths.push(cur);
    layers.push(new deck.PathLayer({
      id: 'rout', data: paths, getPath: (d) => d, getColor: dark ? [226, 232, 240] : [15, 23, 42],
      widthUnits: 'pixels', getWidth: 2, widthMinPixels: 1.4, parameters: { depthTest: false },
    }));
  }
  layers.push(new deck.ArcLayer({
    id: 'arc', data: arcs, getSourcePosition: (d) => d.s, getTargetPosition: (d) => d.t,
    getSourceColor: (d) => d.c, getTargetColor: (d) => d.c, getWidth: (d) => 1 + 6 * Math.sqrt(d.n / maxArc),
    getHeight: 0.4, pickable: true, updateTriggers: { getWidth: [maxArc] },
  }));
  if (showLabels) layers.push(new deck.TextLayer({   // Labels toggle controls net + arcs labels alike
    id: 'lab', data: p.abbr.filter((ab) => p.centroid[ab]), getPosition: (ab) => p.centroid[ab],
    getText: (ab) => { const n = net[ab] || 0; const s = (n > 0 ? '+' : '') + n.toLocaleString(); return arcsOn ? ab + '\n' + s : ab + '  ' + s; },
    getSize: arcsOn ? 12 : 13, fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: 700,
    getColor: (ab) => { const n = net[ab] || 0; return n > 0 ? [19, 78, 10] : (n < 0 ? [122, 20, 20] : [15, 23, 42]); },
    getTextAnchor: 'middle', getAlignmentBaseline: 'center', lineHeight: 1.05, fontSettings: { sdf: true },
    outlineWidth: 3, outlineColor: [255, 255, 255], background: true, getBackgroundColor: [255, 255, 255, 228],
    backgroundPadding: [4, 2, 4, 2], updateTriggers: { getText: [keys.join(), arcsOn, ctx.flowIM], getColor: [keys.join(), ctx.flowIM], getSize: [arcsOn] },
  }));

  // Top-N partner states by flow volume with the focus -> gold outline + numbered rank badges.
  const badgeRows = [];
  if (flowFocus && arcsOn) {
    const by = {};
    if (flowDir !== 'out') A.flows.filter((r) => r[1] === flowFocus).forEach((r) => { by[r[0]] = (by[r[0]] || 0) + r[2]; });
    if (flowDir !== 'in') A.flows.filter((r) => r[0] === flowFocus).forEach((r) => { by[r[1]] = (by[r[1]] || 0) + r[2]; });
    Object.keys(by).map((ab) => [ab, by[ab]]).sort((a, b) => b[1] - a[1]).slice(0, flowTop).forEach((x, i) => {
      if (p.centroid[x[0]]) badgeRows.push({ ab: x[0], rank: i + 1, n: x[1], pos: p.centroid[x[0]] });
    });
  }
  const badgeSet = {}; badgeRows.forEach((b) => { badgeSet[b.ab] = true; });
  layers.push(new deck.GeoJsonLayer({
    id: 'gold', data: geo, stroked: true, filled: false,
    getLineColor: (f) => (badgeSet[name2ab[f.properties.name]] ? [212, 146, 10, 255] : [0, 0, 0, 0]),
    lineWidthUnits: 'pixels', getLineWidth: 2.5, lineWidthMinPixels: 2,
    updateTriggers: { getLineColor: [Object.keys(badgeSet).join()] },
  }));
  layers.push(new deck.TextLayer({
    id: 'badge', data: badgeRows, getPosition: (d) => d.pos, getText: (d) => '' + d.rank,
    getSize: 14, fontWeight: 700, getColor: [255, 255, 255], getTextAnchor: 'middle', getAlignmentBaseline: 'center',
    billboard: true, getPixelOffset: [22, -24],
    background: true, getBackgroundColor: [212, 146, 10, 255], backgroundPadding: [6, 3, 6, 3],
    fontSettings: { sdf: true }, outlineWidth: 2, outlineColor: [255, 255, 255],
    parameters: { depthTest: false }, characterSet: '0123456789',
  }));
  return layers;
}

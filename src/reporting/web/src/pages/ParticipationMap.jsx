import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getYearBlock, kpisFromYB, computeYoY, resolveSlices, aggregateFlows } from '../lib/compute.js';
import { trackFilter, trackExport, track } from '../lib/track.js';
import ParticipationTabs from './ParticipationTabs.jsx';

// Plain-language description per metric (for hover tooltips). Full definitions live on the Reference tab.
const METRIC_DESC = {
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
};
// Metric dropdown grouping — related metrics sit together with an <optgroup> divider between them.
// Each entry lists the metric INDICES (into the meta / metrics array) shown under that heading, in
// display order. Participation (0-6) stays first, in its original order. Values are the true metric
// index so metricIdx semantics are unchanged; a group is skipped if none of its metrics exist yet.
const METRIC_GROUPS = [
  { label: 'Participation', idxs: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Gender', idxs: [7, 8, 9, 10] },
  { label: 'Age bands', idxs: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] },
  { label: 'Home / Away — of total', idxs: [23, 24, 36, 25, 26, 37] },
  { label: 'Home / Away — known basis (excl. Unknown)', idxs: [38, 39, 40, 41] },
  { label: 'IRONMAN', idxs: [27, 28] },
  { label: 'New vs Repeat', idxs: [29, 30, 31, 32] },
  { label: 'Unique athletes', idxs: [33, 34, 35] },
];

function metricDesc(label) {
  if (!label) return '';
  if (METRIC_DESC[label]) return METRIC_DESC[label];
  if (/^Age .* %$/.test(label)) return 'Share of participations in the ' + label.replace(' %', '') + ' age band.';
  if (/^Age .* \(count\)$/.test(label)) return 'Number of participations in the ' + label.replace(' (count)', '') + ' age band.';
  if (/%$/.test(label)) return label.replace(' %', '') + ' as a percentage of participations.';
  if (/\(count\)$/.test(label)) return 'Number of ' + label.replace(' (count)', '') + ' participations.';
  return label;
}

// Native participation map — state choropleth at POC parity: metric fill (value / rank, linear / log,
// color-max clip), data labels, top-N gold spotlight, state / region / both with merged region borders,
// colorscale picker, zoom, PNG export (titled) and fullscreen. Map-style switcher scaffold hosts pins /
// YoY / flows next (tasks 54-56). Driven by the live /api/bootstrap payload.

const MI = { PARTS: 0, PERRACE: 4, FEM: 7, HOME: 25, IMSHARE: 28, NEWCT: 29 };
const MON3 = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function labelText(sy, sm) {
  const yp = (sy || []).slice().sort().join(', ');
  const mp = (!sm || sm.indexOf('all') >= 0) ? 'all months' : sm.slice().map(Number).sort((a, b) => a - b).map((m) => MON3[m]).join(', ');
  return yp + ' · ' + mp;
}
function suf(sy, sm) { return (sy || []).join('-') + ((!sm || sm.indexOf('all') >= 0) ? '' : '_' + sm.join('-')); }
function downloadCSV(fname, header, rows) {
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
const UNIQ_IDX = { 33: 'count', 34: 'pct', 35: 'perpart' };
function adjustUnique(base, idx, yb, uniqueData, p) {
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
const PIN_NON = '#082240', PIN_IM = '#C20E2F';
// Diverging palettes for the YoY map (a growth map needs +/- around 0, not a sequential ramp). The mid is
// injected theme-aware at render; "Reverse shades" swaps the negative/positive ends.
const YOY_SCALES = [
  { name: 'Red → Green', neg: '#A32D2D', pos: '#27500A' },
  { name: 'Red → Blue', neg: '#A32D2D', pos: '#185FA5' },
  { name: 'Amber → Teal', neg: '#854F0B', pos: '#0F6E56' },
  { name: 'Magenta → Green', neg: '#72243E', pos: '#3B6D11' },
];
function fmtEvDate(v) {
  if (!v) return '';
  const s = String(v); const m = +s.substr(5, 2), d = +s.substr(8, 2), y = s.substr(0, 4);
  return (MON3[m] || '') + ' ' + d + ', ' + y;
}

function fmtVal(v, ispct, dec) {
  if (v == null) return 'n/a';
  if (dec) return Number(v).toFixed(2);
  return ispct ? v + '%' : Number(v).toLocaleString();
}
function fmtShort(v) { if (v >= 1e6) return (v / 1e6) + 'M'; if (v >= 1e3) return (v / 1e3) + 'k'; return '' + v; }
function parseRGB(c) {
  if (c[0] === '#') { const h = c.slice(1); const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h; return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]; }
  const m = c.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
}
function sampleScale(scale, t) {
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
function labColor(zArr, zmin, zmax, scale, reverse, dark) {
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
function logTicks(mx) {
  const tv = [], tt = [];
  for (let pw = 0; Math.pow(10, pw) <= mx * 1.2; pw++) { const val = Math.pow(10, pw); tv.push(Math.log10(val + 1)); tt.push(fmtShort(val)); }
  return { tv, tt };
}
// Load topojson-client from CDN once (used to merge state borders into region outlines).
function loadTopojson() {
  return new Promise((res, rej) => {
    if (window.topojson) return res(window.topojson);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/topojson-client@3';
    s.onload = () => res(window.topojson); s.onerror = rej;
    document.head.appendChild(s);
  });
}
// deck.gl (3D arcs for the Flows map) — lazy-loaded from CDN the first time Flows is opened.
function loadDeck() {
  return new Promise((res, rej) => {
    if (window.deck) return res(window.deck);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/deck.gl@8.9.35/dist.min.js';
    s.onload = () => res(window.deck); s.onerror = rej;
    document.head.appendChild(s);
  });
}
const FLOW_VIEW0 = { longitude: -96, latitude: 38.5, zoom: 3.4, pitch: 38, bearing: 0 };
const FLOW_GEO_URL = 'https://cdn.jsdelivr.net/gh/PublicaMundi/MappingAPI@master/data/geojson/us-states.json';

export default function ParticipationMap() {
  const [st, setSt] = useState({ loading: true });
  const [selYears, setSelYears] = useState(null);
  const [selMonths, setSelMonths] = useState(['all']);
  const [monthOpen, setMonthOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [tabsReady, setTabsReady] = useState(false);
  const [metricIdx, setMetricIdx] = useState(0);
  const [view, setView] = useState('state');       // state | region | both
  const [showLabels, setShowLabels] = useState(true);
  const [showOutlines, setShowOutlines] = useState(false);
  const [spotN, setSpotN] = useState(10);            // 0 | 5 | 10 | 25 | 50 (All)
  const [colorIdx, setColorIdx] = useState(0);
  const [yoyColorIdx, setYoyColorIdx] = useState(0);  // index into YOY_SCALES (diverging) for the YoY map
  const [colorMode, setColorMode] = useState('value'); // value | rank
  const [logMode, setLogMode] = useState(false);
  const [clipMax, setClipMax] = useState('');
  const [reverse, setReverse] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fillMode, setFillMode] = useState('choro'); // 'none' (neutral) | 'choro' (metric fill) | 'yoy' (growth fill)
  const [showPins, setShowPins] = useState(false);   // independent event-pins overlay (on/off)
  const [pinIm, setPinIm] = useState('');            // '' all | 'Yes' IRONMAN only | 'No' non-IRONMAN only
  const [basemap, setBasemap] = useState(false);     // Pins map: overlay a real carto tile basemap (vs the clean vector map)
  const [yoyFrom, setYoyFrom] = useState('');        // YoY baseline year
  const [yoyTo, setYoyTo] = useState('');            // YoY comparison year
  const [yoyMode, setYoyMode] = useState('pct');     // 'pct' (% change) | 'abs' (absolute change)
  const [yoyTop, setYoyTop] = useState('g10');       // g5|g10|d5|d10|m10|off — top-movers spotlight
  const [showFlows, setShowFlows] = useState(false); // Flows (deck.gl 3D arcs) — exclusive full-map mode
  const [flowFocus, setFlowFocus] = useState('');    // focus state abbr ('' = net-flow shading only)
  const [flowDir, setFlowDir] = useState('both');    // both | in | out
  const [flowTop, setFlowTop] = useState(5);         // top-N routes per direction
  const [flowSpin, setFlowSpin] = useState(false);   // auto-rotate (bearing animation)
  const [flowStat, setFlowStat] = useState('');      // footer stat line
  const [stateSel, setStateSel] = useState(null);
  const [regionSel, setRegionSel] = useState('');
  const [regionMesh, setRegionMesh] = useState(null);
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');
  const mapRef = useRef(null);
  const cardRef = useRef(null);
  const monthRef = useRef(null);
  const yearRef = useRef(null);
  const deckRef = useRef(null);        // deck.gl canvas container
  const deckInst = useRef(null);       // DeckGL instance
  const flowGeoRef = useRef(null);     // cached us-states GeoJSON
  const flowViewRef = useRef({ ...FLOW_VIEW0 });
  const spinRaf = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');

  // Force-live refresh: ask the server to rebuild from MySQL now (bypassing the TTL) and swap in the fresh
  // data WITHOUT resetting the user's current metric / year / view. If MySQL is unreachable the server keeps
  // (and returns) the last cached payload — source stays 'fixture' and the backup is never overwritten — so
  // we just tell the user we kept the cached copy.
  const doRefresh = async () => {
    setRefreshing(true); setRefreshNote('');
    try {
      const { status, body } = await api.bootstrap(true);
      if (status === 200 && body.ok) {
        setSt({ loading: false, p: body.data, source: body.source });   // new payload re-triggers the exact-unique fetch
        window.dispatchEvent(new CustomEvent('reporting:refreshed'));   // update the header "Last refresh" badge
        setRefreshNote(body.source === 'mysql'
          ? ('✓ Live · as of ' + (body.data.lastUpdated || 'now'))
          : '⚠ Database unreachable — kept last cached data');
      } else {
        setRefreshNote('⚠ Refresh failed: ' + (body.error || ('HTTP ' + status)));
      }
    } catch (e) {
      setRefreshNote('⚠ Refresh failed: ' + e.message);
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshNote(''), 7000);
    }
  };

  useEffect(() => {
    (async () => {
      const { status, body } = await api.bootstrap();
      if (status === 200 && body.ok) {
        const p = body.data;
        const years = Object.keys(p.byYear || {}).sort();
        const ci = (p.colors || []).findIndex((c) => /blues/i.test(c.name || ''));
        setColorIdx(ci >= 0 ? ci : 0);
        setSt({ loading: false, p, source: body.source });
        setSelYears([years[years.length - 1]]);
        setYoyTo(years[years.length - 1]);
        setYoyFrom(years[years.length - 2] || years[years.length - 1]);
        setFlowFocus((p.abbr && p.abbr.indexOf('CA') >= 0) ? 'CA' : ((p.abbr && p.abbr[0]) || ''));  // default Flows focus = CA
      } else {
        setSt({ loading: false, error: body.error || ('HTTP ' + status), code: body.code });
      }
    })();
  }, []);

  // Re-render on theme flip.
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.getAttribute('data-theme') === 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Mount the (heavy) tables a beat after the map/controls paint, so the controls are interactive on load.
  useEffect(() => {
    if (st.loading || st.error) return;
    const id = setTimeout(() => setTabsReady(true), 60);
    return () => clearTimeout(id);
  }, [st.loading, st.error]);

  // Close the month / year dropdowns on any outside click.
  useEffect(() => {
    if (!monthOpen && !yearOpen) return;
    const onDoc = (e) => {
      if (monthOpen && monthRef.current && !monthRef.current.contains(e.target)) setMonthOpen(false);
      if (yearOpen && yearRef.current && !yearRef.current.contains(e.target)) setYearOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [monthOpen, yearOpen]);

  // Fullscreen resize.
  useEffect(() => {
    const onFs = () => {
      const full = !!document.fullscreenElement;
      if (mapRef.current) { Plotly.relayout(mapRef.current, { height: full ? window.innerHeight - 90 : 560 }); setTimeout(() => Plotly.Plots.resize(mapRef.current), 120); }
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Merge state borders -> region outlines (us-atlas TopoJSON + fips2region). Lazy: only fetch when
  // outlines are actually shown (Region/Both view or the toggle), and only once — keeps the default
  // State-view load light (no CDN fetch, no extra map redraw).
  useEffect(() => {
    if (!st.p || regionMesh) return;
    if (!(showOutlines || view === 'region' || view === 'both')) return;
    let cancelled = false;
    loadTopojson()
      .then((topojson) => fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json').then((r) => r.json()).then((topo) => {
        const F2R = st.p.fips2region;
        const mesh = topojson.mesh(topo, topo.objects.states, (a, b) => a === b || F2R[a.id] !== F2R[b.id]);
        const lon = [], lat = [];
        mesh.coordinates.forEach((line) => { line.forEach((pt) => { lon.push(pt[0]); lat.push(pt[1]); }); lon.push(null); lat.push(null); });
        if (!cancelled) setRegionMesh({ lon, lat });
      }))
      .catch((e) => console.warn('region outline load failed', e));
    return () => { cancelled = true; };
  }, [st.p, showOutlines, view, regionMesh]);

  // Region label anchors = mean of member-state centroids (AK/HI excluded — insets on albers-usa).
  const regionCentroids = useMemo(() => {
    if (!st.p) return {};
    const { centroid, ab2region, abbr } = st.p;
    const acc = {};
    abbr.forEach((ab) => {
      if (ab === 'AK' || ab === 'HI') return;
      const rg = ab2region[ab]; const c = centroid[ab];
      if (!rg || !c) return;
      acc[rg] = acc[rg] || { lon: 0, lat: 0, n: 0 };
      acc[rg].lon += c[0]; acc[rg].lat += c[1]; acc[rg].n += 1;
    });
    const out = {};
    Object.keys(acc).forEach((rg) => { out[rg] = [acc[rg].lon / acc[rg].n, acc[rg].lat / acc[rg].n]; });
    return out;
  }, [st.p]);

  // Aggregated year-block for the current selection (single full year is exact; else computeAgg).
  const yb = useMemo(() => (st.p && selYears && selYears.length ? getYearBlock(st.p, selYears, selMonths) : null), [st.p, selYears, selMonths]);

  // Exact unique athletes for the current period, counted live from the base table (non-additive metric).
  // Only the whole-map selection (years + months) drives this; cross-filters stay with pins/events.
  const [uniqueData, setUniqueData] = useState(null);
  const [uniqLoading, setUniqLoading] = useState(false);
  const [flowLoading, setFlowLoading] = useState(false);
  const uniqSeq = useRef(0);
  const yoySeq = useRef(0);
  const mapModeRef = useRef('geo');   // 'geo' | 'mapbox' — purge when switching so Plotly changes subplot type cleanly
  const BASEMAP_VIEW0 = { center: { lon: -96, lat: 38.7 }, zoom: 3.2 };
  const basemapViewRef = useRef({ ...BASEMAP_VIEW0 });   // persist basemap pan/zoom across re-renders
  useEffect(() => {
    if (!st.p || !selYears || !selYears.length) { setUniqueData(null); setUniqLoading(false); return; }
    if (fillMode === 'yoy') { setUniqLoading(false); return; }   // YoY uses yoyUniq; don't also fire the choropleth-unique query
    const seq = ++uniqSeq.current;   // latest-wins: only the newest request clears the spinner, so it can't get stuck on rapid re-fires
    setUniqLoading(true);   // keep the last-good exact values visible (under the loading overlay) — no flash to the summed approximation
    api.uniqueFor({ years: selYears, months: selMonths })
      .then(({ status, body }) => { if (seq !== uniqSeq.current) return; setUniqueData(status === 200 && body && body.ok ? body : null); setUniqLoading(false); })
      .catch(() => { if (seq === uniqSeq.current) { setUniqueData(null); setUniqLoading(false); } });
  }, [st.p, selYears, selMonths, fillMode]);
  const availMonths = useMemo(() => {
    if (!st.p || !selYears) return [];
    const set = new Set();
    selYears.forEach((y) => (st.p.monthsByYear[y] || []).forEach((m) => set.add(m)));
    return Array.from(set).sort((a, b) => a - b);
  }, [st.p, selYears]);

  // Focus state's top routes (readable list under the map — arcs are hard to hover). Honors direction.
  const flowRoutes = useMemo(() => {
    if (!st.p || !showFlows || !flowFocus) return null;
    const keys = resolveSlices(selYears, selMonths, st.p.monthsByYear);
    const A = aggregateFlows(keys, st.p.odByYM);
    const nm = (ab) => st.p.names[st.p.abbr.indexOf(ab)] || ab;
    const inb = A.flows.filter((r) => r[1] === flowFocus).sort((a, b) => b[2] - a[2]).slice(0, flowTop).map((r) => [nm(r[0]), r[2]]);
    const outb = A.flows.filter((r) => r[0] === flowFocus).sort((a, b) => b[2] - a[2]).slice(0, flowTop).map((r) => [nm(r[1]), r[2]]);
    return { inb, outb, focusName: nm(flowFocus) };
  }, [st.p, showFlows, flowFocus, flowTop, selYears, selMonths]);

  // YoY change per state (only computed when the YoY fill is active). Uses the selected months so a
  // partial period compares like-for-like against the same months of the baseline year.
  // Exact from/to distincts for the YoY unique family (33/34/35) so % change uses true distincts, not the
  // summed approximation. Months are the like-for-like overlap (same rule computeYoY uses for turnout).
  const [yoyUniq, setYoyUniq] = useState(null);
  const [yoyUniqLoading, setYoyUniqLoading] = useState(false);
  useEffect(() => {
    if (fillMode !== 'yoy' || !(metricIdx in UNIQ_IDX) || !st.p || !yoyFrom || !yoyTo) { setYoyUniq(null); setYoyUniqLoading(false); return; }
    const fromMos = st.p.monthsByYear[yoyFrom] || [], toMos = st.p.monthsByYear[yoyTo] || [];
    const mos = (selMonths.indexOf('all') >= 0) ? fromMos.filter((m) => toMos.indexOf(m) >= 0) : selMonths.map(Number).filter((m) => fromMos.indexOf(m) >= 0 && toMos.indexOf(m) >= 0);
    const monthsArg = mos.map(String);
    const seq = ++yoySeq.current; setYoyUniqLoading(true);   // latest-wins guard (keeps last-good under the overlay, spinner can't stick)
    const bail = new Promise((res) => setTimeout(() => res('__t'), 25000));   // failsafe: a slow/stale DB can't hang the loader forever
    Promise.race([Promise.all([api.uniqueFor({ years: [yoyFrom], months: monthsArg }), api.uniqueFor({ years: [yoyTo], months: monthsArg })]), bail])
      .then((r) => {
        if (seq !== yoySeq.current) return;
        if (r === '__t') { setYoyUniqLoading(false); return; }   // timed out -> keep the summed fallback, clear the loader
        const okF = (r[0].status === 200 && r[0].body && r[0].body.ok) ? r[0].body : null;
        const okT = (r[1].status === 200 && r[1].body && r[1].body.ok) ? r[1].body : null;
        setYoyUniq(okF && okT ? { from: okF, to: okT } : null);
        setYoyUniqLoading(false);
      })
      .catch(() => { if (seq === yoySeq.current) { setYoyUniq(null); setYoyUniqLoading(false); } });
  }, [fillMode, metricIdx, st.p, yoyFrom, yoyTo, selMonths]);

  const yoyData = useMemo(() => {
    if (!st.p || fillMode !== 'yoy' || !yoyFrom || !yoyTo) return null;
    return computeYoY(st.p, yoyFrom, yoyTo, selMonths, metricIdx, yoyMode, yoyUniq);
  }, [st.p, fillMode, yoyFrom, yoyTo, selMonths, metricIdx, yoyMode, yoyUniq]);

  // Pins layer: event roll-ups across the selected years, honoring the same filters as the Events tab
  // (Year, Month, region/state cross-filter, IRONMAN). Only events with resolved coordinates get a pin.
  const pinEvents = useMemo(() => {
    if (!st.p || !showPins || !selYears || !selYears.length) return [];
    const allM = selMonths.indexOf('all') >= 0;
    let a = [];
    selYears.forEach((y) => { a = a.concat(st.p.eventsByYear[y] || []); });
    return a.filter((r) => {
      if (r[32] == null || r[33] == null) return false;                 // needs lat/lng (32/33 after Unknown cols)
      if (!allM && r[4] && selMonths.indexOf(String(+String(r[4]).substr(5, 2))) < 0) return false;
      if (regionSel && r[1] !== regionSel) return false;
      if (stateSel && r[0] !== stateSel) return false;
      if (pinIm && r[5] !== pinIm) return false;
      return true;
    });
  }, [st.p, showPins, selYears, selMonths, regionSel, stateSel, pinIm]);

  useEffect(() => {
    if (st.loading || st.error || !yb || !mapRef.current || showFlows) return;  // Flows uses the deck canvas
    const p = st.p;
    // Tiled basemap mode for the Pins map: event pins over a carto basemap (real geographic detail, free/no token).
    const wantMapbox = basemap && showPins && pinEvents.length > 0;
    if (mapModeRef.current !== (wantMapbox ? 'mapbox' : 'geo')) { try { Plotly.purge(mapRef.current); } catch (e) { /* switch subplot type cleanly */ } mapModeRef.current = wantMapbox ? 'mapbox' : 'geo'; }
    if (wantMapbox) {
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
      Plotly.react(mapRef.current, bmt, {
        mapbox: { style: dark ? 'carto-darkmatter' : 'carto-positron', center: basemapViewRef.current.center, zoom: basemapViewRef.current.zoom },
        margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: 'rgba(0,0,0,0)', height: 560,
      }, { displayModeBar: false, responsive: true, scrollZoom: true }).then((gd) => {
        if (!gd || !gd.on) return;
        gd.removeAllListeners && gd.removeAllListeners('plotly_click');
        gd.removeAllListeners && gd.removeAllListeners('plotly_relayout');
        // Remember pan/zoom so a re-render (e.g. a click cross-filter) doesn't snap the basemap back.
        gd.on('plotly_relayout', (e) => {
          if (e['mapbox.center']) basemapViewRef.current.center = e['mapbox.center'];
          if (e['mapbox.zoom'] != null) basemapViewRef.current.zoom = e['mapbox.zoom'];
        });
        gd.on('plotly_click', (ev) => {
          const pt = ev.points && ev.points[0]; if (!pt) return;
          // Click a pin to cross-filter its state (toggle). No auto-zoom — pan/zoom stays where the user left it.
          if (Array.isArray(pt.customdata)) { setStateSel((c) => (c === pt.customdata[1] ? null : pt.customdata[1])); setRegionSel(''); }
        });
      });
      return;
    }
    const m = adjustUnique(yb.metrics[metricIdx] || yb.metrics[0], metricIdx, yb, uniqueData, p);
    const { abbr, names, regs, regOrder, centroid } = p;
    const scale = (p.colors[colorIdx] && p.colors[colorIdx].scale) || [[0, '#eef2ff'], [1, '#082240']];
    // Choropleth/YoY paint the state fill; "none" leaves a neutral map (the POC "Pins" look). Pins overlay
    // independently via showPins, so any combination (fill+pins, neutral+pins, fill only, neutral) is valid.
    const fillOn = fillMode !== 'none';
    const yoyOn = fillMode === 'yoy' && !!yoyData;
    const yoyRegion = yoyOn && view === 'region';   // color states by their region's growth (Region layer)
    // Diverging scale for YoY from the selected palette (reverse swaps the ends); theme-aware mid.
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

    // z + colorbar per color mode.
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
      // YoY change fill: diverging scale centered at 0 (red decline -> green growth). "New" (0 -> n) states
      // shade top-positive; states with no data either year are null (blank).
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
      // Neutral base map (Pins-only): uniform light fill, no colorbar; states still hover for context.
      type: 'choropleth', locationmode: 'USA-states', locations: abbr, z: abbr.map(() => 0),
      customdata: isRegion ? cdRegion : cdState, hovertemplate: '%{customdata}<extra></extra>',
      colorscale: [[0, neutralFill], [1, neutralFill]], showscale: false,
      marker: { line: { color: dark ? '#334155' : '#cbd5e1', width: 0.5 } },
    }];

    // Region borders (merged outline) — honored for choropleth and YoY alike (the "Region borders" toggle
    // plus the Region/Both layers).
    if ((showOutlines || view === 'region' || view === 'both') && regionMesh) {
      traces.push({
        type: 'scattergeo', mode: 'lines', lon: regionMesh.lon, lat: regionMesh.lat,
        line: { width: 2.2, color: dark ? '#e2e8f0' : '#0f172a' }, hoverinfo: 'skip', showlegend: false,
      });
    }
    // State labels.
    if (!yoyOn && showLabels && (view === 'state' || view === 'both')) {
      traces.push({
        type: 'scattergeo', locationmode: 'USA-states', mode: 'text',
        lon: abbr.map((ab) => (centroid[ab] ? centroid[ab][0] : null)),
        lat: abbr.map((ab) => (centroid[ab] ? centroid[ab][1] : null)),
        text: m.labels, textfont: { size: 11, color: fillOn ? labColor(z, zauto ? null : zmin, zauto ? null : zmax, scale, reverse, dark) : (dark ? '#e2e8f0' : '#334155') },
        hoverinfo: 'skip', showlegend: false,
      });
    }
    // YoY state labels (state / both layers) — change text, white on the darker halves of the scale.
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
    // YoY region labels (region / both layers) — region growth text with the same both-view red halo.
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
    // Region labels.
    if (!yoyOn && showLabels && (view === 'region' || view === 'both')) {
      const rlon = regOrder.map((rg) => (regionCentroids[rg] ? regionCentroids[rg][0] : null));
      const rlat = regOrder.map((rg) => (regionCentroids[rg] ? regionCentroids[rg][1] : null));
      // In "both" view, give each region label a halo (offset copies in a contrasting color behind the red
      // text) so it stays legible over the state fill — an outline hugs any name length, unlike a fixed chip.
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
        textfont: { size: view === 'both' ? 16 : 14, color: view === 'both' ? '#C20E2F' : (dark ? '#e2e8f0' : '#0f172a') },
        hoverinfo: 'skip', showlegend: false,
      });
    }
    // Top-N spotlight: gold outline + numbers, ranking the selected metric. Works on the choropleth AND the
    // neutral Pins map (ranks the same metric even with no fill). Not applicable to YoY (uses its own movers).
    if (spotN && (fillOn || showPins) && !yoyOn) {
      const top = order.filter((x) => x[0] !== -Infinity).slice(0, spotN);
      // Gold outline only on the top 10 (even when more are numbered) — keeps the map from getting busy.
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
    // YoY top movers: gold outline + numbered badges ranked by gainers (g), decliners (d), or |movers| (m).
    // State-level ranking, so shown on the State/Both layers (not the Region layer).
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

    // Event pins overlay (Pins map style): two layers, sized by participants against maxParts. Navy =
    // non-IRONMAN, red = IRONMAN. Hover shows event detail; click cross-filters the Events tab (state).
    if (showPins && pinEvents.length) {
      const sr = (2 * (p.maxParts || 1)) / (40 * 40);   // sizeref so the biggest event ~= 40px (area mode)
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

    Plotly.react(mapRef.current, traces, {
      geo: { scope: 'usa', bgcolor: 'rgba(0,0,0,0)', lakecolor: 'rgba(0,0,0,0)', projection: { scale: zoom } },
      margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: 'rgba(0,0,0,0)', height: 560,
    }, { displayModeBar: false, responsive: true }).then((gd) => {
      // Click a state/region on the map to cross-filter the Events tab (and pick a State-flows state).
      if (!gd || !gd.on) return;
      gd.removeAllListeners && gd.removeAllListeners('plotly_click');
      gd.on('plotly_click', (ev) => {
        const pt = ev.points && ev.points[0]; if (!pt) return;
        // Choropleth click (normal/YoY): pt.location is the state/region code. YoY is state-only.
        if (pt.location) {
          if (view === 'region') { const rg = p.ab2region[pt.location] || ''; setRegionSel((c) => (c === rg ? '' : rg)); setStateSel(null); }
          else { setStateSel((c) => (c === pt.location ? null : pt.location)); setRegionSel(''); }
          return;
        }
        // Pin marker (scattergeo): customdata is [tooltip, state] -> toggle cross-filter to that event's state.
        if (Array.isArray(pt.customdata)) { setStateSel((c) => (c === pt.customdata[1] ? null : pt.customdata[1])); setRegionSel(''); }
      });
    });
  }, [st, yb, metricIdx, view, showLabels, showOutlines, spotN, colorIdx, colorMode, logMode, clipMax, reverse, zoom, dark, regionMesh, regionCentroids, fillMode, showPins, pinEvents, yoyData, yoyTop, yoyFrom, yoyTo, yoyColorIdx, showFlows, uniqueData, basemap]);

  // FLOWS map (deck.gl 3D arcs). Base states shade by net flow (red = net destination, blue = net feeder);
  // picking a focus state traces its top inbound (red) + outbound (blue) routes as arcs. Ported from the POC.
  useEffect(() => {
    if (!showFlows || !st.p || !deckRef.current) return;
    let cancelled = false;
    if (!deckInst.current) setFlowLoading(true);   // first build: deck.gl + base map fetch can take a few seconds
    const p = st.p;
    const name2ab = {}; p.abbr.forEach((ab, i) => { name2ab[p.names[i]] = ab; });

    const render = (deck, geo) => {
      if (cancelled || !deckRef.current) return;
      setFlowLoading(false);   // deck.gl + geojson are ready and we're about to draw
      const keys = resolveSlices(selYears, selMonths, p.monthsByYear);
      const A = aggregateFlows(keys, p.odByYM);
      const net = {}; p.abbr.forEach((ab) => { net[ab] = (A.inb[ab] || 0) - (A.outb[ab] || 0); });
      const maxNet = Math.max.apply(null, p.abbr.map((ab) => Math.abs(net[ab])).concat([1]));

      const arcs = []; let maxArc = 1;
      if (flowFocus) {
        let IN = A.flows.filter((r) => r[1] === flowFocus).sort((a, b) => b[2] - a[2]).slice(0, flowTop);
        let OUT = A.flows.filter((r) => r[0] === flowFocus).sort((a, b) => b[2] - a[2]).slice(0, flowTop);
        maxArc = Math.max.apply(null, IN.concat(OUT).map((r) => r[2]).concat([1]));
        const nm = (ab) => p.names[p.abbr.indexOf(ab)] || ab;
        if (flowDir !== 'out') IN.forEach((r) => { if (p.centroid[r[0]] && p.centroid[flowFocus]) arcs.push({ s: p.centroid[r[0]], t: p.centroid[flowFocus], n: r[2], lbl: nm(r[0]) + ' → ' + nm(flowFocus), c: [194, 14, 47] }); });
        if (flowDir !== 'in') OUT.forEach((r) => { if (p.centroid[flowFocus] && p.centroid[r[1]]) arcs.push({ s: p.centroid[flowFocus], t: p.centroid[r[1]], n: r[2], lbl: nm(flowFocus) + ' → ' + nm(r[1]), c: [24, 95, 165] }); });
      }

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
      if (showLabels) layers.push(new deck.TextLayer({
        id: 'lab', data: p.abbr.filter((ab) => p.centroid[ab]), getPosition: (ab) => p.centroid[ab],
        getText: (ab) => { const n = net[ab] || 0; return ab + '\n' + (n > 0 ? '+' : '') + n.toLocaleString(); },
        getSize: 12, fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: 700,
        getColor: (ab) => { const n = net[ab] || 0; return n > 0 ? [19, 78, 10] : (n < 0 ? [122, 20, 20] : [15, 23, 42]); },
        getTextAnchor: 'middle', getAlignmentBaseline: 'center', lineHeight: 1.05, fontSettings: { sdf: true },
        outlineWidth: 3, outlineColor: [255, 255, 255], background: true, getBackgroundColor: [255, 255, 255, 228],
        backgroundPadding: [4, 2, 4, 2], updateTriggers: { getText: [keys.join()], getColor: [keys.join()] },
      }));

      // Top-N partner states (per the "Top routes" dropdown) by flow volume with the focus -> gold outline +
      // numbered rank badges (parity with the choropleth Top-N spotlight). Only when a focus state is picked.
      const badgeRows = [];
      if (flowFocus) {
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
      // One billboarded badge (gold pill + white rank), raised above the state label in SCREEN space via
      // getPixelOffset so it stays readable when the map is tilted (billboard = always faces the camera).
      layers.push(new deck.TextLayer({
        id: 'badge', data: badgeRows, getPosition: (d) => d.pos, getText: (d) => '' + d.rank,
        getSize: 14, fontWeight: 700, getColor: [255, 255, 255], getTextAnchor: 'middle', getAlignmentBaseline: 'center',
        billboard: true, getPixelOffset: [22, -24],
        background: true, getBackgroundColor: [212, 146, 10, 255], backgroundPadding: [6, 3, 6, 3],
        fontSettings: { sdf: true }, outlineWidth: 2, outlineColor: [255, 255, 255],
        parameters: { depthTest: false }, characterSet: '0123456789',
      }));

      const tooltip = (o) => {
        if (!o || !o.object) return null; const ob = o.object;
        if (ob.n) return { html: '<div style="font:12px Arial;background:#0f172a;color:#fff;padding:6px 8px;border-radius:6px">' + ob.lbl + '<br>' + ob.n.toLocaleString() + ' athletes</div>' };
        if (ob.properties) { const ab = name2ab[ob.properties.name]; if (!ab) return null; return { html: '<div style="font:12px Arial;background:#0f172a;color:#fff;padding:6px 8px;border-radius:6px"><b>' + ob.properties.name + '</b><br>In ' + (A.inb[ab] || 0).toLocaleString() + ' · Out ' + (A.outb[ab] || 0).toLocaleString() + ' · Net ' + (net[ab] || 0).toLocaleString() + '<br><span style="opacity:.7">click to focus</span></div>' }; }
        return null;
      };
      // Click a state on the flow map to make it the focus (arcs recenter on it).
      const onClick = (info) => {
        const ob = info && info.object;
        if (ob && ob.properties) { const ab = name2ab[ob.properties.name]; if (ab) setFlowFocus(ab); }
      };
      if (!deckInst.current) {
        deckInst.current = new deck.DeckGL({
          container: deckRef.current, viewState: flowViewRef.current, controller: true,
          glOptions: { preserveDrawingBuffer: true }, layers, getTooltip: tooltip, onClick,
          onViewStateChange: (e) => { flowViewRef.current = e.viewState; deckInst.current.setProps({ viewState: e.viewState }); },
        });
      } else {
        deckInst.current.setProps({ layers, viewState: flowViewRef.current, getTooltip: tooltip, onClick });
      }
      setFlowStat(flowFocus
        ? (p.names[p.abbr.indexOf(flowFocus)] || flowFocus) + ': ' + (A.inb[flowFocus] || 0).toLocaleString() + ' travel in, ' + (A.outb[flowFocus] || 0).toLocaleString() + ' race elsewhere. Drag to tilt, scroll to zoom.'
        : 'States shaded by net flow (red = destination, blue = feeder). Pick a focus state to trace routes. Drag to tilt, scroll to zoom.');
    };

    loadDeck().then((deck) => {
      if (!deck) { setFlowLoading(false); setFlowStat('deck.gl failed to load (needs internet).'); return; }
      if (flowGeoRef.current) return render(deck, flowGeoRef.current);
      fetch(FLOW_GEO_URL).then((r) => r.json()).then((g) => { flowGeoRef.current = g; render(deck, g); })
        .catch(() => { setFlowLoading(false); setFlowStat('Could not load the base map (needs internet).'); });
    }).catch(() => { setFlowLoading(false); setFlowStat('deck.gl failed to load (needs internet).'); });

    return () => { cancelled = true; };
  }, [showFlows, st.p, flowFocus, flowDir, flowTop, selYears, selMonths, showLabels, showOutlines, regionMesh, dark]);

  // Dispose the deck instance when leaving Flows so the Plotly map shows cleanly. Also empty the container:
  // finalize() stops the render loop but leaves its <canvas> in the DOM, and with preserveDrawingBuffer that
  // canvas keeps the old arcs painted. Re-entering Flows builds a NEW DeckGL (new canvas) on top of it, so the
  // previous state's arcs stay visible and new picks pile on. Clearing innerHTML drops the stale canvas.
  useEffect(() => {
    if (showFlows) return;
    if (deckInst.current) { try { deckInst.current.finalize(); } catch (e) { /* noop */ } deckInst.current = null; }
    if (deckRef.current) deckRef.current.innerHTML = '';
  }, [showFlows]);

  // Auto-rotate (bearing spin) while Flows + spin are on.
  useEffect(() => {
    if (!showFlows || !flowSpin) return;
    const tick = () => {
      const v = flowViewRef.current; flowViewRef.current = { ...v, bearing: ((v.bearing || 0) + 0.4) % 360 };
      if (deckInst.current) deckInst.current.setProps({ viewState: flowViewRef.current });
      spinRaf.current = requestAnimationFrame(tick);
    };
    spinRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(spinRaf.current);
  }, [showFlows, flowSpin]);

  const kpis = useMemo(() => (yb ? kpisFromYB(yb) : null), [yb]);

  const pickView = (v) => { setView(v); setShowOutlines(v !== 'state'); };
  const exportPng = () => {
    if (!yb || !mapRef.current) return;
    const m = yb.metrics[metricIdx];
    const lbl = labelText(selYears, selMonths);
    const fname = 'participation_' + (m.label || 'map').replace(/[^a-z0-9]+/gi, '_') + '_' + suf(selYears, selMonths);
    const bg = dark ? '#0b1220' : '#ffffff';
    const ink = dark ? '#e2e8f0' : '#0f172a';
    Plotly.relayout(mapRef.current, {
      'title.text': m.label + ' — ' + lbl, 'title.font.size': 18, 'title.font.color': ink,
      'title.x': 0.02, 'title.xanchor': 'left', 'margin.t': 52,
      paper_bgcolor: bg, 'geo.bgcolor': bg,
    })
      .then(() => Plotly.downloadImage(mapRef.current, { format: 'png', filename: fname, width: 1300, height: 800 }))
      .then(() => Plotly.relayout(mapRef.current, { 'title.text': '', 'margin.t': 0, paper_bgcolor: 'rgba(0,0,0,0)', 'geo.bgcolor': 'rgba(0,0,0,0)' }));
  };
  const toggleFs = () => { if (!document.fullscreenElement) cardRef.current && cardRef.current.requestFullscreen && cardRef.current.requestFullscreen(); else document.exitFullscreen && document.exitFullscreen(); };

  if (st.loading) return <div className="loading">Loading participation data…</div>;
  if (st.error) {
    return (
      <div className="card">
        <h2>Participation maps</h2>
        <p className="err">Couldn’t load data: {st.error}</p>
        {st.code === 'NO_DATA'
          ? <p className="muted">Seed the fixture or wire MySQL: <code>node src/reporting/store/make_fixture.js &lt;standalone-html&gt;</code></p>
          : null}
      </div>
    );
  }

  if (!yb) return <div className="loading">Loading…</div>;
  const p = st.p;
  const years = Object.keys(p.byYear).sort();
  const metrics = yb.metrics;
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
  const toggleYear = (y, on) => {
    let v = (selYears || []).filter((x) => x !== y);
    if (on) v = [...v, y];
    setSelYears(v.length ? v.slice().sort() : [years[years.length - 1]]);
  };
  const toggleMonth = (mo, on) => {
    let v = selMonths.filter((x) => x !== 'all');
    if (on) v = [...v, String(mo)]; else v = v.filter((x) => x !== String(mo));
    setSelMonths(v.length ? v : ['all']);
  };
  const seg = (active) => ({
    padding: '4px 12px', border: '1px solid var(--border, #cbd5e1)', borderRadius: 6, cursor: 'pointer',
    background: active ? '#082240' : 'transparent', color: active ? '#fff' : 'inherit', fontSize: 13,
  });
  const mini = (active) => ({ ...seg(active), padding: '3px 9px', fontSize: 12 });

  // General reset (the ⟲ button): return EVERYTHING to defaults — map type, layer, zoom/size, filters,
  // colors and cross-filters. Use the map-type buttons to change views without resetting.
  const resetAll = () => {
    setSelYears([years[years.length - 1]]); setSelMonths(['all']);
    setMetricIdx(0); setView('state'); setShowLabels(true); setShowOutlines(false);
    setSpotN(10); setColorMode('value'); setLogMode(false); setClipMax(''); setReverse(false);
    setZoom(1); setFillMode('choro'); setShowPins(false); setShowFlows(false);
    setPinIm(''); setStateSel(null); setRegionSel('');
    setFlowFocus((p.abbr && p.abbr.indexOf('CA') >= 0) ? 'CA' : ((p.abbr && p.abbr[0]) || '')); setFlowDir('both'); setFlowTop(5); setFlowSpin(false);
    flowViewRef.current = { ...FLOW_VIEW0 };
    setYoyMode('pct'); setYoyTop('g10'); setYoyColorIdx(0);
    setYoyTo(years[years.length - 1]); setYoyFrom(years[years.length - 2] || years[years.length - 1]);
    const ci = (p.colors || []).findIndex((c) => /blues/i.test(c.name || ''));
    setColorIdx(ci >= 0 ? ci : 0);
  };

  // Export the current map data (every state, all metrics for the selected year/month) to CSV.
  // Context-aware CSV: export the data behind whatever map style is active, so the file matches the screen.
  const exportCsv = () => {
    const per = suf(selYears, selMonths);
    // Flows map → the focused state's inbound + outbound routes (what the arcs show).
    if (showFlows && flowRoutes) {
      const header = ['Direction', 'Focus state', 'Partner state', 'Participants'];
      const rows = flowRoutes.inb.map((r) => ['Inbound (raced in ' + flowRoutes.focusName + ')', flowRoutes.focusName, r[0], r[1]])
        .concat(flowRoutes.outb.map((r) => ['Outbound (left ' + flowRoutes.focusName + ')', flowRoutes.focusName, r[0], r[1]]));
      downloadCSV('participation_flows_' + flowFocus + '_' + per + '.csv', header, rows);
      return;
    }
    // YoY map → from / to / change per state and per region (matches the growth fill + top movers).
    if (fillMode === 'yoy' && yoyData) {
      const unit = yoyData.abs ? 'abs' : '%';
      const header = ['Level', 'Code', 'Name', 'From (' + yoyFrom + ')', 'To (' + yoyTo + ')', 'Change (' + unit + ')'];
      const rows = p.abbr.map((ab, i) => { const c = yoyData.cd[i] || []; return ['State', ab, c[0] || p.names[i], c[1] || '', c[2] || '', c[3] || '']; });
      p.regOrder.forEach((rg, j) => { const c = yoyData.regCd[j] || []; rows.push(['Region', rg, rg, c[1] || '', c[2] || '', c[3] || '']); });
      downloadCSV('participation_yoy_' + yoyFrom + '_to_' + yoyTo + '_' + (metrics[metricIdx] ? metrics[metricIdx].label.replace(/[^a-z0-9]+/gi, '') : '') + '_' + per + '.csv', header, rows);
      return;
    }
    // Pins-only (neutral) map → the event pins on screen (event roll-ups with coords), same filters as the pins.
    if (fillMode === 'none' && showPins && pinEvents && pinEvents.length) {
      const header = ['State', 'Region', 'Event', 'Date', 'IRONMAN', 'Participants', 'Home', 'Away', 'Unknown home', 'Lat', 'Lng'];
      const rows = pinEvents.map((r) => [r[0], r[1], r[2], r[4], r[5], r[6], r[20], r[21], r[22], r[32], r[33]]);
      downloadCSV('participation_event_pins_' + per + '.csv', header, rows);
      return;
    }
    // Choropleth → only the metric currently shown, at the grain(s) on screen (states for State/Both,
    // regions for Region/Both). The full all-metrics matrix lives on the State-matrix / Region-matrix tabs.
    const m = adjustUnique(metrics[metricIdx] || metrics[0], metricIdx, yb, uniqueData, p);
    const header = ['Level', 'Code', 'Name', 'Region', m.label];
    const rows = [];
    if (view !== 'region') p.abbr.forEach((ab, i) => rows.push(['State', ab, p.names[i], p.regs[i], m.statez[i] == null ? '' : m.statez[i]]));
    if (view !== 'state') p.regOrder.forEach((rg) => { const i = p.regs.indexOf(rg); rows.push(['Region', rg, rg, rg, (i < 0 || m.regionz[i] == null) ? '' : m.regionz[i]]); });
    downloadCSV('participation_' + (m.label || 'metric').replace(/[^a-z0-9]+/gi, '') + '_' + per + '.csv', header, rows);
  };

  return (
    <div className="page">
      {st.source === 'fixture' ? (
        <div role="alert" style={{ background: dark ? '#4a1d1d' : '#fef2f2', border: '1px solid ' + (dark ? '#7f1d1d' : '#fecaca'), color: dark ? '#fecaca' : '#991b1b', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 14, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠</span>
          <span><b>Showing fallback sample data (not live).</b> The database was unreachable or the last build failed, so these figures come from a baked fixture and may be stale. Restart the server / re-run the pipeline to load live data.</span>
        </div>
      ) : null}
      <div className="page-head">
        <h2>Participation maps</h2>
        <span className="muted small">{p.abbr.length} states · {metrics.length} metrics · {labelText(selYears, selMonths)}</span>
      </div>

      {kpis ? (
        <div className="kpis">
          <Kpi v={fmt(kpis.participants)} l={`Participants (${labelText(selYears, selMonths)})`} t="Count of participation records (event starts) for the selected period. One athlete racing 3× counts as 3." />
          <Kpi v={uniqLoading ? '…' : (fmt(uniqueData ? uniqueData.national : kpis.unique) + ((!uniqueData && kpis.approx) ? ' ~' : ''))} l="Unique athletes" t="Distinct athletes for the exact selection, counted live from the base data (COUNT DISTINCT id_profiles = active members). Exact — not the sum of per-slice counts. ‘…’ = loading; ‘~’ = fell back to the approximate summed count if the live count was unavailable." />
          <Kpi v={(kpis.home + kpis.away) ? Math.round(100 * kpis.home / (kpis.home + kpis.away)) + '%' : '—'} l="Known home (in-state)" t="Share of KNOWN-home participations that raced in the athlete's home state — home ÷ (home + away), excluding the ~10% whose home state is unknown/unmapped. This is the known-home basis (the deck definition); the of-total home % (÷ all participants) runs lower." />
          <Kpi v={fmt(kpis.away)} l="Traveled away" t="Participations where the athlete’s home state differs from the event state (cross-state travel)." />
        </div>
      ) : null}

      <div className="toolbar" style={{ gap: 6 }}>
        <label title={metricDesc(metrics[metricIdx] && metrics[metricIdx].label)}>Metric&nbsp;
          <select value={metricIdx} onChange={(e) => { setMetricIdx(Number(e.target.value)); trackFilter('participation-maps', 'map', 'metric'); }}>
            {METRIC_GROUPS.map((g) => {
              const opts = g.idxs.filter((i) => metrics[i]);
              if (!opts.length) return null;
              return <optgroup key={g.label} label={g.label}>
                {opts.map((i) => <option key={i} value={i} title={metricDesc(metrics[i].label)}>{metrics[i].label}</option>)}
              </optgroup>;
            })}
          </select>
        </label>
        <Link to="/reference" title="Metric definitions & data notes" className="muted small" style={{ textDecoration: 'none' }}>ⓘ Reference</Link>
        <span ref={yearRef} style={{ position: 'relative', display: 'inline-block' }}>Years&nbsp;
          <button style={seg(false)} onClick={() => setYearOpen((o) => !o)}>
            {(selYears || []).length === years.length ? 'All years'
              : ((selYears || []).length <= 2 ? (selYears || []).slice().sort().join(', ') : (selYears || []).length + ' years')} ▾
          </button>
          {yearOpen ? (
            <div style={{ position: 'absolute', zIndex: 60, top: '110%', left: 0, background: 'var(--panel)', color: 'inherit', border: '1px solid #cbd5e1', borderRadius: 6, padding: 6, maxHeight: 260, overflow: 'auto', minWidth: 130, boxShadow: '0 8px 20px rgba(0,0,0,.2)' }}>
              <label style={{ display: 'flex', gap: 6, padding: '3px 6px' }}>
                <input type="checkbox" checked={(selYears || []).length === years.length} onChange={(e) => setSelYears(e.target.checked ? years.slice() : [years[years.length - 1]])} /> Select all
              </label>
              {years.map((y) => (
                <label key={y} style={{ display: 'flex', gap: 6, padding: '3px 6px' }}>
                  <input type="checkbox" checked={(selYears || []).indexOf(y) >= 0} onChange={(e) => toggleYear(y, e.target.checked)} /> {y}
                </label>
              ))}
            </div>
          ) : null}
        </span>
        <span ref={monthRef} style={{ position: 'relative', display: 'inline-block' }}>
          <button style={seg(false)} onClick={() => setMonthOpen((o) => !o)}>
            {selMonths.indexOf('all') >= 0 ? 'All months' : selMonths.length + ' month' + (selMonths.length > 1 ? 's' : '')} ▾
          </button>
          {monthOpen ? (
            <div style={{ position: 'absolute', zIndex: 60, top: '110%', left: 0, background: 'var(--panel)', color: 'inherit', border: '1px solid var(--line, #cbd5e1)', borderRadius: 6, padding: 6, maxHeight: 260, overflow: 'auto', minWidth: 150, boxShadow: '0 8px 20px rgba(0,0,0,.2)' }}>
              <label style={{ display: 'flex', gap: 6, padding: '3px 6px' }}>
                <input type="checkbox" checked={selMonths.indexOf('all') >= 0} onChange={() => setSelMonths(['all'])} /> All months
              </label>
              {availMonths.map((mo) => (
                <label key={mo} style={{ display: 'flex', gap: 6, padding: '3px 6px' }}>
                  <input type="checkbox" checked={selMonths.indexOf(String(mo)) >= 0} onChange={(e) => toggleMonth(mo, e.target.checked)} /> {MON_FULL[mo]}
                </label>
              ))}
            </div>
          ) : null}
        </span>
        <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
        <button style={seg(fillMode === 'choro' && !showFlows)} title="Metric choropleth fill (on/off)"
          onClick={() => { track('map_style', { panel: 'participation-maps', view: 'choropleth' }); if (showFlows) { setShowFlows(false); setFillMode('choro'); } else setFillMode((f) => (f === 'choro' ? 'none' : 'choro')); }}>Choropleth</button>
        <button style={seg(showPins && !showFlows)} title="Event pins map (turns the choropleth fill off; re-select Choropleth to bring it back)"
          onClick={() => { if (showFlows) { setShowFlows(false); setShowPins(true); setFillMode('none'); } else { const on = !showPins; setShowPins(on); if (on) setFillMode('none'); } }}>Pins</button>
        <button style={seg(fillMode === 'yoy' && !showFlows)} title="Year-over-year change fill (on/off)"
          onClick={() => { track('map_style', { panel: 'participation-maps', view: 'yoy' }); if (showFlows) { setShowFlows(false); setFillMode('yoy'); } else setFillMode((f) => (f === 'yoy' ? 'none' : 'yoy')); }}>YoY</button>
        <button style={seg(showFlows)} title="Athlete travel arcs (3D) — replaces the map"
          onClick={() => { track('map_style', { panel: 'participation-maps', view: 'flows' }); setShowFlows((s) => !s); }}>Flows</button>
        <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {['state', 'region', 'both'].map((v) => (
            <button key={v} style={{ ...seg(view === v && !showFlows), ...(showFlows ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }} disabled={showFlows} onClick={() => pickView(v)}>
              {v === 'state' ? 'State' : v === 'region' ? 'Region' : 'Both'}
            </button>
          ))}
        </span>
      </div>

      {showPins ? (
        <div className="toolbar" style={{ alignItems: 'center' }}>
          <span className="small muted">IRONMAN</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button style={mini(pinIm === '')} onClick={() => setPinIm('')}>All</button>
            <button style={mini(pinIm === 'Yes')} onClick={() => setPinIm('Yes')}>IRONMAN</button>
            <button style={mini(pinIm === 'No')} onClick={() => setPinIm('No')}>Non-IRONMAN</button>
          </span>
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
          <span className="small muted">Basemap</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button style={mini(!basemap)} onClick={() => setBasemap(false)} title="Clean vector map (no tiles)">Off</button>
            <button style={mini(basemap)} onClick={() => setBasemap(true)} title="Event pins over a real carto basemap (streets/terrain) — free, no token, theme-aware">On</button>
            {basemap ? <button style={mini(false)} title="Recenter & zoom the basemap back to the whole US" onClick={() => { basemapViewRef.current = { center: { ...BASEMAP_VIEW0.center }, zoom: BASEMAP_VIEW0.zoom }; if (mapRef.current) Plotly.relayout(mapRef.current, { 'mapbox.center': BASEMAP_VIEW0.center, 'mapbox.zoom': BASEMAP_VIEW0.zoom }); }}>⟲ Reset view</button> : null}
          </span>
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
          <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: PIN_NON, display: 'inline-block' }} /> Non-IRONMAN
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: PIN_IM, display: 'inline-block' }} /> IRONMAN
            </span>
            <span className="muted">· circle size = participants · {pinEvents.length.toLocaleString()} events</span>
          </span>
        </div>
      ) : null}

      {fillMode === 'yoy' ? (
        <div className="toolbar" style={{ alignItems: 'center' }}>
          <span className="small muted">Compare</span>
          <select value={yoyFrom} onChange={(e) => setYoyFrom(e.target.value)} title="Baseline year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="small muted">→</span>
          <select value={yoyTo} onChange={(e) => setYoyTo(e.target.value)} title="Comparison year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button style={mini(yoyMode === 'pct')} onClick={() => setYoyMode('pct')}>% change</button>
            <button style={mini(yoyMode === 'abs')} onClick={() => setYoyMode('abs')}>Absolute</button>
          </span>
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
          <label className="small">Top movers&nbsp;
            <select value={yoyTop} onChange={(e) => setYoyTop(e.target.value)}>
              <option value="g5">Top 5 gainers</option>
              <option value="g10">Top 10 gainers</option>
              <option value="d5">Top 5 decliners</option>
              <option value="d10">Top 10 decliners</option>
              <option value="m10">Top 10 movers</option>
              <option value="off">Off</option>
            </select>
          </label>
          {(metricIdx in UNIQ_IDX) ? <span className="small muted" title="Unique athletes for each year are counted live from the base data (exact distinct), then compared.">{yoyUniq ? '· exact unique' : '· counting unique…'}</span> : null}
        </div>
      ) : null}

      {fillMode === 'yoy' && yoyData && yoyData.mos && yoyData.mos.length ? (
        <div className="small muted" style={{ margin: '-4px 0 8px', paddingLeft: 2 }}>
          Year-over-year compares the <b>same period in both years</b> — {(() => { const ms = yoyData.mos.slice().sort((a, b) => a - b); return ms.length >= 12 ? 'full year (Jan–Dec)' : (MON3[ms[0]] + (ms.length > 1 ? '–' + MON3[ms[ms.length - 1]] : '')); })()} of {yoyFrom} vs {yoyTo}. Months present in only one year are excluded, so a partial year (e.g. the current one) is a like-for-like year-to-date comparison.
        </div>
      ) : null}

      {showFlows ? (
        <div className="toolbar" style={{ alignItems: 'center' }}>
          <label className="small">Focus state&nbsp;
            <select value={flowFocus} onChange={(e) => setFlowFocus(e.target.value)}>
              <option value="">— net flow (no focus) —</option>
              {p.abbr.slice().sort((a, b) => (p.names[p.abbr.indexOf(a)] < p.names[p.abbr.indexOf(b)] ? -1 : 1)).map((ab) => <option key={ab} value={ab}>{p.names[p.abbr.indexOf(ab)]}</option>)}
            </select>
          </label>
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
          <span className="small muted">Direction</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button style={mini(flowDir === 'both')} onClick={() => setFlowDir('both')}>Both</button>
            <button style={mini(flowDir === 'in')} onClick={() => setFlowDir('in')}>Inbound</button>
            <button style={mini(flowDir === 'out')} onClick={() => setFlowDir('out')}>Outbound</button>
          </span>
          <label className="small">Top routes&nbsp;
            <select value={flowTop} onChange={(e) => setFlowTop(Number(e.target.value))}>
              {[5, 10, 20, 30, 50].map((n) => <option key={n} value={n}>Top {n}</option>)}
            </select>
          </label>
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
          <button style={mini(flowSpin)} title="Auto-rotate the 3D view" onClick={() => setFlowSpin((s) => !s)}>⟳ Rotate</button>
          <button style={mini(false)} title="Reset the 3D camera" onClick={() => { flowViewRef.current = { ...FLOW_VIEW0 }; if (deckInst.current) deckInst.current.setProps({ viewState: flowViewRef.current }); }}>Reset view</button>
        </div>
      ) : null}

      <div className="toolbar">
        <button style={seg(advOpen)} onClick={() => setAdvOpen((o) => !o)}>⚙ Display options {advOpen ? '▾' : '▸'}</button>
        {refreshNote ? <span className="small" style={{ alignSelf: 'center', marginLeft: 'auto', marginRight: 6, opacity: 0.9 }}>{refreshNote}</span> : null}
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: refreshNote ? 0 : 'auto' }}>
          <button style={mini(false)} title="Pull the latest data live from the database now (bypasses the hourly cache)" disabled={refreshing} onClick={doRefresh}>{refreshing ? '⟳ …' : '⟳ Refresh data'}</button>
          <button style={mini(false)} title="Zoom out" onClick={() => { if (showFlows) { flowViewRef.current = { ...flowViewRef.current, zoom: Math.max(1.5, flowViewRef.current.zoom - 0.5) }; if (deckInst.current) deckInst.current.setProps({ viewState: flowViewRef.current }); } else if (basemap && showPins) { basemapViewRef.current = { ...basemapViewRef.current, zoom: Math.max(1.5, basemapViewRef.current.zoom - 0.6) }; if (mapRef.current) Plotly.relayout(mapRef.current, { 'mapbox.zoom': basemapViewRef.current.zoom }); } else setZoom((z) => Math.max(1, z / 1.4)); }}>−</button>
          <button style={mini(false)} title="Zoom in" onClick={() => { if (showFlows) { flowViewRef.current = { ...flowViewRef.current, zoom: Math.min(9, flowViewRef.current.zoom + 0.5) }; if (deckInst.current) deckInst.current.setProps({ viewState: flowViewRef.current }); } else if (basemap && showPins) { basemapViewRef.current = { ...basemapViewRef.current, zoom: Math.min(16, basemapViewRef.current.zoom + 0.6) }; if (mapRef.current) Plotly.relayout(mapRef.current, { 'mapbox.zoom': basemapViewRef.current.zoom }); } else setZoom((z) => Math.min(10, z * 1.4)); }}>+</button>
          <button style={mini(false)} title="Reset everything to defaults (map type, zoom, filters)" onClick={resetAll}>⟲</button>
          <button style={mini(false)} title={showFlows ? 'Download the focused state’s inbound/outbound flow routes (CSV)' : fillMode === 'yoy' ? 'Download YoY from/to/change by state & region (CSV)' : (fillMode === 'none' && showPins) ? 'Download the event pins on screen (CSV)' : 'Download the metric shown, by ' + (view === 'region' ? 'region' : view === 'both' ? 'state & region' : 'state') + ' (CSV)'} onClick={exportCsv}>CSV</button>
          <button style={mini(false)} title="Download PNG" onClick={exportPng}>PNG</button>
          <button style={mini(false)} title="Fullscreen" onClick={toggleFs}>⛶</button>
        </span>
      </div>

      {advOpen ? (
        <div className="toolbar">
          {(() => { const dz = fillMode !== 'choro' || showFlows; const dst = dz ? { opacity: 0.4, cursor: 'not-allowed' } : {}; const dt = showFlows ? 'Not used on the Flows map' : (fillMode === 'yoy' ? 'Not used on the YoY map (fixed diverging scale)' : (fillMode === 'none' ? 'Not used without a choropleth fill (colors shade the metric)' : '')); return (
          <>
          <span style={{ display: 'inline-flex', gap: 4 }} title={dt}>
            <button style={{ ...mini(colorMode === 'value'), ...dst }} disabled={dz} onClick={() => setColorMode('value')}>Value</button>
            <button style={{ ...mini(colorMode === 'rank'), ...dst }} disabled={dz} onClick={() => setColorMode('rank')}>Rank</button>
          </span>
          <span style={{ display: 'inline-flex', gap: 4 }} title={dt}>
            <button style={{ ...mini(!logMode), ...dst }} disabled={dz} onClick={() => setLogMode(false)}>Linear</button>
            <button style={{ ...mini(logMode), ...dst }} disabled={dz} onClick={() => setLogMode(true)}>Log</button>
          </span>
          </>
          ); })()}
          <label style={(fillMode === 'none' || showFlows) ? { opacity: 0.4 } : undefined} title={showFlows ? 'Flow colors are fixed (red = destination, blue = feeder)' : (fillMode === 'none' ? 'No choropleth fill to shade on the Pins map' : '')}>Colors&nbsp;
            {fillMode === 'yoy' ? (
              <select value={yoyColorIdx} disabled={showFlows} onChange={(e) => setYoyColorIdx(Number(e.target.value))} title="Diverging palette for the growth map">
                {YOY_SCALES.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
              </select>
            ) : (
              <select value={colorIdx} disabled={fillMode === 'none' || showFlows} onChange={(e) => setColorIdx(Number(e.target.value))}>
                {(p.colors || []).map((c, i) => <option key={i} value={i}>{c.name}</option>)}
              </select>
            )}
          </label>
          <label style={(fillMode === 'yoy' || showFlows || (basemap && showPins)) ? { opacity: 0.4 } : undefined} title={showFlows ? 'Use the Flows “Top routes” control' : (fillMode === 'yoy' ? 'Use the YoY “Top movers” control instead' : ((basemap && showPins) ? 'Gold top-N badges aren’t drawn on the tile basemap' : ''))}>Top&nbsp;
            <select value={spotN} disabled={fillMode === 'yoy' || showFlows || (basemap && showPins)} onChange={(e) => setSpotN(Number(e.target.value))}>
              <option value={0}>Off</option>
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={25}>Top 25</option>
              <option value={50}>All</option>
            </select>
          </label>
          <label style={(fillMode !== 'choro' || showFlows) ? { opacity: 0.4 } : undefined} title={(fillMode !== 'choro' || showFlows) ? 'Not used on this map' : ''}>Max&nbsp;
            <input type="number" value={clipMax} placeholder="auto" disabled={fillMode !== 'choro' || showFlows} style={{ width: 80 }} onChange={(e) => setClipMax(e.target.value)} />
          </label>
          <button style={{ ...mini(false), ...((fillMode !== 'choro' || showFlows) ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }} disabled={fillMode !== 'choro' || showFlows} onClick={() => setClipMax('')}>Auto</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...((basemap && showPins) ? { opacity: 0.4 } : {}) }} title={(basemap && showPins) ? 'State labels aren’t shown on the tile basemap' : ''}>
            <input type="checkbox" checked={showLabels} disabled={basemap && showPins} onChange={(e) => setShowLabels(e.target.checked)} /> Labels
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...((basemap && showPins) ? { opacity: 0.4 } : {}) }} title={(basemap && showPins) ? 'Region borders aren’t drawn on the tile basemap' : ''}>
            <input type="checkbox" checked={showOutlines} disabled={basemap && showPins} onChange={(e) => setShowOutlines(e.target.checked)} /> Region borders
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...((fillMode === 'none' || showFlows) ? { opacity: 0.4 } : {}) }} title={showFlows ? 'Flow colors are fixed' : (fillMode === 'none' ? 'No fill scale to reverse on the Pins map' : 'Reverse the color scale (high values shade light instead of dark)')}>
            <input type="checkbox" checked={reverse} disabled={fillMode === 'none' || showFlows} onChange={(e) => setReverse(e.target.checked)} /> Reverse shades
          </label>
        </div>
      ) : null}

      <div className="card" ref={cardRef} style={{ position: 'relative' }}>
        <div ref={mapRef} className="mapdiv" style={{ visibility: showFlows ? 'hidden' : 'visible' }} />
        <div ref={deckRef} style={{ position: 'absolute', inset: 0, height: 560, visibility: showFlows ? 'visible' : 'hidden', borderRadius: 10, overflow: 'hidden' }} />
        {((!showFlows && (metricIdx in UNIQ_IDX) && (fillMode === 'yoy' ? yoyUniqLoading : uniqLoading)) || (showFlows && flowLoading)) ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(11,18,32,.45)' : 'rgba(255,255,255,.55)', borderRadius: 10, zIndex: 5, pointerEvents: 'none' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 6px 18px rgba(0,0,0,.22)' }}>
              {showFlows ? 'Loading flow map…' : 'Counting unique athletes…'}
            </span>
          </div>
        ) : null}
      </div>
      {showFlows ? <p className="muted small" style={{ margin: '8px 2px 0' }}>{flowStat}</p> : null}
      {showFlows && flowRoutes ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          {flowDir !== 'out' ? (
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <div className="small" style={{ fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span><span style={{ color: '#C20E2F' }}>●</span> Top inbound — who races in {flowRoutes.focusName}</span>
                <button style={mini(false)} title="Download inbound routes (CSV)" onClick={() => downloadCSV('flows_inbound_' + (flowFocus || 'state') + '.csv', ['Rank', 'State', 'Athletes'], flowRoutes.inb.map(([n, c], i) => [i + 1, n, c]))}>CSV</button>
              </div>
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                {flowRoutes.inb.length ? flowRoutes.inb.map(([n, c], i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 10px', fontSize: 12, borderBottom: '1px solid var(--line)' }}><span>{i + 1}. {n}</span><b>{c.toLocaleString()}</b></div>
                )) : <div className="muted small" style={{ padding: '6px 10px' }}>None</div>}
              </div>
            </div>
          ) : null}
          {flowDir !== 'in' ? (
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <div className="small" style={{ fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span><span style={{ color: '#185FA5' }}>●</span> Top outbound — where {flowRoutes.focusName} races</span>
                <button style={mini(false)} title="Download outbound routes (CSV)" onClick={() => downloadCSV('flows_outbound_' + (flowFocus || 'state') + '.csv', ['Rank', 'State', 'Athletes'], flowRoutes.outb.map(([n, c], i) => [i + 1, n, c]))}>CSV</button>
              </div>
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                {flowRoutes.outb.length ? flowRoutes.outb.map(([n, c], i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 10px', fontSize: 12, borderBottom: '1px solid var(--line)' }}><span>{i + 1}. {n}</span><b>{c.toLocaleString()}</b></div>
                )) : <div className="muted small" style={{ padding: '6px 10px' }}>None</div>}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showPins ? (
        <p className="muted small" style={{ margin: '8px 2px 0' }}>
          Pins: each dot is one event at its ZIP-code location. ZIPs with no mapped area (PO-box, campus, or
          government ZIPs) fall back to the ZIP-prefix area centroid, so a few pins are approximate. Events
          without a resolved U.S. location are excluded; {pinEvents.length.toLocaleString()} events are shown.
        </p>
      ) : null}

      {tabsReady ? (
        <ParticipationTabs
          p={p} yb={yb} selYears={selYears} selMonths={selMonths} period={labelText(selYears, selMonths)} dark={dark}
          stateSel={stateSel} setStateSel={setStateSel}
          regionSel={regionSel} setRegionSel={setRegionSel}
          uniqueData={uniqueData}
        />
      ) : <div className="muted small" style={{ padding: 16, marginTop: 16 }}>Loading tables…</div>}
    </div>
  );
}

function Kpi({ v, l, t }) {
  return <div className="kpi" title={t || undefined} style={t ? { cursor: 'help' } : undefined}><div className="v">{v}</div><div className="l">{l}{t ? ' ⓘ' : ''}</div></div>;
}

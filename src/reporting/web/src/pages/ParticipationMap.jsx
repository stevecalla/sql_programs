import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getYearBlock, kpisFromYB } from '../lib/compute.js';
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
  'Away (count)': 'Cross-state participations (home state ≠ event state).',
  'Home %': 'In-state share of participations (of home + away).',
  'Away %': '100 − Home %.',
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
  const esc = (v) => { v = (v == null) ? '' : ('' + v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = header.map(esc).join(',') + '\n' + rows.map((r) => r.map(esc).join(',')).join('\n');
  const b = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = fname; a.click();
}
const PIN_NON = '#082240', PIN_IM = '#C20E2F';
function fmtEvDate(v) {
  if (!v) return '';
  const s = String(v); const m = +s.substr(5, 2), d = +s.substr(8, 2), y = s.substr(0, 4);
  return (MON3[m] || '') + ' ' + d + ', ' + y;
}

function fmtVal(v, ispct, dec) {
  if (v == null) return 'n/a';
  if (dec) return Number(v).toFixed(1);
  return ispct ? v + '%' : Number(v).toLocaleString();
}
function fmtShort(v) { if (v >= 1e6) return (v / 1e6) + 'M'; if (v >= 1e3) return (v / 1e3) + 'k'; return '' + v; }
function labColor(vals, mn, mx) {
  return vals.map((v) => {
    if (v == null) return '#0f172a';
    const t = mx > mn ? (v - mn) / (mx - mn) : 0;
    return t > 0.66 ? '#ffffff' : '#0f172a';
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
  const [colorMode, setColorMode] = useState('value'); // value | rank
  const [logMode, setLogMode] = useState(false);
  const [clipMax, setClipMax] = useState('');
  const [reverse, setReverse] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fillMode, setFillMode] = useState('choro'); // 'none' (neutral) | 'choro' (metric fill) | 'yoy' (growth fill)
  const [showPins, setShowPins] = useState(false);   // independent event-pins overlay (on/off)
  const [pinIm, setPinIm] = useState('');            // '' all | 'Yes' IRONMAN only | 'No' non-IRONMAN only
  const [stateSel, setStateSel] = useState(null);
  const [regionSel, setRegionSel] = useState('');
  const [regionMesh, setRegionMesh] = useState(null);
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');
  const mapRef = useRef(null);
  const cardRef = useRef(null);
  const monthRef = useRef(null);
  const yearRef = useRef(null);

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
  const availMonths = useMemo(() => {
    if (!st.p || !selYears) return [];
    const set = new Set();
    selYears.forEach((y) => (st.p.monthsByYear[y] || []).forEach((m) => set.add(m)));
    return Array.from(set).sort((a, b) => a - b);
  }, [st.p, selYears]);

  // Pins layer: event roll-ups across the selected years, honoring the same filters as the Events tab
  // (Year, Month, region/state cross-filter, IRONMAN). Only events with resolved coordinates get a pin.
  const pinEvents = useMemo(() => {
    if (!st.p || !showPins || !selYears || !selYears.length) return [];
    const allM = selMonths.indexOf('all') >= 0;
    let a = [];
    selYears.forEach((y) => { a = a.concat(st.p.eventsByYear[y] || []); });
    return a.filter((r) => {
      if (r[30] == null || r[31] == null) return false;                 // needs lat/lng
      if (!allM && r[4] && selMonths.indexOf(String(+String(r[4]).substr(5, 2))) < 0) return false;
      if (regionSel && r[1] !== regionSel) return false;
      if (stateSel && r[0] !== stateSel) return false;
      if (pinIm && r[5] !== pinIm) return false;
      return true;
    });
  }, [st.p, showPins, selYears, selMonths, regionSel, stateSel, pinIm]);

  useEffect(() => {
    if (st.loading || st.error || !yb || !mapRef.current) return;
    const p = st.p;
    const m = yb.metrics[metricIdx] || yb.metrics[0];
    const { abbr, names, regs, regOrder, centroid } = p;
    const scale = (p.colors[colorIdx] && p.colors[colorIdx].scale) || [[0, '#eef2ff'], [1, '#082240']];
    // Choropleth/YoY paint the state fill; "none" leaves a neutral map (the POC "Pins" look). Pins overlay
    // independently via showPins, so any combination (fill+pins, neutral+pins, fill only, neutral) is valid.
    const fillOn = fillMode !== 'none';

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
    const traces = [fillOn ? {
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

    // Region borders (merged outline).
    if ((showOutlines || view === 'region' || view === 'both') && regionMesh) {
      traces.push({
        type: 'scattergeo', mode: 'lines', lon: regionMesh.lon, lat: regionMesh.lat,
        line: { width: 2.2, color: dark ? '#e2e8f0' : '#0f172a' }, hoverinfo: 'skip', showlegend: false,
      });
    }
    // State labels.
    if (showLabels && (view === 'state' || view === 'both')) {
      traces.push({
        type: 'scattergeo', locationmode: 'USA-states', mode: 'text',
        lon: abbr.map((ab) => (centroid[ab] ? centroid[ab][0] : null)),
        lat: abbr.map((ab) => (centroid[ab] ? centroid[ab][1] : null)),
        text: m.labels, textfont: { size: 11, color: fillOn ? labColor(m.statez, m.mn, m.mx) : (dark ? '#e2e8f0' : '#334155') },
        hoverinfo: 'skip', showlegend: false,
      });
    }
    // Region labels.
    if (showLabels && (view === 'region' || view === 'both')) {
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
    // Top-N spotlight: gold outline + numbers. Skipped on the neutral Pins map (it ranks the fill metric).
    if (spotN && fillOn) {
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

    // Event pins overlay (Pins map style): two layers, sized by participants against maxParts. Navy =
    // non-IRONMAN, red = IRONMAN. Hover shows event detail; click cross-filters the Events tab (state).
    if (showPins && pinEvents.length) {
      const sr = (2 * (p.maxParts || 1)) / (40 * 40);   // sizeref so the biggest event ~= 40px (area mode)
      const layers = [['No', PIN_NON], ['Yes', PIN_IM]];
      layers.forEach(([flag, color]) => {
        const rows = pinEvents.filter((r) => r[5] === flag);
        if (!rows.length) return;
        traces.push({
          type: 'scattergeo', mode: 'markers', lon: rows.map((r) => r[31]), lat: rows.map((r) => r[30]),
          marker: {
            size: rows.map((r) => r[6] || 0), sizemode: 'area', sizeref: sr, sizemin: 3,
            color, opacity: 0.62, line: { width: 0.4, color: 'white' },
          },
          customdata: rows.map((r) => [
            '<b>' + r[2] + '</b><br>' + r[0] + ' · ' + r[1] + ' · ' + fmtEvDate(r[4])
            + '<br>' + (r[6] || 0).toLocaleString() + ' participants · ' + (r[28] || 0).toLocaleString() + ' unique'
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
        // Pin click: customdata is [tooltip, state] -> cross-filter that event's state.
        if (Array.isArray(pt.customdata)) { setStateSel(pt.customdata[1]); setRegionSel(''); return; }
        if (!pt.location) return;
        if (view === 'region') { setRegionSel(p.ab2region[pt.location] || ''); setStateSel(null); }
        else { setStateSel(pt.location); setRegionSel(''); }
      });
    });
  }, [st, yb, metricIdx, view, showLabels, showOutlines, spotN, colorIdx, colorMode, logMode, clipMax, reverse, zoom, dark, regionMesh, regionCentroids, fillMode, showPins, pinEvents]);

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

  // Reset every filter/control back to defaults (the ⟲ button).
  const resetAll = () => {
    setSelYears([years[years.length - 1]]); setSelMonths(['all']);
    setMetricIdx(0); setView('state'); setShowLabels(true); setShowOutlines(false);
    setSpotN(10); setColorMode('value'); setLogMode(false); setClipMax(''); setReverse(false);
    setZoom(1); setFillMode('choro'); setShowPins(false); setPinIm(''); setStateSel(null); setRegionSel('');
    const ci = (p.colors || []).findIndex((c) => /blues/i.test(c.name || ''));
    setColorIdx(ci >= 0 ? ci : 0);
  };

  // Export the current map data (every state, all metrics for the selected year/month) to CSV.
  const exportCsv = () => {
    const header = ['State', 'Name', 'Region'].concat(metrics.map((m) => m.label));
    const rows = p.abbr.map((ab, i) => [ab, p.names[i], p.regs[i]].concat(metrics.map((m) => (m.statez[i] == null ? '' : m.statez[i]))));
    downloadCSV('participation_map_' + suf(selYears, selMonths) + '.csv', header, rows);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>Participation maps</h2>
        <span className="muted small">{p.abbr.length} states · {metrics.length} metrics · {labelText(selYears, selMonths)}</span>
      </div>

      {kpis ? (
        <div className="kpis">
          <Kpi v={fmt(kpis.participants)} l={`Participants (${labelText(selYears, selMonths)})`} t="Count of participation records (event starts) for the selected period. One athlete racing 3× counts as 3." />
          <Kpi v={fmt(kpis.unique) + (kpis.approx ? ' ~' : '')} l="Unique athletes" t="Distinct athletes (deduplicated). ~ means summed across periods (approximate) for a multi-period selection." />
          <Kpi v={kpis.homePct == null ? '—' : kpis.homePct + '%'} l="Home (in-state)" t="Share of participations where the athlete raced in their home state (of home + away)." />
          <Kpi v={fmt(kpis.away)} l="Traveled away" t="Participations where the athlete’s home state differs from the event state (cross-state travel)." />
        </div>
      ) : null}

      <div className="toolbar" style={{ gap: 6 }}>
        <label title={metricDesc(metrics[metricIdx] && metrics[metricIdx].label)}>Metric&nbsp;
          <select value={metricIdx} onChange={(e) => setMetricIdx(Number(e.target.value))}>
            {metrics.map((m, i) => <option key={i} value={i} title={metricDesc(m.label)}>{m.label}</option>)}
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
            <div style={{ position: 'absolute', zIndex: 60, top: '110%', left: 0, background: 'var(--card-bg, #fff)', color: 'inherit', border: '1px solid #cbd5e1', borderRadius: 6, padding: 6, maxHeight: 260, overflow: 'auto', minWidth: 150, boxShadow: '0 8px 20px rgba(0,0,0,.2)' }}>
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
        <button style={seg(fillMode === 'choro')} title="Metric choropleth fill (on/off)"
          onClick={() => setFillMode((f) => (f === 'choro' ? 'none' : 'choro'))}>Choropleth</button>
        <button style={seg(showPins)} title="Event pins overlay (on/off)"
          onClick={() => setShowPins((s) => !s)}>Pins</button>
        <button style={{ ...seg(fillMode === 'yoy'), opacity: 0.4, cursor: 'not-allowed' }} disabled title="Coming next">YoY</button>
        <button style={{ ...seg(false), opacity: 0.4, cursor: 'not-allowed' }} disabled title="Coming next">Flows</button>
        <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {['state', 'region', 'both'].map((v) => (
            <button key={v} style={seg(view === v)} onClick={() => pickView(v)}>
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

      <div className="toolbar">
        <button style={seg(advOpen)} onClick={() => setAdvOpen((o) => !o)}>⚙ Display options {advOpen ? '▾' : '▸'}</button>
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
          <button style={mini(false)} title="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.4))}>−</button>
          <button style={mini(false)} title="Zoom in" onClick={() => setZoom((z) => Math.min(10, z * 1.4))}>+</button>
          <button style={mini(false)} title="Reset all filters & controls" onClick={resetAll}>⟲</button>
          <button style={mini(false)} title="Download data (CSV)" onClick={exportCsv}>CSV</button>
          <button style={mini(false)} title="Download PNG" onClick={exportPng}>PNG</button>
          <button style={mini(false)} title="Fullscreen" onClick={toggleFs}>⛶</button>
        </span>
      </div>

      {advOpen ? (
        <div className="toolbar">
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button style={mini(colorMode === 'value')} onClick={() => setColorMode('value')}>Value</button>
            <button style={mini(colorMode === 'rank')} onClick={() => setColorMode('rank')}>Rank</button>
          </span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button style={mini(!logMode)} onClick={() => setLogMode(false)}>Linear</button>
            <button style={mini(logMode)} onClick={() => setLogMode(true)}>Log</button>
          </span>
          <label>Colors&nbsp;
            <select value={colorIdx} onChange={(e) => setColorIdx(Number(e.target.value))}>
              {(p.colors || []).map((c, i) => <option key={i} value={i}>{c.name}</option>)}
            </select>
          </label>
          <label>Top&nbsp;
            <select value={spotN} onChange={(e) => setSpotN(Number(e.target.value))}>
              <option value={0}>Off</option>
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={25}>Top 25</option>
              <option value={50}>All</option>
            </select>
          </label>
          <label>Max&nbsp;
            <input type="number" value={clipMax} placeholder="auto" style={{ width: 80 }} onChange={(e) => setClipMax(e.target.value)} />
          </label>
          <button style={mini(false)} onClick={() => setClipMax('')}>Auto</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Labels
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showOutlines} onChange={(e) => setShowOutlines(e.target.checked)} /> Region borders
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Reverse the color scale (high values shade light instead of dark)">
            <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> Reverse shades
          </label>
        </div>
      ) : null}

      <div className="card" ref={cardRef}><div ref={mapRef} className="mapdiv" /></div>

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
        />
      ) : <div className="muted small" style={{ padding: 16, marginTop: 16 }}>Loading tables…</div>}
    </div>
  );
}

function Kpi({ v, l, t }) {
  return <div className="kpi" title={t || undefined} style={t ? { cursor: 'help' } : undefined}><div className="v">{v}</div><div className="l">{l}{t ? ' ⓘ' : ''}</div></div>;
}

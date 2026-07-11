import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { getYearBlock, kpisFromYB, computeYoY, resolveSlices, aggregateFlows, flowsHaveIM } from './lib/compute.js';
import { trackFilter, trackExport, track } from '../../lib/track.js';
import ParticipationTabs from './ParticipationTabs.jsx';
import { OPP_C, OPP_TXT, OPP_LABEL, OPP_ORDER, classifyBand, OppCard, OppTable } from './opportunity.jsx';

// Pure constants + helpers live in mapHelpers.js (extracted to keep this file focused on the component).
import {
  METRIC_DESC, METRIC_GROUPS, metricDesc, MI, MON3, MON_FULL, labelText, suf, downloadCSV, UNIQ_IDX,
  adjustUnique, PIN_NON, PIN_IM, YOY_SCALES, fmtEvDate, fmtVal, fmtShort, parseRGB, sampleScale,
  labColor, logTicks, loadTopojson, loadDeck, FLOW_VIEW0, FLOW_VIEW_FLAT, REGION_PALETTE, FLOW_GEO_URL,
  geoLayout, buildRegionTraces, buildOpportunityTraces, buildPinTraces, buildChoroplethTraces, buildFlowLayers,
} from './mapHelpers.js';


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
  const [flowLayer, setFlowLayer] = useState('arcs'); // (b) arcs (routes) | net (choropleth shading only)
  const [showRegions, setShowRegions] = useState(false);  // Regions reference map (states shaded by their region)
  const [oppBandMode, setOppBandMode] = useState('rel');   // Opportunity bands: 'rel' (national-relative, default) | 'stat' | 'abs'
  const [oppStatMethod, setOppStatMethod] = useState('quantile'); // Statistical mode: 'quantile' | 'sigma'
  const [oppSigmaK, setOppSigmaK] = useState(1);           // Statistical σ multiplier for the 'sigma' method
  const [oppLeaderCut, setOppLeaderCut] = useState(0.60);  // Absolute-mode: Leader ≥ this
  const [oppFloorCut, setOppFloorCut] = useState(0.27);    // Absolute-mode: Lagging ≤ this
  const [oppValues, setOppValues] = useState(true);        // Opportunity map: print penetration values on states (default on, like the heatmap)
  const [oppCardOpen, setOppCardOpen] = useState(true);    // Opportunity: state card open beside the map, or collapsed to a strip so the map enlarges
  const [oppKeyOpen, setOppKeyOpen] = useState(true);      // Opportunity: on-map band key expanded/collapsed
  const [oppBasis, setOppBasis] = useState('all');         // Opportunity basis driving the map/band/hero: 'all' = all-states (residents racing anywhere) · 'in' = in-state (residents racing only at home)
  const [oppAgeGroup, setOppAgeGroup] = useState('adult'); // Opportunity age group: 'adult' (20+) | 'youth' (4-19) — drives the reach numerator's age filter + the population denominator
  const [flowIM, setFlowIM] = useState('all');       // (c) all | im | nonim — IRONMAN-destination filter
  const [flowSpin, setFlowSpin] = useState(false);   // auto-rotate (bearing animation)
  const [flowStat, setFlowStat] = useState('');      // footer stat line
  const [flowKeyOpen, setFlowKeyOpen] = useState(true); // Flow-map legend collapsed/expanded
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
      const h = full ? window.innerHeight - 90 : 560;
      if (mapRef.current) {
        // A Plotly geo map keeps the US's fixed ~1.6:1 aspect and never stretches to fill. On a wide
        // fullscreen it fits to the height and strands the colorbar + a big empty band on the right.
        // Cap the map to the US aspect (height * 1.6) and center it so it fills the screen height
        // instead of hugging the left edge.
        mapRef.current.style.maxWidth = full ? Math.round(h * 1.6) + 'px' : '';
        mapRef.current.style.margin = full ? '0 auto' : '';
        Plotly.relayout(mapRef.current, { height: h });
        setTimeout(() => Plotly.Plots.resize(mapRef.current), 120);
      }
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Entering/leaving Opportunity narrows the map into a flex column; Plotly drew at the old width, so
  // reflow it once the new layout has applied (fixes the map spilling over the stat card).
  useEffect(() => {
    if (!mapRef.current) return;
    // Resize on the frame after the new flex layout has painted (double-rAF) so the map snaps to its new
    // width in step with the layout instead of drawing at the old width first and then jumping.
    let r1, r2;
    r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => { try { Plotly.Plots.resize(mapRef.current); } catch (e) { /* not drawn yet */ } }); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [fillMode, showRegions, showFlows, oppCardOpen]);

  // Mask the ~1s where the map redraws + reflows to its new column width (the "small then large" flash) with
  // a brief veil + spinner, so switching views reads as a clean fade instead of a jump.
  const [mapBusy, setMapBusy] = useState(false);
  useEffect(() => {
    setMapBusy(true);
    const t = setTimeout(() => setMapBusy(false), 1000);
    return () => clearTimeout(t);
  }, [fillMode, showRegions, showFlows, basemap]);
  // Collapsing/expanding the state card resizes the map — briefly veil it (fade to a small spinner, then
  // reveal at the new width) so the user sees a clean swap instead of the map jumping from big to small.
  const oppCardFirst = useRef(true);
  useEffect(() => {
    if (oppCardFirst.current) { oppCardFirst.current = false; return; }   // skip the initial mount
    setMapBusy(true);
    const t = setTimeout(() => setMapBusy(false), 320);
    return () => clearTimeout(t);
  }, [oppCardOpen]);

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

  // Region label anchors = mean of member-state centroids. AK/HI (albers-usa insets) and the off-map
  // territories GU/PR/VI are excluded so a far-flung member (e.g. Guam at +144° lng) can't drag the label.
  const regionCentroids = useMemo(() => {
    if (!st.p) return {};
    const { centroid, ab2region, abbr } = st.p;
    const acc = {};
    abbr.forEach((ab) => {
      if (ab === 'AK' || ab === 'HI' || ab === 'GU' || ab === 'PR' || ab === 'VI') return;
      const rg = ab2region[ab]; const c = centroid[ab];
      if (!rg || !c) return;
      acc[rg] = acc[rg] || { lon: 0, lat: 0, n: 0 };
      acc[rg].lon += c[0]; acc[rg].lat += c[1]; acc[rg].n += 1;
    });
    const out = {};
    Object.keys(acc).forEach((rg) => { out[rg] = [acc[rg].lon / acc[rg].n, acc[rg].lat / acc[rg].n]; });
    return out;
  }, [st.p]);

  const [homeData, setHomeData] = useState(null);   // on-demand home-side distinct adult athletes (penetration numerator)
  const [homeLoading, setHomeLoading] = useState(false);  // true while /api/home is in flight (drives the Opportunity map spinner)
  const [reachData, setReachData] = useState(null); // on-demand resident-reach split (all/in/out per home state, by age group) — feeds the Opportunity card
  // Aggregated year-block for the current selection (single full year is exact; else computeAgg).
  // Then append travel-flow metrics (46/47/48) + penetration metrics (49 adult-pen, 50 population, 51 home-
  // penetration from homeData) so the dropdown/choropleth/tables can shade & sort them without a server change.
  const yb = useMemo(() => {
    if (!(st.p && selYears && selYears.length)) return null;
    const base = getYearBlock(st.p, selYears, selMonths);
    if (!base || !st.p.odByYM) return base;
    const p = st.p, { abbr, ab2region, regOrder } = p;
    const A = aggregateFlows(resolveSlices(selYears, selMonths, p.monthsByYear), p.odByYM);
    const rIn = {}, rOut = {};
    abbr.forEach((ab) => { const rg = ab2region[ab]; rIn[rg] = (rIn[rg] || 0) + (A.inb[ab] || 0); rOut[rg] = (rOut[rg] || 0) + (A.outb[ab] || 0); });
    const build = (label, stFn, rgFn) => {
      const statez = abbr.map(stFn);
      const regionz = abbr.map((ab) => rgFn(ab2region[ab]));
      const vals = statez.filter((v) => v != null);
      const mn = vals.length ? Math.min.apply(null, vals) : 0, mx = vals.length ? Math.max.apply(null, vals) : 0;
      const labels = abbr.map((ab, i) => (statez[i] == null ? ab : ab + '<br>' + Number(statez[i]).toLocaleString()));
      const regionlabels = regOrder.map((rg) => rg + '<br>' + Number(rgFn(rg) || 0).toLocaleString());
      return { label, ispct: false, dec: false, statez, regionz, mn, mx, labels, regionlabels };
    };
    const metrics = base.metrics.slice();
    metrics[46] = build('Inbound — races drawn in', (ab) => A.inb[ab] || 0, (rg) => rIn[rg] || 0);
    metrics[47] = build('Outbound — residents racing away', (ab) => A.outb[ab] || 0, (rg) => rOut[rg] || 0);
    metrics[48] = build('Net flow (in − out)', (ab) => (A.inb[ab] || 0) - (A.outb[ab] || 0), (rg) => (rIn[rg] || 0) - (rOut[rg] || 0));

    // Penetration & Opportunity metrics (need Census population from step_2c). Both are resident penetrations,
    // matching the Opportunity tab: metric 51 All-states penetration / 1,000 adults (residents who raced anywhere)
    // and metric 49 In-state penetration / 1,000 adults (residents who raced only at home = home-only). Numerators
    // come from the on-demand home data (/api/home: byHomeState + byHomeStateOnlyIn), divided by adult population.
    const pop = p.population || {};
    const round2 = (v) => Math.round(v * 100) / 100;
    const idxOf = {}; abbr.forEach((ab, i) => { idxOf[ab] = i; });
    const regPop = {}; abbr.forEach((ab) => { const rg = ab2region[ab]; regPop[rg] = (regPop[rg] || 0) + (pop[ab] || 0); });
    // Adult population (20+) for the resident-penetration metric — matches the Opportunity tab's denominator.
    // Falls back to total population if the age-split columns aren't loaded (pre step_2c rerun).
    const popA = p.populationAdult || {};
    const regAdultPop = {}; abbr.forEach((ab) => { const rg = ab2region[ab]; regAdultPop[rg] = (regAdultPop[rg] || 0) + ((popA[ab] != null ? popA[ab] : pop[ab]) || 0); });
    const adPop = (ab) => (popA[ab] != null ? popA[ab] : pop[ab]);
    const hs = (homeData && homeData.byHomeState) || null, hr = (homeData && homeData.byHomeRegion) || null;
    const hsIn = (homeData && homeData.byHomeStateOnlyIn) || null, hrIn = (homeData && homeData.byHomeRegionOnlyIn) || null;
    // In-state penetration / 1,000 adults — distinct adult residents who raced ONLY in their home state (home-only)
    // ÷ ADULT population. Same definition as the Opportunity tab's in-state; a subset of all-states.
    metrics[49] = build('In-state penetration / 1,000 adults',
      (ab) => { const pp = adPop(ab), v = hsIn ? hsIn[ab] : null; return (pp && v != null) ? round2(v / pp * 1000) : null; },
      (rg) => { const pp = regAdultPop[rg], v = hrIn ? hrIn[rg] : null; return (pp && v != null) ? round2(v / pp * 1000) : null; });
    metrics[50] = build('Population (Census)', (ab) => pop[ab] || null, (rg) => regPop[rg] || null);
    // All-states penetration / 1,000 adults — distinct adult residents who raced anywhere ÷ ADULT population.
    // Identical calc to the Opportunity tab's all-states penetration (same numerator source, adult denominator).
    metrics[51] = build('All-states penetration / 1,000 adults',
      (ab) => { const pp = adPop(ab), v = hs ? hs[ab] : null; return (pp && v != null) ? round2(v / pp * 1000) : null; },
      (rg) => { const pp = regAdultPop[rg], v = hr ? hr[rg] : null; return (pp && v != null) ? round2(v / pp * 1000) : null; });
    return Object.assign({}, base, { metrics });
  }, [st.p, selYears, selMonths, homeData]);

  // Opportunity classification — derives, per state, the demand-side home-penetration (/1,000 pop), a
  // POPULATION-WEIGHTED national benchmark (Σ resident athletes ÷ Σ population × 1,000, so big states pull
  // the mean correctly), a band (leader ≥ national · under-penetrated below · floor < half national), the
  // gap to national, and the headroom = estimated additional resident athletes needed to reach the national
  // rate ((national − pen)/1000 × population). Returns null until home data + population are present.
  const oppData = useMemo(() => {
    if (!st.p || !yb) return null;
    const rs = reachData && reachData.byHomeState;
    if (!rs) return null;                            // needs the on-demand resident-reach split (/api/reach)
    const youth = oppAgeGroup === 'youth';
    // Denominator: adult (20+) or youth (<20) population from step_2c; falls back to all-ages if the age-split
    // columns aren't loaded yet (pre-rerun) so the card still renders (with a caveat) rather than blanking.
    const pop = youth ? (st.p.populationYouth || {}) : (st.p.populationAdult || st.p.population || {});
    const { abbr, names, regs } = st.p;
    const round2 = (v) => Math.round(v * 100) / 100;
    // Context fields from the metrics dropdown: 48 = net flow (in−out), 3 = per event, 12 = age 20-29 %,
    // 11 = age 4-19 %, 7 = female %, 8 = male %, 1 = events, 2 = races.
    const mNet = yb.metrics[48], mPer = yb.metrics[3], mAge = yb.metrics[12], mA419 = yb.metrics[11],
          mFem = yb.metrics[7], mMal = yb.metrics[8], mEv = yb.metrics[1], mRc = yb.metrics[2];
    const at = (mm, i) => (mm && mm.statez[i] != null ? mm.statez[i] : null);
    // Resident-reach split per home state (distinct member residents, ageGroup-filtered) from /api/reach:
    //   all = raced anywhere · onlyIn = raced ONLY in-state (home-only) · both = raced in AND out · onlyOut = raced ONLY out.
    // onlyIn / both / onlyOut are mutually exclusive and sum to all. In-state penetration uses onlyIn (home-only).
    const rOf = (ab) => { const r = rs[ab]; if (!r) return null; return { all: r.all, onlyIn: r.all - r.out, both: r.in + r.out - r.all, onlyOut: r.all - r.in }; };
    // Population-weighted national benchmarks: all-states from `all`, in-state from `onlyIn`, same denominator.
    let numSum = 0, popSum = 0, inNumSum = 0;
    abbr.forEach((ab) => { const R = rOf(ab), pp = pop[ab]; if (R && pp) { numSum += R.all; inNumSum += R.onlyIn; popSum += pp; } });
    if (!popSum) return null;
    const national = round2((numSum / popSum) * 1000);
    const inNational = round2((inNumSum / popSum) * 1000);
    const basisIn = oppBasis === 'in';
    const dNational = basisIn ? inNational : national;
    const penAll = (ab, pp) => { const R = rOf(ab); return (R && pp) ? round2((R.all / pp) * 1000) : null; };
    const penIn = (ab, pp) => { const R = rOf(ab); return (R && pp) ? round2((R.onlyIn / pp) * 1000) : null; };
    // Band cutoffs by mode, computed on the ACTIVE basis so the map/band follow the toggle. midCut = On-par/Under-penetrated boundary.
    const relMode = oppBandMode === 'rel';
    const vals = [];
    abbr.forEach((ab) => { const pp = pop[ab] || 0; const v = basisIn ? penIn(ab, pp) : penAll(ab, pp); if (v != null && pp) vals.push(v); });
    vals.sort((a, b) => a - b);
    const pctl = (q) => { if (!vals.length) return dNational; const idx = q * (vals.length - 1); const lo = Math.floor(idx), hi = Math.ceil(idx); return round2(vals[lo] + (vals[hi] - vals[lo]) * (idx - lo)); };
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : dNational;
    const sd = vals.length ? Math.sqrt(vals.reduce((a, s) => a + (s - mean) * (s - mean), 0) / vals.length) : 0;
    let leaderCut, midCut, floorCut, stat = null;
    if (relMode) { leaderCut = dNational; midCut = dNational; floorCut = round2(dNational / 2); }
    else if (oppBandMode === 'stat') {
      if (oppStatMethod === 'sigma') { leaderCut = round2(mean + oppSigmaK * sd); midCut = round2(mean); floorCut = round2(Math.max(0, mean - oppSigmaK * sd)); stat = { method: 'sigma', mean: round2(mean), sd: round2(sd), k: oppSigmaK }; }
      else { leaderCut = pctl(0.8); midCut = pctl(0.5); floorCut = pctl(0.2); stat = { method: 'quantile', p20: floorCut, p50: midCut, p80: leaderCut }; }
    } else { leaderCut = round2(oppLeaderCut); midCut = dNational; floorCut = round2(oppFloorCut); }
    const rows = abbr.map((ab, i) => {
      const R = rOf(ab), pp = pop[ab] || 0;
      const a419 = at(mA419, i), a2029 = at(mAge, i);
      const allPen = penAll(ab, pp), inPen = penIn(ab, pp);
      const allGap = allPen != null ? round2(allPen - national) : null;
      const allHead = (allPen != null && allPen < national && pp) ? Math.round(((national - allPen) / 1000) * pp) : 0;
      const inGap = inPen != null ? round2(inPen - inNational) : null;
      const inHead = (inPen != null && inPen < inNational && pp) ? Math.round(((inNational - inPen) / 1000) * pp) : 0;
      const ctx = { reg: regs[i],
        allCnt: R ? R.all : null, onlyInCnt: R ? R.onlyIn : null, bothCnt: R ? R.both : null, onlyOutCnt: R ? R.onlyOut : null,
        net: at(mNet, i) == null ? null : -at(mNet, i),  // net flow home−event = −(in−out): negative = destination
        perEvent: at(mPer, i), age2029: a2029, age419: a419,
        age30: (a419 != null && a2029 != null) ? Math.max(0, Math.round(100 - a419 - a2029)) : null,
        male: at(mMal, i), female: at(mFem, i), events: at(mEv, i), races: at(mRc, i),
        pen: allPen, gap: allGap, headroom: allHead, inPen, inGap, inHeadroom: inHead };
      const activePen = basisIn ? inPen : allPen;
      const dGap = basisIn ? inGap : allGap, dHeadroom = basisIn ? inHead : allHead, dNum = basisIn ? (R ? R.onlyIn : null) : (R ? R.all : null);
      if (activePen == null || !pp) return { ab, name: names[i], band: null, pop: pp, dPen: null, dGap: null, dHeadroom: 0, dNum, ...ctx };
      const band = classifyBand(activePen, midCut, leaderCut, floorCut);
      return { ab, name: names[i], band, pop: pp, dPen: activePen, dGap, dHeadroom, dNum, ...ctx };
    });
    const counts = { leader: 0, mid: 0, under: 0, floor: 0 };
    rows.forEach((r) => { if (r.band) counts[r.band]++; });
    return { national, inNational, dNational, basisIn, ageGroup: oppAgeGroup, natNum: numSum, natPop: popSum, inNatNum: inNumSum, inNatPop: popSum, rows, counts, leaderCut, midCut, floorCut, relMode, mode: oppBandMode, stat };
  }, [st.p, yb, reachData, oppBandMode, oppStatMethod, oppSigmaK, oppLeaderCut, oppFloorCut, oppBasis, oppAgeGroup]);
  // The state shown in the card / highlighted in the table: the clicked state if valid, else a sensible
  // default (the biggest-headroom opportunity) so the card is never empty when Opportunity opens.
  const oppSel = useMemo(() => {
    if (!oppData) return stateSel;
    if (stateSel && oppData.rows.some((r) => r.ab === stateSel && r.band != null)) return stateSel;
    const top = oppData.rows.filter((r) => r.band).slice().sort((a, b) => b.headroom - a.headroom)[0];
    return (top && top.ab) || stateSel || null;
  }, [oppData, stateSel]);
  // Opportunity is "active" only when its tab is the current view — Flows/Regions take over the canvas, so
  // the card/table/bands must hide even though fillMode is still 'opp' underneath.
  const oppView = fillMode === 'opp' && !showFlows && !showRegions;
  // Stable selector shared with the Opportunity ranking (now a bottom tab) so map ↔ table ↔ card stay in sync.
  const onOppSelect = useCallback((ab) => { setStateSel((c) => (c === ab ? null : ab)); setRegionSel(''); }, []);

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

  // Home-side distinct adult athletes (penetration numerator) for the current selection — feeds the
  // the all-states + in-state penetration metrics. Latest-wins guard so a stale response can't overwrite a newer one.
  useEffect(() => {
    if (!st.p || !selYears || !selYears.length) { setHomeData(null); return; }
    let live = true;
    setHomeLoading(true);
    api.homeFor({ years: selYears, months: selMonths })
      .then(({ status, body }) => { if (live) { setHomeData(status === 200 && body && body.ok ? body : null); setHomeLoading(false); } })
      .catch(() => { if (live) { setHomeData(null); setHomeLoading(false); } });
    return () => { live = false; };
  }, [st.p, selYears, selMonths]);

  // Resident-reach split (all-states / in-state / out-of-state per home state) for the current selection + age
  // group — feeds the Opportunity card. Latest-wins guard; refetched when Adult/Youth toggles.
  useEffect(() => {
    if (!st.p || !selYears || !selYears.length) { setReachData(null); return; }
    let live = true;
    api.reachFor({ years: selYears, months: selMonths, ageGroup: oppAgeGroup })
      .then(({ status, body }) => { if (live) setReachData(status === 200 && body && body.ok ? body : null); })
      .catch(() => { if (live) setReachData(null); });
    return () => { live = false; };
  }, [st.p, selYears, selMonths, oppAgeGroup]);
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
    const A = aggregateFlows(keys, st.p.odByYM, flowIM);
    const nm = (ab) => st.p.names[st.p.abbr.indexOf(ab)] || ab;
    const inb = A.flows.filter((r) => r[1] === flowFocus).sort((a, b) => b[2] - a[2]).slice(0, flowTop).map((r) => [nm(r[0]), r[2], A.inb[r[0]] || 0, A.outb[r[0]] || 0]);
    const outb = A.flows.filter((r) => r[0] === flowFocus).sort((a, b) => b[2] - a[2]).slice(0, flowTop).map((r) => [nm(r[1]), r[2], A.inb[r[1]] || 0, A.outb[r[1]] || 0]);
    return { inb, outb, focusName: nm(flowFocus) };
  }, [st.p, showFlows, flowFocus, flowLayer, flowTop, flowIM, selYears, selMonths]);

  // (c) IRONMAN vs non-IRONMAN cross-state travel totals for the current year/month selection — feeds the
  // summary card above the flow map. Independent of focus/direction so the split reflects the whole slice.
  const imAvailable = useMemo(() => (st.p ? flowsHaveIM(st.p.odByYM) : false), [st.p]);
  const flowIMSummary = useMemo(() => {
    if (!st.p || !showFlows || !imAvailable) return null;
    const keys = resolveSlices(selYears, selMonths, st.p.monthsByYear);
    const sum = (o) => Object.keys(o).reduce((a, k) => a + o[k], 0);
    const total = sum(aggregateFlows(keys, st.p.odByYM, 'all').outb);
    const im = sum(aggregateFlows(keys, st.p.odByYM, 'im').outb);
    return { total, im, nonim: total - im };
  }, [st.p, showFlows, imAvailable, selYears, selMonths]);

  // (b) Net-view stats: ranked net destinations (draw racers in) vs net feeders (send racers out) for the
  // current selection + IM filter. Gives the Net view a concrete read-out instead of just on-map shading.
  const flowNetStats = useMemo(() => {
    if (!st.p || !showFlows || flowLayer !== 'net') return null;
    const keys = resolveSlices(selYears, selMonths, st.p.monthsByYear);
    const A = aggregateFlows(keys, st.p.odByYM, flowIM);
    const nm = (ab) => st.p.names[st.p.abbr.indexOf(ab)] || ab;
    const rows = st.p.abbr.map((ab) => ({ ab, name: nm(ab), inb: A.inb[ab] || 0, outb: A.outb[ab] || 0, net: (A.inb[ab] || 0) - (A.outb[ab] || 0) }));
    const dest = rows.filter((r) => r.net > 0).sort((a, b) => b.net - a.net).slice(0, 10);
    const feed = rows.filter((r) => r.net < 0).sort((a, b) => a.net - b.net).slice(0, 10);
    return { dest, feed };
  }, [st.p, showFlows, flowLayer, flowIM, selYears, selMonths]);

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
    // Regions reference map: states tinted by their region (categorical), region borders + both labels on.
    // Time-invariant (region membership never changes), so it ignores the metric / year / month selectors.
    // Attach the shared "click a state to cross-filter" handler to a freshly-drawn geo map.
    const onStateClick = (gd) => {
      if (!gd || !gd.on) return; gd.removeAllListeners && gd.removeAllListeners('plotly_click');
      gd.on('plotly_click', (ev) => { const pt = ev.points && ev.points[0]; if (pt && pt.location) { setStateSel((c) => (c === pt.location ? null : pt.location)); setRegionSel(''); } });
    };
    if (showRegions) {
      Plotly.react(mapRef.current, buildRegionTraces(p, { dark, regionMesh, regionCentroids }), geoLayout(zoom),
        { displayModeBar: false, responsive: true }).then(onStateClick);
      return;
    }
    // Opportunity classification map — self-contained builder (its own discrete scale + hover + click).
    // Falls back to a neutral map until the penetration data has loaded.
    if (fillMode === 'opp') {
      Plotly.react(mapRef.current, buildOpportunityTraces(p, oppData, { dark, showLabels, showOutlines, oppValues, regionMesh }), geoLayout(zoom),
        { displayModeBar: false, responsive: true }).then(onStateClick);
      return;
    }
    if (wantMapbox) {
      Plotly.react(mapRef.current, buildPinTraces(pinEvents, p, { dark }), {
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
    const traces = buildChoroplethTraces(p, yb, {
      metricIdx, uniqueData, colorIdx, view, fillMode, colorMode, logMode, clipMax, reverse, dark,
      spotN, showLabels, showOutlines, showPins, pinEvents, regionMesh, regionCentroids,
      yoyData, yoyColorIdx, yoyFrom, yoyTo, yoyTop,
    });

    Plotly.react(mapRef.current, traces, geoLayout(zoom), { displayModeBar: false, responsive: true }).then((gd) => {
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
  }, [st, yb, metricIdx, view, showLabels, showOutlines, spotN, colorIdx, colorMode, logMode, clipMax, reverse, zoom, dark, regionMesh, regionCentroids, fillMode, showPins, pinEvents, yoyData, yoyTop, yoyFrom, yoyTo, yoyColorIdx, showFlows, showRegions, oppData, oppValues, uniqueData, basemap]);

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
      const A = aggregateFlows(keys, p.odByYM, flowIM);
      const net = {}; p.abbr.forEach((ab) => { net[ab] = (A.inb[ab] || 0) - (A.outb[ab] || 0); });
      const maxNet = Math.max.apply(null, p.abbr.map((ab) => Math.abs(net[ab])).concat([1]));
      const arcsOn = flowLayer === 'arcs';   // (b) Net view = choropleth shading only (no route arcs/badges)

      const arcs = []; let maxArc = 1;
      if (flowFocus && arcsOn) {
        let IN = A.flows.filter((r) => r[1] === flowFocus).sort((a, b) => b[2] - a[2]).slice(0, flowTop);
        let OUT = A.flows.filter((r) => r[0] === flowFocus).sort((a, b) => b[2] - a[2]).slice(0, flowTop);
        maxArc = Math.max.apply(null, IN.concat(OUT).map((r) => r[2]).concat([1]));
        const nm = (ab) => p.names[p.abbr.indexOf(ab)] || ab;
        if (flowDir !== 'out') IN.forEach((r) => { if (p.centroid[r[0]] && p.centroid[flowFocus]) arcs.push({ s: p.centroid[r[0]], t: p.centroid[flowFocus], n: r[2], lbl: nm(r[0]) + ' → ' + nm(flowFocus), c: [194, 14, 47] }); });
        if (flowDir !== 'in') OUT.forEach((r) => { if (p.centroid[flowFocus] && p.centroid[r[1]]) arcs.push({ s: p.centroid[flowFocus], t: p.centroid[r[1]], n: r[2], lbl: nm(flowFocus) + ' → ' + nm(r[1]), c: [24, 95, 165] }); });
      }

      const layers = buildFlowLayers(deck, geo, { p, name2ab, net, maxNet, arcs, maxArc, arcsOn, keys, showLabels, showOutlines, regionMesh, dark, A, flowFocus, flowDir, flowTop, flowIM });

      const tooltip = (o) => {
        if (!o || !o.object) return null; const ob = o.object;
        if (ob.n) return { html: '<div style="font:12px Arial;background:#0f172a;color:#fff;padding:6px 8px;border-radius:6px">' + ob.lbl + '<br>' + ob.n.toLocaleString() + ' athletes</div>' };
        if (ob.properties) { const ab = name2ab[ob.properties.name]; if (!ab) return null; return { html: '<div style="font:12px Arial;background:#0f172a;color:#fff;padding:6px 8px;border-radius:6px"><b>' + ob.properties.name + '</b><br>In ' + (A.inb[ab] || 0).toLocaleString() + ' · Out ' + (A.outb[ab] || 0).toLocaleString() + ' · Net ' + (net[ab] || 0).toLocaleString() + '<br><span style="opacity:.7">click to focus</span></div>' }; }
        return null;
      };
      // Click a state on the flow map to make it the focus (arcs recenter on it).
      const onClick = (info) => {
        const ob = info && info.object;
        if (ob && ob.properties) { const ab = name2ab[ob.properties.name]; if (ab) setFlowFocus((c) => (c === ab ? '' : ab)); }
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
      const imTag = flowIM === 'im' ? ' · IRONMAN destinations only' : (flowIM === 'nonim' ? ' · non-IRONMAN destinations only' : '');
      setFlowStat(flowFocus
        ? (p.names[p.abbr.indexOf(flowFocus)] || flowFocus) + ': ' + (A.inb[flowFocus] || 0).toLocaleString() + ' travel in, ' + (A.outb[flowFocus] || 0).toLocaleString() + ' race elsewhere · net ' + ((net[flowFocus] || 0) >= 0 ? '+' : '') + (net[flowFocus] || 0).toLocaleString() + imTag + '.'
        : 'States shaded by net flow (red = destination, blue = feeder)' + imTag + '. ' + (arcsOn ? 'Pick a focus state to trace routes. ' : 'Click a state to see its top routes. ') + 'Drag to tilt, scroll to zoom.');
    };

    loadDeck().then((deck) => {
      if (!deck) { setFlowLoading(false); setFlowStat('deck.gl failed to load (needs internet).'); return; }
      if (flowGeoRef.current) return render(deck, flowGeoRef.current);
      fetch(FLOW_GEO_URL).then((r) => r.json()).then((g) => { flowGeoRef.current = g; render(deck, g); })
        .catch(() => { setFlowLoading(false); setFlowStat('Could not load the base map (needs internet).'); });
    }).catch(() => { setFlowLoading(false); setFlowStat('deck.gl failed to load (needs internet).'); });

    return () => { cancelled = true; };
  }, [showFlows, st.p, flowFocus, flowDir, flowTop, flowLayer, flowIM, selYears, selMonths, showLabels, showOutlines, regionMesh, dark]);

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
    if (!showFlows || !flowSpin || flowLayer === 'net') return;
    const tick = () => {
      const v = flowViewRef.current; flowViewRef.current = { ...v, bearing: ((v.bearing || 0) + 0.4) % 360 };
      if (deckInst.current) deckInst.current.setProps({ viewState: flowViewRef.current });
      spinRaf.current = requestAnimationFrame(tick);
    };
    spinRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(spinRaf.current);
  }, [showFlows, flowSpin]);

  // Net view reads best flat & top-down (the 3D tilt clips the southern states); Arcs keeps the 3D camera.
  // Reset the deck camera whenever the view mode flips.
  useEffect(() => {
    if (!showFlows) return;
    flowViewRef.current = flowLayer === 'net' ? { ...FLOW_VIEW_FLAT } : { ...FLOW_VIEW0 };
    if (deckInst.current) deckInst.current.setProps({ viewState: flowViewRef.current });
  }, [flowLayer, showFlows]);

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
  // Selected state must read clearly in BOTH themes: dark navy fill on light, a bright accent fill on dark
  // (dark-on-dark was hard to distinguish). Active also gets a matching border + bold + subtle glow.
  const seg = (active) => ({
    padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
    border: '1px solid ' + (active ? (dark ? '#60a5fa' : '#082240') : 'var(--border, #cbd5e1)'),
    background: active ? (dark ? '#2563eb' : '#082240') : 'transparent',
    color: active ? '#fff' : 'inherit', fontWeight: active ? 700 : 400,
    boxShadow: active && dark ? '0 0 0 1px #60a5fa' : 'none',
  });
  const mini = (active) => ({ ...seg(active), padding: '3px 9px', fontSize: 12 });
  // Folder-style tabs (map-view switcher). The active tab is outlined (top + sides), sits on the row's
  // baseline rule with its bottom open, and is filled with the panel color so it reads as connected to the
  // content below. Inactive tabs are borderless + muted so only the active one pops.
  const tab = (active) => ({
    padding: '8px 15px', fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: -1,
    borderRadius: '7px 7px 0 0', borderBottom: 'none',
    border: active ? '1px solid var(--line)' : '1px solid transparent',
    background: active ? 'var(--panel)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--muted)',
  });

  // General reset (the ⟲ button): return EVERYTHING to defaults — map type, layer, zoom/size, filters,
  // colors and cross-filters. Use the map-type buttons to change views without resetting.
  const resetAll = () => {
    setSelYears([years[years.length - 1]]); setSelMonths(['all']);
    setMetricIdx(0); setView('state'); setShowLabels(true); setShowOutlines(false);
    setSpotN(10); setColorMode('value'); setLogMode(false); setClipMax(''); setReverse(false);
    setZoom(1); setFillMode('choro'); setShowPins(false); setShowFlows(false); setShowRegions(false);
    setOppBandMode('rel'); setOppStatMethod('quantile'); setOppSigmaK(1); setOppLeaderCut(0.60); setOppFloorCut(0.27); setOppValues(true); setOppCardOpen(true); setOppBasis('all'); setOppAgeGroup('adult');
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
        {p.buildMeta ? (
          <span
            title={'Reporting data build: ' + (p.buildMeta.mode === 'test' ? 'TEST (2024 & 2025 only) — re-run the FULL step 3i before sharing' : 'full data') + ' · years ' + p.buildMeta.minYear + '–' + p.buildMeta.maxYear + (p.buildMeta.builtAt ? (' · built ' + p.buildMeta.builtAt) : '')}
            style={{
              marginLeft: 8, padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
              background: p.buildMeta.mode === 'test' ? (dark ? '#4a3a1d' : '#fff7e6') : (dark ? '#14351f' : '#e8f3e8'),
              color: p.buildMeta.mode === 'test' ? (dark ? '#f5c86a' : '#8a6400') : (dark ? '#8fd39f' : '#2e7d32'),
              border: '1px solid ' + (p.buildMeta.mode === 'test' ? (dark ? '#7a5a1d' : '#f0d28a') : (dark ? '#2f6b3f' : '#bfe0bf')),
            }}
          >
            {(p.buildMeta.mode === 'test' ? 'TEST DATA' : 'FULL DATA') + ' · ' + p.buildMeta.minYear + '–' + p.buildMeta.maxYear}
          </span>
        ) : null}
      </div>

      {kpis ? (
        <div className="kpis">
          <Kpi v={fmt(kpis.participants)} l={`Participants (${labelText(selYears, selMonths)})`} t="Count of participation records (event starts) for the selected period. One athlete racing 3× counts as 3." />
          <Kpi v={uniqLoading ? '…' : (fmt(uniqueData ? uniqueData.national : kpis.unique) + ((!uniqueData && kpis.approx) ? ' ~' : ''))} l="Unique athletes" t="Distinct athletes for the exact selection, counted live from the base data (COUNT DISTINCT id_profiles = active members). Exact — not the sum of per-slice counts. ‘…’ = loading; ‘~’ = fell back to the approximate summed count if the live count was unavailable." />
          <Kpi v={(kpis.home + kpis.away) ? Math.round(100 * kpis.home / (kpis.home + kpis.away)) + '%' : '—'} l="Known home (in-state)" t="Share of KNOWN-home participations that raced in the athlete's home state — home ÷ (home + away), excluding the ~10% whose home state is unknown/unmapped. This is the known-home basis (the deck definition); the of-total home % (÷ all participants) runs lower." />
          <Kpi v={fmt(kpis.away)} l="Traveled away" t="Participations where the athlete’s home state differs from the event state (cross-state travel)." />
        </div>
      ) : null}

      <div className="toolbar" style={{ gap: 6, flexWrap: 'wrap', rowGap: 6 }}>
        <label title={(showFlows || showRegions || fillMode === 'opp') ? 'Metric doesn’t apply to this view — switch to Heatmap, Pins, or YoY to pick a metric' : metricDesc(metrics[metricIdx] && metrics[metricIdx].label, p.populationSource)} style={(showFlows || showRegions || fillMode === 'opp') ? { opacity: 0.4 } : undefined}>Metric&nbsp;
          <select value={metricIdx} disabled={showFlows || showRegions || fillMode === 'opp'} style={{ maxWidth: 220 }} onChange={(e) => { setMetricIdx(Number(e.target.value)); trackFilter('participation-maps', 'map', 'metric'); }}>
            {METRIC_GROUPS.map((g) => {
              const opts = g.idxs.filter((i) => metrics[i]);
              if (!opts.length) return null;
              return <optgroup key={g.label} label={g.label}>
                {opts.map((i) => <option key={i} value={i} title={metricDesc(metrics[i].label, p.populationSource)}>{metrics[i].label}</option>)}
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
        {!showRegions ? <button style={seg(advOpen)} onClick={() => setAdvOpen((o) => !o)}>⚙ Display options {advOpen ? '▾' : '▸'}</button> : null}
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

      <div className="toolbar" style={{ gap: 4, flexWrap: 'wrap', rowGap: 6, alignItems: 'flex-end', borderBottom: '1px solid var(--line)' }}>
        <button style={tab(fillMode === 'choro' && !showFlows && !showRegions)} title="Metric heatmap fill (on/off)"
          onClick={() => { setShowRegions(false); track('map_style', { panel: 'participation-maps', view: 'choropleth' }); if (showFlows) { setShowFlows(false); setFillMode('choro'); } else setFillMode((f) => (f === 'choro' ? 'none' : 'choro')); }}>Heatmap</button>
        <button style={tab(showPins && !showFlows && !showRegions)} title="Event pins map (turns the fill off; re-select Heatmap to bring it back)"
          onClick={() => { setShowRegions(false); if (showFlows) { setShowFlows(false); setShowPins(true); setFillMode('none'); } else { const on = !showPins; setShowPins(on); if (on) setFillMode('none'); } }}>Pins</button>
        <button style={tab(fillMode === 'yoy' && !showFlows && !showRegions)} title="Year-over-year change fill (on/off)"
          onClick={() => { setShowRegions(false); track('map_style', { panel: 'participation-maps', view: 'yoy' }); if (showFlows) { setShowFlows(false); setFillMode('yoy'); } else setFillMode((f) => (f === 'yoy' ? 'none' : 'yoy')); }}>YoY</button>
        <button style={tab(showFlows)} title="Athlete travel arcs (3D) — replaces the map"
          onClick={() => { track('map_style', { panel: 'participation-maps', view: 'flows' }); setShowRegions(false); setShowFlows((s) => !s); }}>Flows</button>
        <button style={tab(showRegions)} title="Reference map: states shaded by their region"
          onClick={() => { track('map_style', { panel: 'participation-maps', view: 'regions' }); setShowRegions((s) => { const on = !s; if (on) { setShowFlows(false); setShowPins(false); } return on; }); }}>Regions</button>
        <button style={tab(fillMode === 'opp' && !showFlows && !showRegions)} title="Opportunity map: states classified leader / under-penetrated / floor vs the national home-penetration rate"
          onClick={() => { track('map_style', { panel: 'participation-maps', view: 'opportunity' }); setShowFlows(false); setShowRegions(false); setShowPins(false); setFillMode('opp'); }}>Opportunity</button>
        <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 8px 6px' }} />
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {['state', 'region', 'both'].map((v) => (
            <button key={v} style={{ ...seg(view === v && !showFlows && !showRegions && fillMode !== 'opp'), ...((showFlows || showRegions || fillMode === 'opp') ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }} disabled={showFlows || showRegions || fillMode === 'opp'} onClick={() => pickView(v)}>
              {v === 'state' ? 'State' : v === 'region' ? 'Region' : 'Both'}
            </button>
          ))}
        </span>
      </div>

      {showPins && !showFlows && !showRegions ? (
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

      {fillMode === 'yoy' && !showFlows && !showRegions ? (
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

      {fillMode === 'yoy' && !showFlows && !showRegions && yoyData && yoyData.mos && yoyData.mos.length ? (
        <div className="small muted" style={{ margin: '-4px 0 8px', paddingLeft: 2 }}>
          Year-over-year compares the <b>same period in both years</b> — {(() => { const ms = yoyData.mos.slice().sort((a, b) => a - b); return ms.length >= 12 ? 'full year (Jan–Dec)' : (MON3[ms[0]] + (ms.length > 1 ? '–' + MON3[ms[ms.length - 1]] : '')); })()} of {yoyFrom} vs {yoyTo}. Months present in only one year are excluded, so a partial year (e.g. the current one) is a like-for-like year-to-date comparison.
        </div>
      ) : null}

      {showFlows ? (
        <div className="toolbar" style={{ alignItems: 'center' }}>
          {/* (b) View toggle: Arcs traces focus-state routes; Net shows only the net-flow choropleth shading. */}
          <span className="small muted">View</span>
          <span style={{ display: 'inline-flex', gap: 4 }} title="Arcs = trace a focus state's routes · Net = net-flow shading only (no arcs)">
            <button style={mini(flowLayer === 'arcs')} onClick={() => setFlowLayer('arcs')}>Arcs</button>
            <button style={mini(flowLayer === 'net')} onClick={() => setFlowLayer('net')}>Net</button>
          </span>
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
          {(() => { const arcsOn = flowLayer === 'arcs'; const dim = arcsOn ? undefined : { opacity: 0.4 }; const dt = arcsOn ? '' : 'Switch to Arcs view to trace routes'; return (
          <>
          <label className="small" style={dim} title={dt}>Focus state&nbsp;
            <select value={flowFocus} disabled={!arcsOn} onChange={(e) => setFlowFocus(e.target.value)}>
              <option value="">— net flow (no focus) —</option>
              {p.abbr.slice().sort((a, b) => (p.names[p.abbr.indexOf(a)] < p.names[p.abbr.indexOf(b)] ? -1 : 1)).map((ab) => <option key={ab} value={ab}>{p.names[p.abbr.indexOf(ab)]}</option>)}
            </select>
          </label>
          <span className="small muted" style={dim}>Direction</span>
          <span style={{ display: 'inline-flex', gap: 4 }} title={dt}>
            <button style={{ ...mini(flowDir === 'both'), ...dim }} disabled={!arcsOn} onClick={() => setFlowDir('both')}>Both</button>
            <button style={{ ...mini(flowDir === 'in'), ...dim }} disabled={!arcsOn} onClick={() => setFlowDir('in')}>Inbound</button>
            <button style={{ ...mini(flowDir === 'out'), ...dim }} disabled={!arcsOn} onClick={() => setFlowDir('out')}>Outbound</button>
          </span>
          <label className="small" style={dim} title={dt}>Top routes&nbsp;
            <select value={flowTop} disabled={!arcsOn} onChange={(e) => setFlowTop(Number(e.target.value))}>
              {[5, 10, 20, 30, 50].map((n) => <option key={n} value={n}>Top {n}</option>)}
            </select>
          </label>
          </>
          ); })()}
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
          {/* (c) IRONMAN vs non-IRONMAN destination filter — applies to shading, arcs, routes and the summary card. */}
          <span className="small muted">Destinations</span>
          <span style={{ display: 'inline-flex', gap: 4 }} title={imAvailable ? 'Filter flows by whether the destination event is an IRONMAN race' : 'Reload the flows data (Refresh data) to enable the IRONMAN split'}>
            <button style={mini(flowIM === 'all')} disabled={!imAvailable} onClick={() => setFlowIM('all')}>All</button>
            <button style={mini(flowIM === 'im')} disabled={!imAvailable} onClick={() => setFlowIM('im')}>IRONMAN</button>
            <button style={mini(flowIM === 'nonim')} disabled={!imAvailable} onClick={() => setFlowIM('nonim')}>Non-IM</button>
          </span>
          {!imAvailable ? <span className="small muted" style={{ fontStyle: 'italic' }}>needs data refresh</span> : null}
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 6px' }} />
          <button style={mini(flowSpin)} title="Auto-rotate the 3D view" onClick={() => setFlowSpin((s) => !s)}>⟳ Rotate</button>
          <button style={mini(false)} title="Reset the 3D camera" onClick={() => { flowViewRef.current = { ...FLOW_VIEW0 }; if (deckInst.current) deckInst.current.setProps({ viewState: flowViewRef.current }); }}>Reset view</button>
        </div>
      ) : null}
      {showFlows && flowIMSummary ? (
        <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap' }}>
          {(() => {
            const { total, im, nonim } = flowIMSummary;
            const pct = (n) => (total ? Math.round((100 * n) / total) : 0);
            const card = (label, val, sub, active, on, color) => (
              <button onClick={on} title={'Filter the map to ' + label}
                style={{ flex: '1 1 150px', minWidth: 140, textAlign: 'left', cursor: 'pointer', padding: '8px 12px',
                  border: '1px solid ' + (active ? color : 'var(--line)'), borderLeft: '4px solid ' + color, borderRadius: 8,
                  background: active ? (dark ? 'rgba(148,163,184,.14)' : 'rgba(15,23,42,.04)') : 'var(--panel)', color: 'var(--ink)' }}>
                <div className="small muted" style={{ fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{val.toLocaleString()}</div>
                <div className="small muted">{sub}</div>
              </button>
            );
            return (
              <>
                {card('All cross-state travelers', total, 'home ≠ event, this selection', flowIM === 'all', () => setFlowIM('all'), '#334155')}
                {card('IRONMAN destinations', im, pct(im) + '% of travelers', flowIM === 'im', () => setFlowIM('im'), '#C20E2F')}
                {card('Non-IRONMAN destinations', nonim, pct(nonim) + '% of travelers', flowIM === 'nonim', () => setFlowIM('nonim'), '#185FA5')}
              </>
            );
          })()}
        </div>
      ) : null}

      {/* Display options + actions (Refresh / zoom / reset / CSV / PNG / fullscreen) moved to the top global row. */}

      {advOpen && !showRegions ? (
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

      <div style={oppView ? { display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' } : { display: 'contents' }}>
      <div className="card" ref={cardRef} style={{ position: 'relative', ...(oppView ? { flex: '1 1 460px', minWidth: 360, marginBottom: 0 } : {}) }}>
        <div ref={mapRef} className="mapdiv" style={{ visibility: showFlows ? 'hidden' : 'visible' }} />
        <div ref={deckRef} style={{ position: 'absolute', inset: 0, height: 560, visibility: showFlows ? 'visible' : 'hidden', borderRadius: 10, overflow: 'hidden' }} />
        {((!showFlows && (metricIdx in UNIQ_IDX) && (fillMode === 'yoy' ? yoyUniqLoading : uniqLoading)) || (showFlows && flowLoading)) ? (
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 5, pointerEvents: 'none' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--panel)', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 999, fontSize: 11, fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,.14)' }}>
              <span className="mapspin" />{showFlows ? 'Loading…' : 'Counting…'}
            </span>
          </div>
        ) : null}
        {(mapBusy || (oppView && homeLoading)) && !showFlows ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', borderRadius: 10, zIndex: 6, pointerEvents: 'none' }}>
            <span className="mapspin" style={{ width: 22, height: 22, borderWidth: 3 }} />
            {oppView && homeLoading ? <span className="small muted">Loading penetration data…</span> : null}
          </div>
        ) : null}
        {showFlows && !flowLoading ? (
          <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 4, pointerEvents: 'none', background: dark ? 'rgba(11,18,32,.86)' : 'rgba(255,255,255,.92)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontSize: 11, lineHeight: 1.55, color: 'var(--ink)', boxShadow: '0 4px 14px rgba(0,0,0,.20)', maxWidth: 232 }}>
            <button
              onClick={() => setFlowKeyOpen((o) => !o)}
              title={flowKeyOpen ? 'Collapse the key' : 'Expand the key'}
              style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: 0, margin: 0, border: 'none', background: 'transparent', color: 'var(--ink)', font: 'inherit', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ fontSize: 9, opacity: 0.7 }}>{flowKeyOpen ? '▾' : '▸'}</span> Flow key
            </button>
            {flowKeyOpen ? (
              <div style={{ marginTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 46, height: 9, borderRadius: 2, border: '1px solid var(--line)', background: 'linear-gradient(90deg,#185FA5,' + (dark ? '#334155' : '#f1f5f9') + ',#C20E2F)' }} />
                  <span>State shade = net flow</span>
                </div>
                <div style={{ marginTop: 2 }}>
                  <span style={{ color: '#185FA5', fontWeight: 700 }}>■</span> net feeder (sends out) &nbsp;
                  <span style={{ color: '#C20E2F', fontWeight: 700 }}>■</span> net destination (draws in)
                </div>
                <div style={{ marginTop: 4 }}>
                  Arcs (when a state is focused):<br />
                  <span style={{ color: '#C20E2F', fontWeight: 700 }}>—</span> inbound (races here) &nbsp;
                  <span style={{ color: '#185FA5', fontWeight: 700 }}>—</span> outbound (races away)
                </div>
                <div style={{ marginTop: 4 }}>
                  <span style={{ color: '#D4920A', fontWeight: 700 }}>▬</span> gold outline / <span style={{ color: '#D4920A', fontWeight: 700 }}>①</span> badge = top-ranked route
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {oppView ? (
          <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 4, background: dark ? 'rgba(11,18,32,.9)' : 'rgba(255,255,255,.95)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink)', boxShadow: '0 4px 14px rgba(0,0,0,.20)' }}>
            <button onClick={() => setOppKeyOpen((o) => !o)} title={oppKeyOpen ? 'Collapse the key' : 'Expand the key'}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: 0, border: 'none', background: 'transparent', color: 'var(--ink)', font: 'inherit', fontWeight: 700, cursor: 'pointer', textAlign: 'left', marginBottom: oppKeyOpen ? 3 : 0 }}>
              <span style={{ fontSize: 9, opacity: 0.7 }}>{oppKeyOpen ? '▾' : '▸'}</span>
              <span>{oppData && oppData.basisIn ? 'In-state' : 'All-states'} penetration / 1k{oppData ? ' · nat’l ' + oppData.dNational : ''}<span style={{ fontWeight: 400, opacity: 0.75 }}>{oppData ? (oppData.mode === 'rel' ? ' · national-relative' : oppData.mode === 'stat' ? (' · ' + (oppData.stat && oppData.stat.method === 'sigma' ? 'mean ± ' + oppData.stat.k + 'σ' : 'quantile')) : ' · absolute') : ''}</span></span>
            </button>
            {oppKeyOpen ? OPP_ORDER.map((b) => {
              if (oppData && oppData.relMode && b === 'mid') return null;   // On-par is empty when Leader = national
              const lc = oppData ? oppData.leaderCut : oppLeaderCut, fc = oppData ? oppData.floorCut : oppFloorCut;
              const sub = b === 'leader' ? (oppData && oppData.relMode ? ' ≥ national' : ' ≥ ' + lc.toFixed(2))
                : b === 'floor' ? (oppData && oppData.relMode ? ' ≤ ½ national (' + fc.toFixed(2) + ')' : ' ≤ ' + fc.toFixed(2))
                : b === 'under' ? (oppData && oppData.relMode ? ' below national' : '') : '';
              return (
                <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: OPP_C[b], display: 'inline-block' }} />
                  <span>{OPP_LABEL[b]}{sub}{oppData ? ' · ' + oppData.counts[b] : ''}</span>
                </div>
              );
            }) : null}
          </div>
        ) : null}
      </div>
      {oppView ? (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flex: oppCardOpen ? '0 1 360px' : '0 0 auto', minWidth: oppCardOpen ? 300 : 'auto' }}>
          {oppCardOpen ? <OppCard row={oppData ? oppData.rows.find((r) => r.ab === oppSel) : null} opp={oppData} /> : null}
          <button onClick={() => setOppCardOpen((o) => !o)}
            title={oppCardOpen ? 'Collapse the state card — enlarge the map' : 'Show the state card'}
            style={{ flex: '0 0 26px', alignSelf: 'stretch', border: '1px solid var(--line)', borderLeft: oppCardOpen ? 'none' : '1px solid var(--line)', borderRadius: oppCardOpen ? '0 10px 10px 0' : 10, background: 'var(--panel)', color: 'var(--muted)', cursor: 'pointer', writingMode: 'vertical-rl', fontSize: 11.5, fontWeight: 700, letterSpacing: '.03em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0' }}>
            <span style={{ fontSize: 13 }}>{oppCardOpen ? '⏵' : '⏴'}</span>{oppCardOpen ? 'collapse' : 'state card'}
          </button>
        </div>
      ) : null}
      </div>
      {oppView ? (
        <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          {selYears && selYears.length > 1 ? <div className="small" style={{ flexBasis: '100%', color: '#854F0B', background: 'rgba(224,160,48,.12)', border: '1px solid rgba(224,160,48,.45)', borderRadius: 6, padding: '5px 9px' }}>⚠ Penetration is only exact for a single year — {selYears.length} years are selected, so /1k and headroom sum the numerator against one-year population. Pick a single year for accurate rates.</div> : null}
          <span className="small muted" style={{ fontWeight: 700 }}>Map</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button style={mini(oppBasis === 'all')} title="Colour the map + bands by all-states penetration — residents of each state racing anywhere (home or away)." onClick={() => setOppBasis('all')}>All-states</button>
            <button style={mini(oppBasis === 'in')} title="Colour the map + bands by in-state penetration — race participations held in each state (includes out-of-state visitors)." onClick={() => setOppBasis('in')}>In-state</button>
          </span>
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 4px' }} />
          <span className="small muted" style={{ fontWeight: 700 }}>Age</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button style={mini(oppAgeGroup === 'adult')} title="Adults 20+ — resident athletes aged 20 and up, over adult population." onClick={() => setOppAgeGroup('adult')}>Adult</button>
            <button style={mini(oppAgeGroup === 'youth')} title="Youth 4–19 — resident athletes aged 4 to 19, over youth (under-20) population." onClick={() => setOppAgeGroup('youth')}>Youth</button>
          </span>
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 4px' }} />
          <span className="small muted" style={{ fontWeight: 700 }}>Bands</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button style={mini(oppBandMode === 'rel')} title="Leader ≥ the national rate · Lagging ≤ half the national rate — adapts to the current selection" onClick={() => setOppBandMode('rel')}>National-relative</button>
            <button style={mini(oppBandMode === 'stat')} title="Cutoffs from the distribution of state penetration values (quantiles or mean ± σ)" onClick={() => setOppBandMode('stat')}>Statistical</button>
            <button style={mini(oppBandMode === 'abs')} title="Fixed absolute cutoffs you set" onClick={() => setOppBandMode('abs')}>Absolute</button>
          </span>
          {oppBandMode === 'abs' ? (
            <>
              <label className="small">Leader ≥&nbsp;
                <input type="number" step="0.01" min="0" value={oppLeaderCut} onChange={(e) => setOppLeaderCut(Math.max(0, parseFloat(e.target.value) || 0))} style={{ width: 66 }} />
              </label>
              <label className="small">Lagging ≤&nbsp;
                <input type="number" step="0.01" min="0" value={oppFloorCut} onChange={(e) => setOppFloorCut(Math.max(0, parseFloat(e.target.value) || 0))} style={{ width: 66 }} />
              </label>
            </>
          ) : oppBandMode === 'stat' ? (
            <>
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <button style={mini(oppStatMethod === 'quantile')} title="Leader = top 20% · Lagging = bottom 20% · On-par/Under-penetrated split at the median" onClick={() => setOppStatMethod('quantile')}>Quantile</button>
                <button style={mini(oppStatMethod === 'sigma')} title="Leader ≥ mean + σ · Lagging ≤ mean − σ · On-par/Under-penetrated split at the mean" onClick={() => setOppStatMethod('sigma')}>Std-dev</button>
              </span>
              {oppStatMethod === 'sigma' ? (
                <label className="small">σ×&nbsp;
                  <select value={oppSigmaK} onChange={(e) => setOppSigmaK(parseFloat(e.target.value))}>
                    <option value={0.5}>0.5</option><option value={1}>1.0</option><option value={1.5}>1.5</option>
                  </select>
                </label>
              ) : null}
              <span className="small muted">{oppData ? (oppData.stat && oppData.stat.method === 'sigma'
                ? 'μ ' + oppData.stat.mean + ' · σ ' + oppData.stat.sd + ' → Leader ≥ ' + oppData.leaderCut.toFixed(2) + ' · Lagging ≤ ' + oppData.floorCut.toFixed(2)
                : 'p20 ' + oppData.floorCut.toFixed(2) + ' · median ' + oppData.midCut.toFixed(2) + ' · p80 ' + oppData.leaderCut.toFixed(2)) : '—'}</span>
            </>
          ) : (
            <span className="small muted">Leader ≥ {oppData ? oppData.leaderCut.toFixed(2) : '—'} · Lagging ≤ {oppData ? oppData.floorCut.toFixed(2) : '—'} (nat’l {oppData ? oppData.dNational : '—'})</span>
          )}
          <span style={{ width: 0, borderLeft: '2px solid var(--line)', alignSelf: 'stretch', margin: '0 4px' }} />
          <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={oppValues} onChange={(e) => setOppValues(e.target.checked)} /> Show values on map
          </label>
        </div>
      ) : null}
      {oppView && oppData ? <div className="small muted" style={{ marginTop: 6 }}>Full ranking with sortable columns + CSV is in the <b>Opportunity</b> tab below.</div> : null}
      {showRegions ? (
        <div className="toolbar" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
          <span className="small muted" style={{ fontWeight: 700 }}>Regions:</span>
          {(st.p ? st.p.regOrder : []).map((rg, i) => (
            <span key={rg} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: REGION_PALETTE[i % REGION_PALETTE.length], opacity: 0.75, display: 'inline-block', border: '1px solid var(--line)' }} />
              {rg}
            </span>
          ))}
          <span className="small muted" style={{ marginLeft: 6 }}>Reference map — regions by state (not affected by year / month).</span>
        </div>
      ) : null}
      {showFlows ? <p className="muted small" style={{ margin: '8px 2px 0' }}>{flowStat}</p> : null}
      {showFlows && flowNetStats && !flowFocus ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          {[['dest', '#C20E2F', 'Top net destinations — draw racers in', '+'],
            ['feed', '#185FA5', 'Top net feeders — send racers out', '']].map(([key, color, title]) => (
            <div key={key} style={{ flex: '1 1 260px', minWidth: 240 }}>
              <div className="small" style={{ fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span><span style={{ color }}>●</span> {title}</span>
                <button style={mini(false)} title="Download net flow by state (CSV)"
                  onClick={() => downloadCSV('flows_net_' + key + '_' + flowIM + '.csv', ['Rank', 'State', 'In', 'Out', 'Net'],
                    flowNetStats[key].map((r, i) => [i + 1, r.name, r.inb, r.outb, r.net]))}>CSV</button>
              </div>
              <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                {flowNetStats[key].length ? flowNetStats[key].map((r, i) => (
                  <div key={r.ab} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 10px', fontSize: 12, borderBottom: '1px solid var(--line)' }}>
                    <span>{i + 1}. {r.name} <span className="muted">({r.inb.toLocaleString()} in · {r.outb.toLocaleString()} out)</span></span>
                    <b style={{ color }}>{r.net > 0 ? '+' : ''}{r.net.toLocaleString()}</b>
                  </div>
                )) : <div className="muted small" style={{ padding: '6px 10px' }}>None</div>}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {showFlows && flowRoutes ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          {flowDir !== 'out' ? (
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <div className="small" style={{ fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span><span style={{ color: '#C20E2F' }}>●</span> Top inbound — who races in {flowRoutes.focusName}</span>
                <button style={mini(false)} title="Download inbound routes (CSV)" onClick={() => downloadCSV('flows_inbound_' + (flowFocus || 'state') + '.csv', ['Rank', 'State', 'Athletes', 'State total in', 'State total out'], flowRoutes.inb.map(([n, c, pin, pout], i) => [i + 1, n, c, pin, pout]))}>CSV</button>
              </div>
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                {flowRoutes.inb.length ? flowRoutes.inb.map(([n, c, pin, pout], i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 10px', fontSize: 12, borderBottom: '1px solid var(--line)' }}><span>{i + 1}. {n} <span className="muted">({pin.toLocaleString()} in · {pout.toLocaleString()} out)</span></span><b>{c.toLocaleString()}</b></div>
                )) : <div className="muted small" style={{ padding: '6px 10px' }}>None</div>}
              </div>
            </div>
          ) : null}
          {flowDir !== 'in' ? (
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <div className="small" style={{ fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span><span style={{ color: '#185FA5' }}>●</span> Top outbound — where {flowRoutes.focusName} races</span>
                <button style={mini(false)} title="Download outbound routes (CSV)" onClick={() => downloadCSV('flows_outbound_' + (flowFocus || 'state') + '.csv', ['Rank', 'State', 'Athletes', 'State total in', 'State total out'], flowRoutes.outb.map(([n, c, pin, pout], i) => [i + 1, n, c, pin, pout]))}>CSV</button>
              </div>
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                {flowRoutes.outb.length ? flowRoutes.outb.map(([n, c, pin, pout], i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 10px', fontSize: 12, borderBottom: '1px solid var(--line)' }}><span>{i + 1}. {n} <span className="muted">({pin.toLocaleString()} in · {pout.toLocaleString()} out)</span></span><b>{c.toLocaleString()}</b></div>
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
          oppData={oppData} oppSel={oppSel} onOppSelect={onOppSelect} oppView={oppView}
          oppAgeGroup={oppAgeGroup} setOppAgeGroup={setOppAgeGroup} oppBasis={oppBasis}
        />
      ) : <div className="muted small" style={{ padding: 16, marginTop: 16 }}>Loading tables…</div>}
    </div>
  );
}

function Kpi({ v, l, t }) {
  return <div className="kpi" title={t || undefined} style={t ? { cursor: 'help' } : undefined}><div className="v">{v}</div><div className="l">{l}{t ? ' ⓘ' : ''}</div></div>;
}

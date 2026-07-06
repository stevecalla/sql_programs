import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { resolveSlices, aggregateFlows, homeByState } from '../lib/compute.js';
import Reference from './Reference.jsx';

// Native port of the POC's lower tabs: Summary (region stats + Top-N cards), Region matrix, State matrix
// (sortable home->event cross-tabs with frozen totals, net importer/exporter shading, crosshair highlight),
// State flows, and the Events table (search / region+IM filter / sanction-col toggle / sortable / frozen
// id columns / state cross-filter from the map / CSV). Shares selection + stateSel/regionSel with the map.

const MON3 = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REGN = ['Northeast', 'Southeast', 'Midwest', 'Central', 'Rockies', 'Pacific'];
const EV_PAGE = 100; // events table page size (paginated for responsiveness); CSV exports everything
const commafy = (x) => (x == null || x === '') ? '' : Number(x).toLocaleString();
const pctify = (x) => (x == null || x === '') ? '' : x + '%';
const CNT = ['Participants', 'Races', 'Female n', 'Male n', 'Home', 'Away', 'Unknown', 'New', 'Repeat', 'Unique'];
function colType(nm) {
  if (/%$/.test(nm)) return 'pct';
  if (CNT.indexOf(nm) >= 0) return 'cnt';
  if (nm === 'Per race' || nm === 'Adult/race' || nm === 'Per participant') return 'int';
  return 'text';
}
function fmtDate(v) {
  if (!v) return '';
  const s = String(v); const y = +s.substr(0, 4), m = +s.substr(5, 2), d = +s.substr(8, 2);
  const dow = DOW3[new Date(y, m - 1, d).getDay()] || '';
  return dow + ' ' + (MON3[m] || '') + ' ' + d + ', ' + y;
}
function downloadCSV(fname, header, rows) {
  const esc = (v) => { v = (v == null) ? '' : ('' + v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = header.map(esc).join(',') + '\n' + rows.map((r) => r.map(esc).join(',')).join('\n');
  const b = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = fname; a.click();
}
function lerp(t, c) { t = Math.max(0, Math.min(1, t)); return 'rgb(' + Math.round(255 + (c[0] - 255) * t) + ',' + Math.round(255 + (c[1] - 255) * t) + ',' + Math.round(255 + (c[2] - 255) * t) + ')'; }

function recompute(entities, Mx) {
  const rowTot = {}, colTot = {}, net = {}; let maxNet = 0;
  entities.forEach((x) => { rowTot[x] = 0; colTot[x] = 0; });
  entities.forEach((h) => entities.forEach((e) => { rowTot[h] += Mx[h][e]; colTot[e] += Mx[h][e]; }));
  entities.forEach((x) => { net[x] = colTot[x] - rowTot[x]; if (Math.abs(net[x]) > maxNet) maxNet = Math.abs(net[x]); });
  const travOut = {}, travIn = {}; entities.forEach((x) => { travOut[x] = rowTot[x] - (Mx[x][x] || 0); travIn[x] = colTot[x] - (Mx[x][x] || 0); });
  let maxv = 0; entities.forEach((h) => entities.forEach((e) => { if (h !== e && Mx[h][e] > maxv) maxv = Mx[h][e]; }));
  let grandTrav = 0; entities.forEach((x) => { grandTrav += travOut[x]; });
  return { Mx, rowTot, colTot, net, maxNet, travOut, travIn, maxv, grandTrav };
}
function emptyMx(entities) { const Mx = {}; entities.forEach((h) => { Mx[h] = {}; entities.forEach((e) => { Mx[h][e] = 0; }); }); return Mx; }
function buildStateMatrix(ABB, flows, HB) {
  const Mx = emptyMx(ABB);
  flows.forEach((r) => { if (Mx[r[0]] && Mx[r[0]][r[1]] !== undefined) Mx[r[0]][r[1]] += r[2]; });
  ABB.forEach((h) => { Mx[h][h] += (HB[h] || 0); });
  return recompute(ABB, Mx);
}
function buildRegionMatrix(REG, flows, HB, ab2region, abbr) {
  const Mx = emptyMx(REG);
  flows.forEach((r) => { const h = ab2region[r[0]], e = ab2region[r[1]]; if (Mx[h] && Mx[h][e] !== undefined) Mx[h][e] += r[2]; });
  abbr.forEach((ab) => { const rg = ab2region[ab]; if (Mx[rg]) Mx[rg][rg] += (HB[ab] || 0); });
  const d = recompute(REG, Mx);
  const inReg = {}; REG.forEach((x) => { inReg[x] = 0; });
  abbr.forEach((ab) => { const rg = ab2region[ab]; if (inReg[rg] !== undefined) inReg[rg] += (HB[ab] || 0); });
  d.travOutS = {}; d.travInS = {}; d.grandRegion = 0; d.grandState = 0;
  REG.forEach((x) => { d.travOutS[x] = d.rowTot[x] - inReg[x]; d.travInS[x] = d.colTot[x] - inReg[x]; d.grandRegion += d.travOut[x]; d.grandState += d.travOutS[x]; });
  return d;
}

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'regionmtx', label: 'Region matrix' },
  { key: 'statemtx', label: 'State matrix' },
  { key: 'stateflows', label: 'State flows' },
  { key: 'events', label: 'Events' },
  { key: 'reference', label: 'Reference' },
];
const seg = { padding: '4px 12px', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'inherit', fontSize: 13 };

// Sortable home->event matrix with frozen totals + crosshair. travCols: right total columns {key,label,vals}.
// bottomRows: {label, key?, vals, grand?:{colKey,value}}. narrative: text block. csvName: file base.
function MatrixTable({ entities, data, travCols, bottomRows, narrative, csvName, rowHdrW, colMinW, fill, fsBtn }) {
  const [sort, setSort] = useState({ row: null, rdir: -1, col: null, cdir: -1 });
  const [hover, setHover] = useState({ r: null, c: null });
  const { Mx, rowTot, colTot, net, maxNet, maxv } = data;
  const W = 78, HW = rowHdrW || 90;
  const rightCols = [{ key: 'Out', label: 'By its athletes', vals: rowTot }].concat(travCols).concat([{ key: 'Net', label: 'Net ±', net: true }]);
  const RC = rightCols.length;
  const rowVal = (x, key) => { if (key === 'Net') return net[x]; if (key === 'Out') return rowTot[x]; const tc = travCols.find((c) => c.key === key); if (tc) return tc.vals[x]; return Mx[x][key]; };
  const rowOrder = sort.row ? entities.slice().sort((a, b) => sort.row === '__' ? a.localeCompare(b) * sort.rdir : (rowVal(a, sort.row) - rowVal(b, sort.row)) * sort.rdir) : entities.slice();
  const colOrder = sort.col ? entities.slice().sort((a, b) => sort.col === '__' ? a.localeCompare(b) * sort.cdir : (sort.col === 'In' ? (colTot[a] - colTot[b]) : (Mx[sort.col][a] - Mx[sort.col][b])) * sort.cdir) : entities.slice();
  const ra = (k) => (sort.row === k ? (sort.rdir > 0 ? ' ▲' : ' ▼') : '');
  const ca = (k) => (sort.col === k ? (sort.cdir > 0 ? ' ▲' : ' ▼') : '');
  const sortRow = (k) => setSort((s) => ({ ...s, row: k, rdir: s.row === k ? -s.rdir : -1 }));
  const sortCol = (k) => setSort((s) => ({ ...s, col: k, cdir: s.col === k ? -s.cdir : -1 }));
  const sortBoth = () => setSort((s) => { const d = (s.row === '__' && s.col === '__') ? -s.rdir : 1; return { row: '__', rdir: d, col: '__', cdir: d }; });
  const reset = () => setSort({ row: null, rdir: -1, col: null, cdir: -1 });

  const base = { border: '1px solid var(--line)', padding: '3px 6px', whiteSpace: 'nowrap' };
  const hdr = { ...base, textAlign: 'center', cursor: 'pointer', background: 'var(--bg)', color: 'var(--ink)', fontWeight: 700 };
  const hi = (h, e) => (hover.r === h || hover.c === e);
  const cellStyle = (h, e) => {
    const v = Mx[h][e], diag = (h === e), t = maxv ? Math.min(1, v / maxv) : 0;
    let s = { ...base, textAlign: 'center', minWidth: colMinW };
    if (v) { if (diag) s.background = 'rgba(100,116,139,0.28)'; else { s.background = 'rgba(194,14,47,' + (0.08 + 0.72 * t).toFixed(3) + ')'; s.color = t > 0.55 ? '#fff' : 'var(--ink)'; } }
    if (hi(h, e)) s.boxShadow = 'inset 0 0 0 9999px rgba(37,99,235,0.14)';
    return s;
  };
  const netStyle = (nv) => {
    const nt = maxNet ? Math.abs(nv) / maxNet : 0;
    if (!nv) return { ...base, textAlign: 'center', minWidth: W, background: 'var(--panel)' };
    const L = 70 - 38 * nt; // solid, darker with magnitude — readable in both themes
    return { ...base, textAlign: 'center', minWidth: W, background: 'hsl(' + (nv > 0 ? 145 : 2) + ',' + (nv > 0 ? 55 : 68) + '%,' + L + '%)', color: L > 52 ? '#0f172a' : '#fff', fontWeight: 700 };
  };
  const rightPx = (i) => (RC - 1 - i) * W;
  const totHdr = (i) => ({ ...hdr, position: 'sticky', right: rightPx(i), zIndex: 4, minWidth: W });
  const totCell = (i) => ({ ...base, textAlign: 'center', position: 'sticky', right: rightPx(i), zIndex: 2, minWidth: W, background: 'var(--panel)', fontWeight: 700 });

  const doCSV = () => {
    const header = ['Home/Event'].concat(entities).concat(rightCols.map((c) => c.label));
    const rows = entities.map((h) => [h].concat(entities.map((e) => Mx[h][e])).concat([rowTot[h]]).concat(travCols.map((c) => c.vals[h])).concat([net[h]]));
    bottomRows.forEach((br) => rows.push([br.label].concat(entities.map((e) => (br.vals[e] || ''))).concat(rightCols.map(() => ''))));
    downloadCSV(csvName + '.csv', header, rows);
  };

  return (
    <div>
      {narrative ? <p className="muted small" style={{ margin: '0 0 8px', lineHeight: 1.5 }}>{narrative}</p> : null}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button style={seg} onClick={reset}>Reset</button>
        <button style={seg} onClick={doCSV}>CSV</button>
        {fsBtn || null}
      </div>
      <div style={{ overflow: 'auto', maxHeight: 560, border: '1px solid var(--line)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: fill ? '100%' : undefined }}>
          <thead>
            <tr>
              <th style={{ ...hdr, textAlign: 'left', position: 'sticky', left: 0, top: 0, zIndex: 6, minWidth: HW }} onClick={sortBoth}>Home ↓ / Event →{(sort.row === '__' || sort.col === '__') ? (sort.rdir > 0 ? ' ▲' : ' ▼') : ''}</th>
              {colOrder.map((e) => <th key={e} style={{ ...hdr, position: 'sticky', top: 0, zIndex: 3, minWidth: colMinW }} onClick={() => sortRow(e)} onMouseEnter={() => setHover({ r: null, c: e })}>{e}{ra(e)}</th>)}
              {rightCols.map((c, i) => <th key={c.key} style={{ ...totHdr(i), top: 0 }} onClick={() => sortRow(c.key)}>{c.label}{ra(c.key)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowOrder.map((h) => (
              <tr key={h}>
                <td style={{ ...hdr, textAlign: 'left', position: 'sticky', left: 0, zIndex: 2, minWidth: HW }} onClick={() => sortCol(h)} onMouseEnter={() => setHover({ r: h, c: null })}>{h}{ca(h)}</td>
                {colOrder.map((e) => <td key={e} style={cellStyle(h, e)} title={h + ' athletes racing in ' + e + (h === e ? ' (their own)' : '') + ': ' + Mx[h][e].toLocaleString()} onMouseEnter={() => setHover({ r: h, c: e })}>{Mx[h][e] ? Mx[h][e].toLocaleString() : ''}</td>)}
                <td style={totCell(0)}>{rowTot[h].toLocaleString()}</td>
                {travCols.map((c, ti) => <td key={c.key} style={totCell(ti + 1)}>{(c.vals[h] || 0).toLocaleString()}</td>)}
                <td style={{ ...netStyle(net[h]), position: 'sticky', right: 0, zIndex: 2, minWidth: W }}>{(net[h] > 0 ? '+' : '') + net[h].toLocaleString()}</td>
              </tr>
            ))}
            {bottomRows.map((br, bi) => (
              <tr key={bi}>
                <td style={{ ...hdr, textAlign: 'left', position: 'sticky', left: 0, bottom: (bottomRows.length - 1 - bi) * 26, zIndex: 5, minWidth: HW }} onClick={() => br.key ? sortCol(br.key) : null}>{br.label}{br.key ? ca(br.key) : ''}</td>
                {colOrder.map((e) => <td key={e} style={{ ...base, textAlign: 'center', position: 'sticky', bottom: (bottomRows.length - 1 - bi) * 26, zIndex: 3, background: 'var(--panel)', fontWeight: 700 }}>{(br.vals[e] || 0).toLocaleString()}</td>)}
                {rightCols.map((c, i) => <td key={c.key} style={{ ...totCell(i), bottom: (bottomRows.length - 1 - bi) * 26, zIndex: 4 }}>{br.grand && br.grand.colKey === c.key ? br.grand.value.toLocaleString() : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParticipationTabs({ p, yb, selYears, selMonths, period, dark, stateSel, setStateSel, regionSel, setRegionSel }) {
  const imRow = dark ? 'rgba(220,38,38,0.20)' : 'rgba(194,14,47,0.06)';
  const imFrozen = dark ? '#3a1e24' : '#fbe9ec';
  const rowHL = dark ? '#26364d' : '#eef2ff';
  const [tab, setTab] = useState('events');
  const [imSel, setImSel] = useState('');
  const [searchTxt, setSearchTxt] = useState('');
  const [showSanc, setShowSanc] = useState(false);
  const [sortEc, setSortEc] = useState(-1);
  const [sortDir, setSortDir] = useState(1);
  const [evPage, setEvPage] = useState(0);
  const firstState = p.abbr.slice().sort((a, b) => (p.names[p.abbr.indexOf(a)] < p.names[p.abbr.indexOf(b)] ? -1 : 1))[0];
  const [sfState, setSfState] = useState(firstState);
  const [sfSort, setSfSort] = useState(3);
  const [sfDir, setSfDir] = useState(-1);
  const evFsRef = useRef(null); const mxFsRef = useRef(null); const smFsRef = useRef(null);
  const [evFull, setEvFull] = useState(false); const [mxFull, setMxFull] = useState(false); const [smFull, setSmFull] = useState(false);
  useEffect(() => {
    const onFs = () => { setEvFull(document.fullscreenElement === evFsRef.current); setMxFull(document.fullscreenElement === mxFsRef.current); setSmFull(document.fullscreenElement === smFsRef.current); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const fsToggle = (ref) => { if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen(); else if (ref.current && ref.current.requestFullscreen) ref.current.requestFullscreen(); };
  const toggleEvFs = () => fsToggle(evFsRef);
  const fsWrap = (full) => (full ? { background: dark ? '#0b1220' : '#ffffff', padding: 16, height: '100vh', overflow: 'auto', boxSizing: 'border-box' } : undefined);

  const COLS = p.evcols;
  // Only build the heavy flow/matrix structures for the tab that needs them (default tab is Events).
  const needFlow = tab === 'stateflows' || tab === 'regionmtx' || tab === 'statemtx';
  const needMx = tab === 'regionmtx' || tab === 'statemtx';
  const keys = useMemo(() => resolveSlices(selYears, selMonths, p.monthsByYear), [selYears, selMonths, p]);
  const flowAgg = useMemo(() => (needFlow ? aggregateFlows(keys, p.odByYM) : { flows: [], inb: {}, outb: {} }), [needFlow, keys, p]);
  const HB = useMemo(() => (needMx ? homeByState(keys, p.rawByYM) : {}), [needMx, keys, p]);
  const EV = useMemo(() => { let a = []; (selYears || []).forEach((y) => { a = a.concat(p.eventsByYear[y] || []); }); return a; }, [selYears, p]);
  const stateMx = useMemo(() => (tab === 'statemtx' ? buildStateMatrix(p.abbr, flowAgg.flows, HB) : null), [tab, p, flowAgg, HB]);
  const regionMx = useMemo(() => (tab === 'regionmtx' ? buildRegionMatrix(REGN, flowAgg.flows, HB, p.ab2region, p.abbr) : null), [tab, p, flowAgg, HB]);
  // Summary KPI cards (POC "Summary totals" scorecards): national totals for the selected period.
  const sumKpis = useMemo(() => {
    if (tab !== 'summary' || !yb || !yb.metrics) return null;
    const sA = (a) => (a || []).reduce((t, v) => t + (Number(v) || 0), 0);
    const mx = yb.metrics; const g = (i) => sA(mx[i] ? mx[i].statez : []);
    const T = g(0), E = g(1), R = g(2), FN = g(9), MN = g(10), H = g(23), A = g(24), IM = g(27), NW = g(29), RP = g(30), UNK = g(36);
    const uniq = yb.nat ? (yb.nat.uniq || 0) : 0, part = yb.nat ? (yb.nat.part || T) : T;
    return [
      ['Participants', T.toLocaleString(), 'Count of participation records (event starts) in the period. One athlete racing 3 times counts as 3.'],
      ['Unique' + (yb.approxUniq ? ' ~' : ''), uniq.toLocaleString(), 'Distinct athletes (deduplicated). The ~ appears when several periods are combined and this is summed per period.'],
      ['% unique', part ? Math.round(100 * uniq / part) + '%' : '-', 'Unique participants ÷ Participants.'],
      ['Races/participant', uniq ? (part / uniq).toFixed(1) : '-', 'Participants ÷ Unique — average races per athlete.'],
      ['Events', E.toLocaleString(), 'Distinct events in the period.'],
      ['Races', R.toLocaleString(), 'Distinct races (an event can contain multiple races).'],
      ['Per race', R ? Math.round(T / R) : '-', 'Participants ÷ Races — average field size.'],
      ['Female', (FN + MN) ? Math.round(100 * FN / (FN + MN)) + '%' : '-', 'Female ÷ (Female + Male) participations.'],
      ['IRONMAN', T ? Math.round(100 * IM / T) + '%' : '-', 'IRONMAN participations ÷ all participations.'],
      ['Home', (H + A) ? Math.round(100 * H / (H + A)) + '%' : '-', 'In-state ÷ (in-state + away, excludes unknown) — share racing in their home state.'],
      ['Traveled away', A.toLocaleString(), 'Participations where home state is one of the 50 and ≠ event state (cross-state travel).'],
      ['Unknown home', UNK.toLocaleString(), 'Home state missing or not one of the 50 states — excluded from home/away. Reconciles: home + away + unknown = participants.'],
      ['Unknown home %', T ? Math.round(100 * UNK / T) + '%' : '-', 'Unknown home ÷ Participants.'],
      ['New', T ? Math.round(100 * NW / T) + '%' : '-', 'First-time athletes ÷ Participants.'],
      ['Repeat', T ? Math.round(100 * RP / T) + '%' : '-', 'Returning athletes ÷ Participants.'],
    ];
  }, [tab, yb]);

  // ---- Events ----
  const filtered = useMemo(() => {
    let d = EV.slice();
    if (selMonths.indexOf('all') < 0) d = d.filter((r) => r[4] && selMonths.indexOf(String(parseInt(('' + r[4]).substr(5, 2), 10))) >= 0);
    if (regionSel) d = d.filter((r) => r[1] === regionSel);
    if (stateSel) d = d.filter((r) => r[0] === stateSel);
    if (imSel) d = d.filter((r) => r[5] === imSel);
    if (searchTxt) { const q = searchTxt.toLowerCase(); d = d.filter((r) => r.some((c) => ('' + (c == null ? '' : c)).toLowerCase().indexOf(q) >= 0)); }
    if (sortEc >= 0) d = d.slice().sort((a, b) => { let x = a[sortEc], y = b[sortEc]; if (typeof x === 'number' && typeof y === 'number') return (x - y) * sortDir; if (x == null) x = ''; if (y == null) y = ''; return ('' + x).localeCompare('' + y) * sortDir; });
    return d;
  }, [EV, selMonths, regionSel, stateSel, imSel, searchTxt, sortEc, sortDir]);
  const visCols = useMemo(() => { const a = []; for (let i = 0; i < COLS.length; i++) { if ((i === 3 || i === 4) && !showSanc) continue; a.push(i); } return a; }, [COLS, showSanc]);
  const cellFmt = (ec, c) => { if (c == null || c === '') return ''; if (COLS[ec] === 'Date') return fmtDate(c); const t = colType(COLS[ec]); if (t === 'cnt') return commafy(c); if (t === 'pct') return pctify(c); return c; };
  const clickCol = (ec) => { if (ec < 0) return; if (sortEc === ec) setSortDir(-sortDir); else { setSortEc(ec); setSortDir(1); } };
  // Freeze the identity block (#, State, Region, Event) to the left; Event is width-capped + ellipsized.
  const HASHW = 34, FCOLW = [44, 84, 170];
  const evLeft = (j) => HASHW + FCOLW.slice(0, j).reduce((a, b) => a + b, 0);
  const clearFilters = () => { setRegionSel(''); setStateSel(null); setImSel(''); setSearchTxt(''); };
  const resetEvents = () => { clearFilters(); setSortEc(-1); setSortDir(1); setShowSanc(false); };
  const chips = [];
  if (stateSel) chips.push({ label: 'State: ' + stateSel, clear: () => setStateSel(null) });
  if (regionSel) chips.push({ label: 'Region: ' + regionSel, clear: () => setRegionSel('') });
  if (imSel) chips.push({ label: imSel === 'Yes' ? 'IRONMAN' : 'Non-IRONMAN', clear: () => setImSel('') });
  if (searchTxt) chips.push({ label: searchTxt, clear: () => setSearchTxt('') });

  // ---- State flows ----
  const sfRows = useMemo(() => {
    if (!sfState) return [];
    const rows = [];
    flowAgg.flows.forEach((r) => {
      if (r[1] === sfState && r[0] !== sfState) rows.push(['Inbound', p.names[p.abbr.indexOf(r[0])], p.ab2region[r[0]] || '', r[2]]);
      if (r[0] === sfState && r[1] !== sfState) rows.push(['Outbound', p.names[p.abbr.indexOf(r[1])], p.ab2region[r[1]] || '', r[2]]);
    });
    rows.sort((a, b) => { const x = a[sfSort], y = b[sfSort]; if (typeof x === 'number' && typeof y === 'number') return (x - y) * sfDir; return ('' + x).localeCompare('' + y) * sfDir; });
    return rows;
  }, [sfState, flowAgg, sfSort, sfDir, p]);
  const sfIn = sfState ? (flowAgg.inb[sfState] || 0) : 0;
  const sfOut = sfState ? (flowAgg.outb[sfState] || 0) : 0;
  const clickSf = (c) => { if (sfSort === c) setSfDir(-sfDir); else { setSfSort(c); setSfDir(c === 3 ? -1 : 1); } };
  useEffect(() => { if (stateSel) setSfState(stateSel); }, [stateSel]);
  // Back to page 1 whenever the events filter/sort/period changes.
  useEffect(() => { setEvPage(0); }, [regionSel, stateSel, imSel, searchTxt, sortEc, sortDir, selYears, selMonths]);
  const evPageCount = Math.max(1, Math.ceil(filtered.length / EV_PAGE));
  const evP = Math.min(evPage, evPageCount - 1);
  const evSlice = filtered.slice(evP * EV_PAGE, evP * EV_PAGE + EV_PAGE);

  const th = { padding: '5px 8px', borderBottom: '2px solid var(--line)', textAlign: 'center', cursor: 'pointer', whiteSpace: 'nowrap' };
  const td = { padding: '4px 8px', borderBottom: '1px solid var(--line)', textAlign: 'center', whiteSpace: 'nowrap' };
  const stateNarr = 'Read a row = where that home state’s athletes race (row total “By its athletes”). Read a column = who races in that state (the frozen “Hosted here” bottom row). Grey diagonal = athletes racing in their own state. Net ± = Hosted − By-its-athletes: green = net importer (gain), red = net exporter (loss). Hover for detail. Click a column header to sort rows by it; click a row header (or “Hosted here”) to sort columns; the corner sorts both A–Z. “Traveled out” = raced away from home; the “Traveled in” row = hosted from out-of-state. Totals stay frozen while you scroll.';
  const regionNarr = 'Region × region flows. “Out of region” = raced in a different region; “Out of state” = raced outside the home state (includes another state in the same region), so it is ≥ out of region. Grey diagonal = raced within the home region. Net ± = Hosted − By-its-athletes (green importer, red exporter). Click headers to sort; totals stay frozen while you scroll.';

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <style>{`.hltbl tbody tr:hover>td{background:${rowHL}!important}`}</style>
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--line)', marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, color: tab === t.key ? 'var(--ink)' : 'var(--muted)', borderBottom: tab === t.key ? '3px solid #C20E2F' : '3px solid transparent', marginBottom: -2 }}>
            {t.label}
          </button>
        ))}
        {period ? <span className="muted small" style={{ marginLeft: 'auto' }}>{period}</span> : null}
      </div>

      {tab === 'summary' ? (
        <div ref={smFsRef} style={fsWrap(smFull)}>
          {sumKpis ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '0 0 14px' }}>
              {sumKpis.map((c, i) => (
                <div key={i} title={c[2]} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: '10px 16px', minWidth: 92, cursor: 'help' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>{c[1]}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{c[0]} ⓘ</div>
                </div>
              ))}
            </div>
          ) : null}
          {yb && yb.approxUniq ? <p className="muted small" style={{ margin: '0 0 10px' }}>Multi-period totals sum the selected months. Participations, gender, age, home/away, IRONMAN and new/repeat are exact; distinct counts (Unique, Events, Races) are summed per period, so someone spanning two periods can be counted more than once.</p> : null}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button style={seg} onClick={() => downloadCSV('region_stats.csv', p.rshead, yb.rsrows)}>CSV</button>
            <button style={seg} title="Fullscreen summary" onClick={() => fsToggle(smFsRef)}>{smFull ? 'Exit ⛶' : '⛶ Full'}</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
              <thead><tr>{p.rshead.map((h, i) => <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'center' }}>{h}</th>)}</tr></thead>
              <tbody>
                {yb.rsrows.map((r, ri) => {
                  const tot = r[0] === 'US total';
                  return (
                    <tr key={ri} style={tot ? { fontWeight: 700, background: 'var(--bg)' } : null}>
                      <td style={{ ...td, textAlign: 'left', cursor: tot ? 'default' : 'pointer', color: tot ? 'inherit' : '#3b82f6' }}
                        onClick={() => { if (!tot) { setRegionSel(r[0]); setStateSel(null); setTab('events'); } }}>{r[0]}</td>
                      {r.slice(1).map((c, i) => { const h = p.rshead[i + 1]; return <td key={i} style={td}>{c == null ? 'n/a' : (h.indexOf('%') >= 0 ? c + '%' : Number(c).toLocaleString())}</td>; })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
            {Object.keys(yb.cards).map((name) => {
              const rows = yb.cards[name]; const ispct = name.toLowerCase().indexOf('share') >= 0;
              return (
                <section key={name} style={{ flex: '1 1 220px', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 14 }}>{name}</h3>
                    <button style={seg} onClick={() => downloadCSV(name.replace(/\s+/g, '_') + '.csv', ['State', 'Name', 'Value'], rows)}>CSV</button>
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {rows.map((r, i) => <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0' }}><span>{r[0]} — {r[1]}</span><b>{ispct ? r[2] + '%' : Number(r[2]).toLocaleString()}</b></li>)}
                  </ol>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === 'regionmtx' ? (
        <MatrixTable entities={REGN} data={regionMx} rowHdrW={120} colMinW={92} fill narrative={regionNarr} csvName="region_flow_matrix"
          travCols={[{ key: 'Trav', label: 'Out of region', vals: regionMx.travOut }, { key: 'TravS', label: 'Out of state', vals: regionMx.travOutS }]}
          bottomRows={[{ label: 'Hosted here', key: 'In', vals: regionMx.colTot }, { label: 'Into region', vals: regionMx.travIn, grand: { colKey: 'Trav', value: regionMx.grandRegion } }, { label: 'Into state (total)', vals: regionMx.travInS, grand: { colKey: 'TravS', value: regionMx.grandState } }]} />
      ) : null}

      {tab === 'statemtx' ? (
        <div ref={mxFsRef} style={fsWrap(mxFull)}>
          <MatrixTable entities={p.abbr} data={stateMx} rowHdrW={48} narrative={stateNarr} csvName="state_flow_matrix"
            travCols={[{ key: 'Trav', label: 'Traveled out', vals: stateMx.travOut }]}
            bottomRows={[{ label: 'Hosted here', key: 'In', vals: stateMx.colTot }, { label: 'Traveled in', vals: stateMx.travIn, grand: { colKey: 'Trav', value: stateMx.grandTrav } }]}
            fsBtn={<button style={seg} title="Fullscreen matrix" onClick={() => fsToggle(mxFsRef)}>{mxFull ? 'Exit ⛶' : '⛶ Full'}</button>} />
        </div>
      ) : null}

      {tab === 'stateflows' ? (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <label>State&nbsp;
              <select value={sfState} onChange={(e) => setSfState(e.target.value)}>
                <option value="">— pick a state —</option>
                {p.abbr.slice().sort((a, b) => (p.names[p.abbr.indexOf(a)] < p.names[p.abbr.indexOf(b)] ? -1 : 1)).map((ab) => <option key={ab} value={ab}>{p.names[p.abbr.indexOf(ab)]}</option>)}
              </select>
            </label>
            <button style={seg} onClick={() => { setSfState(firstState); setSfSort(3); setSfDir(-1); }}>Reset</button>
            {sfState ? <button style={seg} onClick={() => downloadCSV('state_flows_' + sfState + '.csv', ['Direction', 'State', 'Region', 'Athletes'], sfRows)}>CSV</button> : null}
          </div>
          {!sfState ? <p className="muted">Pick a state (or click one on the map) to see its inbound and outbound athlete flows.</p> : (
            <div>
              <p><b>{p.names[p.abbr.indexOf(sfState)]}</b> — {sfIn.toLocaleString()} travel in, {sfOut.toLocaleString()} race elsewhere (net {(sfIn - sfOut) >= 0 ? '+' : ''}{(sfIn - sfOut).toLocaleString()}).</p>
              <table className="hltbl" style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
                <thead><tr><th style={th}>#</th>{['Direction', 'State', 'Region', 'Athletes'].map((c, k) => <th key={k} style={th} onClick={() => clickSf(k)}>{c}{sfSort === k ? (sfDir > 0 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
                <tbody>{sfRows.map((r, i) => <tr key={i}><td style={td}>{i + 1}</td><td style={td}>{r[0]}</td><td style={td}>{r[1]}</td><td style={td}>{r[2]}</td><td style={td}>{r[3].toLocaleString()}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'events' ? (
        <div ref={evFsRef} style={evFull ? { background: dark ? '#0b1220' : '#ffffff', padding: 16, height: '100vh', overflow: 'auto', boxSizing: 'border-box' } : undefined}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ position: 'relative', display: 'inline-block' }}>
              <input placeholder="Search events…" value={searchTxt} onChange={(e) => setSearchTxt(e.target.value)} style={{ padding: '6px 24px 6px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, background: 'var(--panel)', color: 'var(--ink)' }} />
              {searchTxt ? <button onClick={() => setSearchTxt('')} title="Clear" style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button> : null}
            </span>
            <label>Region&nbsp;
              <select value={regionSel} onChange={(e) => { setRegionSel(e.target.value); setStateSel(null); }}>
                <option value="">All regions</option>
                {p.regOrder.map((rg) => <option key={rg} value={rg}>{rg}</option>)}
              </select>
            </label>
            <label>IRONMAN&nbsp;
              <select value={imSel} onChange={(e) => setImSel(e.target.value)}>
                <option value="">All</option><option value="Yes">IRONMAN only</option><option value="No">Non-IRONMAN</option>
              </select>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={showSanc} onChange={(e) => setShowSanc(e.target.checked)} /> Sanction ID &amp; Start Date</label>
            <button style={seg} onClick={resetEvents}>Reset</button>
            <button style={seg} onClick={() => downloadCSV('events.csv', ['#'].concat(visCols.map((ec) => COLS[ec])), filtered.map((r, i) => [i + 1].concat(visCols.map((ec) => r[ec]))))}>CSV</button>
            <button style={seg} title="Fullscreen table" onClick={toggleEvFs}>{evFull ? 'Exit ⛶' : '⛶ Full'}</button>
            <span className="muted small" style={{ marginLeft: 'auto' }}>{filtered.length.toLocaleString()} of {EV.length.toLocaleString()} events{filtered.length > EV_PAGE ? ` · showing ${(evP * EV_PAGE + 1).toLocaleString()}–${Math.min((evP + 1) * EV_PAGE, filtered.length).toLocaleString()}` : ''}</span>
          </div>
          {chips.length ? <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{chips.map((c, i) => <span key={i} style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 999, padding: '3px 8px 3px 12px', fontSize: 13, color: '#3730a3', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{c.label}<button onClick={c.clear} title="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, lineHeight: 1, color: '#3730a3' }}>×</button></span>)}</div> : null}
          <div style={{ maxHeight: evFull ? 'calc(100vh - 130px)' : 520, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
            <table className="hltbl" style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead><tr>
                <th style={{ ...th, position: 'sticky', top: 0, left: 0, zIndex: 6, background: 'var(--panel)', minWidth: HASHW }}>#</th>
                {visCols.map((ec, j) => { const fz = j < 3; return <th key={ec} style={{ ...th, position: 'sticky', top: 0, left: fz ? evLeft(j) : undefined, zIndex: fz ? 6 : 3, background: 'var(--panel)', minWidth: fz ? FCOLW[j] : undefined, maxWidth: j === 2 ? FCOLW[2] : undefined, textAlign: ec >= 3 ? 'center' : 'left' }} onClick={() => clickCol(ec)}>{COLS[ec] === 'Date' ? 'Start Date' : COLS[ec]}{ec === sortEc ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>; })}
              </tr></thead>
              <tbody>
                {evSlice.map((r, i) => { const gi = evP * EV_PAGE + i; const bg = r[5] === 'Yes' ? imFrozen : 'var(--panel)'; return (
                  <tr key={gi} style={r[5] === 'Yes' ? { background: imRow } : null}>
                    <td style={{ ...td, position: 'sticky', left: 0, zIndex: 2, background: bg, minWidth: HASHW }}>{gi + 1}</td>
                    {visCols.map((ec, j) => { const fz = j < 3; return <td key={ec} style={{ ...td, textAlign: ec >= 3 ? 'center' : 'left', position: fz ? 'sticky' : undefined, left: fz ? evLeft(j) : undefined, zIndex: fz ? 2 : undefined, background: fz ? bg : undefined, minWidth: fz ? FCOLW[j] : undefined, maxWidth: j === 2 ? FCOLW[2] : undefined, overflow: j === 2 ? 'hidden' : undefined, textOverflow: j === 2 ? 'ellipsis' : undefined }} title={ec === 2 ? ((r[2] || '') + ' · Sanction #' + r[3] + ' · ' + fmtDate(r[4])) : undefined}>{cellFmt(ec, r[ec])}</td>; })}
                  </tr>
                ); })}
              </tbody>
            </table>
            {filtered.length === 0 ? <p className="muted" style={{ padding: 16, textAlign: 'center' }}>No events match the current filters{period ? ' for ' + period : ''}.</p> : null}
          </div>
          {evPageCount > 1 ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 }}>
              <button style={{ ...seg, opacity: evP === 0 ? 0.4 : 1 }} disabled={evP === 0} onClick={() => setEvPage(evP - 1)}>‹ Prev</button>
              <span className="muted small">Page {evP + 1} of {evPageCount}</span>
              <button style={{ ...seg, opacity: evP >= evPageCount - 1 ? 0.4 : 1 }} disabled={evP >= evPageCount - 1} onClick={() => setEvPage(evP + 1)}>Next ›</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'reference' ? <Reference /> : null}
    </div>
  );
}

export default memo(ParticipationTabs);

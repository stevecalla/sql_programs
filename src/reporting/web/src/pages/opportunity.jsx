// Opportunity view — shared band definitions + the two rail panels (stat card + ranking table).
// Kept in one module so the band colors/labels + the classify() rule live in a SINGLE place (the map fill
// in ParticipationMap imports the same constants — no parallel definitions). Layout A uses these as:
//   [ map card | <OppCard/> ]  (top row)
//   <OppTable/>                (full-width, below)
import { useState, useMemo } from 'react';

// 4 bands, driven by two cutoffs + the (population-weighted) national rate:
//   leader ≥ leaderCut · mid  national..leaderCut · under  floorCut..national · floor ≤ floorCut
export const OPP_C = { floor: '#C0392B', under: '#E0A030', mid: '#888780', leader: '#1A7A4C' };
export const OPP_TXT = { floor: '#A32D2D', under: '#854F0B', mid: '#5F5E5A', leader: '#0F6E56' };
export const OPP_LABEL = { floor: 'Floor', under: 'Under-penetrated', mid: 'Mid', leader: 'Leader' };
export const OPP_ORDER = ['leader', 'mid', 'under', 'floor'];

// leader ≥ leaderCut · mid  midCut..leaderCut · under  floorCut..midCut · floor ≤ floorCut.
// midCut is the Mid/Under boundary (national rate for rel/absolute; the median or mean for statistical).
export function classifyBand(pen, midCut, leaderCut, floorCut) {
  if (pen == null) return null;
  if (pen >= leaderCut) return 'leader';
  if (pen >= midCut) return 'mid';
  if (pen > floorCut) return 'under';
  return 'floor';
}

// Tiny CSV download (self-contained so the rail doesn't couple to the map's exporter).
function downloadCsv(name, headers, rows) {
  const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const txt = [headers.join(',')].concat(rows.map((r) => r.map(esc).join(','))).join('\n');
  const blob = new Blob([txt], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

const fmtPop = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n).toLocaleString());
const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
const f2 = (n) => (n == null ? '—' : Number(n).toFixed(2));
const miniBtn = { padding: '3px 9px', border: '1px solid var(--line)', borderRadius: 6, background: 'transparent', color: 'inherit', fontSize: 12, cursor: 'pointer' };

// Merged stat card: headline key figure (active basis) + an all-states block, a collapsible in-state block,
// misc Stats, and a collapsible Calculations block that spells out every formula with the state's numbers.
// Header (name/region/band + CSV) is pinned; the body scrolls. Adults 18+; population is Census ACS 1-year.
const pct = (v) => (v == null ? '—' : Math.round(v) + '%');
export function OppCard({ row, opp }) {
  const [allOpen, setAllOpen] = useState(true);     // all-states block open by default
  const [inOpen, setInOpen] = useState(false);      // in-state block collapsed by default
  const [breakOpen, setBreakOpen] = useState(true); // "where residents race" breakout open by default
  const [statsOpen, setStatsOpen] = useState(true); // stats open by default
  const [calcOpen, setCalcOpen] = useState(false);  // calculations collapsed by default
  // No maxHeight: the card stretches to the map card's height (flex align-stretch); the body scrolls inside.
  const base = { flex: '1 1 auto', minWidth: 260, resize: 'horizontal', overflow: 'hidden', margin: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0, display: 'flex', flexDirection: 'column' };
  if (!row || row.band == null) {
    return <div className="card" style={base}><div className="small muted" style={{ padding: 4 }}>Select a state on the map or table to see its penetration detail.</div></div>;
  }
  const basisIn = !!(opp && opp.basisIn);
  const national = opp ? opp.national : null, inNational = opp ? opp.inNational : null;
  const heroPen = basisIn ? row.inPen : row.pen, heroLbl = basisIn ? 'in-state penetration' : 'all-states penetration';
  const youth = !!(opp && opp.ageGroup === 'youth');
  const grpLbl = youth ? 'youth (4–19)' : 'adults (20+)';
  const popLbl = youth ? 'Youth population (4–19)' : 'Adult population (20+)';
  const per1k = (n) => (n != null && row.pop ? (n / row.pop) * 1000 : null);
  const cntPer = (n) => (n == null ? '—' : fmtInt(n) + ' · ' + f2(per1k(n)) + '/1k');
  const netTxt = row.net == null ? '—' : (row.net > 0 ? '+' : '') + fmtInt(row.net) + ' · ' + (row.net < 0 ? 'destination' : 'feeder');
  const rowEl = (a, b, opts) => (
    <tr className={opts && opts.pay ? undefined : undefined} title={(opts && opts.tip) || undefined}>
      <td className="muted" style={{ padding: '3px 0', cursor: opts && opts.tip ? 'help' : undefined }}>{a}{opts && opts.tip ? ' ⓘ' : ''}</td>
      <td style={{ textAlign: 'right', padding: '3px 0', color: (opts && opts.col) || undefined, fontWeight: (opts && opts.strong) ? 800 : 600 }}>{b}</td>
    </tr>
  );
  const sec = (t, tip) => <div className="small muted" title={tip} style={{ fontWeight: 700, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 6, cursor: tip ? 'help' : undefined }}>{t}{tip ? ' ⓘ' : ''}</div>;
  const secBtn = (t, open, onClick) => (
    <button onClick={onClick} title={open ? 'Collapse' : 'Expand'} style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid var(--line)', color: 'var(--muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', marginTop: 10, paddingTop: 6 }}>
      <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? '▾' : '▸'}</span>{t}
    </button>
  );
  const exportCard = () => downloadCsv('opportunity_' + row.ab.toLowerCase() + '.csv', ['Field', 'Value'], [
    ['State', row.name], ['Region', row.reg], ['Band', OPP_LABEL[row.band]], ['Age group', youth ? 'Youth 4-19' : 'Adults 20+'],
    ['Population source', 'US Census ACS 1-year (age-split at 20)'], [popLbl, row.pop],
    ['All-states athletes (raced anywhere)', row.allCnt], ['All-states /1k', row.pen], ['All-states national /1k', national], ['All-states gap', row.gap], ['All-states headroom', row.headroom],
    ['In-state athletes (home-only)', row.onlyInCnt], ['In-state /1k', row.inPen], ['In-state national /1k', inNational], ['In-state gap', row.inGap], ['In-state headroom', row.inHeadroom],
    ['Raced only in-state', row.onlyInCnt], ['Raced in-state and out', row.bothCnt], ['Raced only out-of-state', row.onlyOutCnt],
    ['Age 4-19 %', row.age419], ['Age 20-29 %', row.age2029], ['Age 30+ %', row.age30], ['Male %', row.male], ['Female %', row.female],
    ['Athletes per event', row.perEvent], ['Net flow (home-event)', row.net], ['Events', row.events], ['Races', row.races],
  ]);
  const f2s = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + f2(v));
  return (
    <div className="card" style={{ ...base, borderLeft: '4px solid ' + OPP_C[row.band], padding: 0 }}>
      <div style={{ padding: '11px 14px 8px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>{row.name}</span>
          <button className="oppcsv" title="Download this state's detail (CSV)" onClick={exportCard} style={miniBtn}>CSV</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginTop: 1 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>{row.reg} region</span>
          <span title="Band is set from the active-basis /1k gap vs national (see * below)." style={{ fontSize: 11.5, fontWeight: 800, color: OPP_TXT[row.band], letterSpacing: '.03em', cursor: 'help' }}>{OPP_LABEL[row.band].toUpperCase()} *</span>
        </div>
        <div title={'The key figure (' + heroLbl + ') — drives the band + headroom.'} style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 8, cursor: 'help' }}>
          <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{f2(heroPen)}</span>
          <span className="muted" style={{ fontSize: 12 }}>/1k · {heroLbl} · {grpLbl} ⓘ</span>
        </div>
      </div>
      <div style={{ padding: '4px 14px 12px', overflow: 'auto', flex: '1 1 0', minHeight: 0 }}>
        <table className="opphl" style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}><tbody>
          {rowEl(popLbl, fmtPop(row.pop), { tip: (youth ? 'State population ages 4–19' : 'State population ages 20 and up') + ' — US Census ACS 1-year (age-split at 20), the per-capita denominator.' })}
        </tbody></table>

        {secBtn('Reach — all states', allOpen, () => setAllOpen((o) => !o))}
        {allOpen ? (
          <table className="opphl" style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}><tbody>
            {rowEl('All-states athletes', fmtInt(row.allCnt), { tip: 'Distinct ' + grpLbl + ' residents of the state who raced ANYWHERE (home or away), counted once — the all-states numerator, member-matched.' })}
            {rowEl('All-states /1k', f2(row.pen), { tip: 'All-states athletes ÷ ' + popLbl.toLowerCase() + ' × 1,000 — residents racing per 1,000 people, wherever they race.' })}
            {rowEl('National /1k', f2(national), { tip: 'Population-weighted national all-states rate — the benchmark the band + headroom compare to.' })}
            {rowEl('/1k gap *', f2s(row.gap), { col: row.gap == null ? null : (row.gap < 0 ? OPP_TXT.floor : OPP_TXT.leader), tip: 'All-states /1k − national /1k. Negative = below national. * This gap sets the band.' })}
            {rowEl('Headroom', row.headroom ? '~' + fmtInt(row.headroom) : '—', { strong: true, col: row.headroom ? OPP_TXT.under : null, tip: 'Athletes to reach the national rate = (national − /1k) ÷ 1,000 × population.' })}
          </tbody></table>
        ) : null}

        {secBtn('Reach — in state (home-only)', inOpen, () => setInOpen((o) => !o))}
        {inOpen ? (
          <table className="opphl" style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}><tbody>
            {rowEl('In-state athletes', fmtInt(row.onlyInCnt), { tip: 'Distinct ' + grpLbl + ' residents who raced ONLY in their home state (never traveled out) — the in-state numerator. A subset of all-states.' })}
            {rowEl('In-state /1k', f2(row.inPen), { tip: 'In-state (home-only) athletes ÷ ' + popLbl.toLowerCase() + ' × 1,000 — residents racing only at home, per 1,000 people.' })}
            {rowEl('National /1k', f2(inNational), { tip: 'Population-weighted national in-state rate — the benchmark.' })}
            {rowEl('/1k gap', f2s(row.inGap), { col: row.inGap == null ? null : (row.inGap < 0 ? OPP_TXT.floor : OPP_TXT.leader), tip: 'In-state /1k − national /1k.' })}
            {rowEl('Headroom', row.inHeadroom ? '~' + fmtInt(row.inHeadroom) : '—', { strong: true, col: row.inHeadroom ? OPP_TXT.under : null, tip: 'Athletes to reach the national in-state rate = (national − /1k) ÷ 1,000 × population.' })}
          </tbody></table>
        ) : null}

        {secBtn('Where residents race', breakOpen, () => setBreakOpen((o) => !o))}
        {breakOpen ? (
          <table className="opphl" style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}><tbody>
            {rowEl('Raced only in-state', cntPer(row.onlyInCnt), { tip: 'Residents who raced only in their home state (home-only). = In-state athletes.' })}
            {rowEl('Raced in-state and out', cntPer(row.bothCnt), { tip: 'Residents who raced both in their home state and out of state.' })}
            {rowEl('Raced only out-of-state', cntPer(row.onlyOutCnt), { tip: 'Residents who raced only outside their home state (traveled every time).' })}
            {rowEl('= All-states', cntPer(row.allCnt), { strong: true, tip: 'The three buckets above are mutually exclusive and sum to all-states (residents who raced anywhere).' })}
          </tbody></table>
        ) : null}

        {secBtn('Stats', statsOpen, () => setStatsOpen((o) => !o))}
        {statsOpen ? (
          <table className="opphl" style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}><tbody>
            {rowEl('4–19 share', pct(row.age419), { tip: 'Share of the state’s participations from ages 4–19.' })}
            {rowEl('20–29 share', pct(row.age2029), { tip: 'Share of the state’s participations from ages 20–29.' })}
            {rowEl('30+ share', pct(row.age30), { tip: 'Share of the state’s participations from ages 30 and up (= 100 − 4–19 − 20–29).' })}
            {rowEl('Male / female', row.male == null && row.female == null ? '—' : pct(row.male) + ' / ' + pct(row.female), { tip: 'Sex split of the state’s participations.' })}
            {rowEl('Athletes / event', fmtInt(row.perEvent), { tip: 'Average field size — participations ÷ events held in the state.' })}
            {rowEl('Net flow (home−event)', netTxt, { col: row.net == null ? null : (row.net < 0 ? OPP_TXT.floor : OPP_TXT.leader), tip: 'Outbound − inbound participations: residents’ race entries out of state − visiting racers’ entries at events held here. Negative = destination (draws more than its residents travel out); positive = feeder.' })}
            {rowEl('Events · races', fmtInt(row.events) + ' · ' + fmtInt(row.races), { tip: 'Distinct events and distinct races held in the state (an event can hold several races).' })}
          </tbody></table>
        ) : null}

        {secBtn('Calculations', calcOpen, () => setCalcOpen((o) => !o))}
        {calcOpen ? (
          <div style={{ fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.7, marginTop: 3 }}>
            <div>All-states /1k = {fmtInt(row.allCnt)} ÷ {fmtInt(row.pop)} × 1,000 = {f2(row.pen)}</div>
            <div>In-state /1k = {fmtInt(row.onlyInCnt)} ÷ {fmtInt(row.pop)} × 1,000 = {f2(row.inPen)}</div>
            <div>buckets: {fmtInt(row.onlyInCnt)} only-in + {fmtInt(row.bothCnt)} both + {fmtInt(row.onlyOutCnt)} only-out = {fmtInt(row.allCnt)}</div>
            <div>National /1k (all-states) = {opp ? fmtInt(opp.natNum) : '—'} ÷ {opp ? fmtInt(opp.natPop) : '—'} × 1,000 = {f2(national)}</div>
            <div>National /1k (in-state) = {opp ? fmtInt(opp.inNatNum) : '—'} ÷ {opp ? fmtInt(opp.inNatPop) : '—'} × 1,000 = {f2(inNational)}</div>
            <div>Headroom = (national − /1k) ÷ 1,000 × pop</div>
            <div>&nbsp;&nbsp;all-states = ({f2(national)} − {f2(row.pen)})/1k × {fmtInt(row.pop)} ≈ {row.headroom ? fmtInt(row.headroom) : '0'}</div>
            <div>&nbsp;&nbsp;in-state = ({f2(inNational)} − {f2(row.inPen)})/1k × {fmtInt(row.pop)} ≈ {row.inHeadroom ? fmtInt(row.inHeadroom) : '0'}</div>
          </div>
        ) : null}

        <div className="small muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
          * Band set by the active-basis /1k gap vs national. Athletes are member-matched {grpLbl} residents; all-states = raced anywhere, in-state = raced only at home (a subset). Denominator is the matching Census population ({youth ? 'youth 4–19' : 'adults 20+'}), so /1k is per 1,000 {youth ? 'youth' : 'adults'}. Age &amp; sex shares are of all participations. Rates population-weighted. Valid for a single year; multi-year selections sum the numerator against one-year population.
        </div>
      </div>
    </div>
  );
}

// Full ranking as two tabs: "All metrics" (every state-card field per state, horizontal-scroll) and
// "Gaps & headroom" (the opportunity math — all-states + in-state gap/headroom side by side). Sortable,
// CSV (always comprehensive), row-click selects (syncs map + card). Collapsible; drag the bottom edge to resize.
export function OppTable({ rows, national, sel, onSelect, dark, opp, period, ageGroup, onAgeChange, basis }) {
  const [tab, setTab] = useState('all');            // 'all' = every metric · 'gaps' = gap + headroom focus
  const [sortKey, setSortKey] = useState('pen');
  const [sortDir, setSortDir] = useState('desc');
  const [collapsed, setCollapsed] = useState(false);
  const nat = opp ? opp.national : national, inNat = opp ? opp.inNational : null;
  const youth = (ageGroup || (opp && opp.ageGroup)) === 'youth';
  const popHdr = youth ? 'Youth pop' : 'Adult pop';
  const basisIn = !!(opp && opp.basisIn);
  // Age toggle button style — mirrors the map's segmented control (dark-mode-aware so the selection is clear).
  const ageBtn = (g) => ({ padding: '4px 11px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer', fontWeight: (ageGroup || 'adult') === g ? 700 : 400,
    border: '1px solid ' + ((ageGroup || 'adult') === g ? (dark ? '#60a5fa' : '#082240') : 'var(--line)'),
    background: (ageGroup || 'adult') === g ? (dark ? '#2563eb' : '#082240') : 'transparent', color: (ageGroup || 'adult') === g ? '#fff' : 'inherit',
    boxShadow: (ageGroup || 'adult') === g && dark ? '0 0 0 1px #60a5fa' : 'none' });

  const banded = useMemo(() => (rows || []).filter((r) => r.band != null), [rows]);
  const sorted = useMemo(() => {
    const a = banded.slice();
    a.sort((x, y) => {
      const xv = x[sortKey], yv = y[sortKey];
      if (xv == null && yv == null) return 0; if (xv == null) return 1; if (yv == null) return -1;
      const d = xv < yv ? -1 : xv > yv ? 1 : 0;
      return sortDir === 'desc' ? -d : d;
    });
    return a;
  }, [banded, sortKey, sortDir]);

  const setSort = (k) => { if (sortKey === k) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc')); else { setSortKey(k); setSortDir('desc'); } };
  const pickTab = (t) => { setTab(t); setSortKey(t === 'gaps' ? 'headroom' : 'pen'); setSortDir('desc'); };

  const gapCell = (v) => (v == null ? '—' : <span style={{ color: v < 0 ? OPP_TXT.floor : OPP_TXT.leader }}>{v > 0 ? '+' : ''}{f2(v)}</span>);
  const head = (v) => (v ? '~' + fmtInt(v) : '—');
  // Column catalog — key (sort field), label, tip, r(row)=>cell. l=left-aligned.
  const C = {
    name: { key: 'name', label: 'State', tip: 'State', l: true, r: (x) => x.name },
    reg: { key: 'reg', label: 'Region', tip: 'USAT region', l: true, r: (x) => x.reg },
    band: { key: 'pen', label: 'Band', tip: 'Leader / Mid / Under-penetrated / Floor', r: (x) => <span title={OPP_LABEL[x.band]} style={{ width: 10, height: 10, borderRadius: 2, background: OPP_C[x.band], display: 'inline-block' }} /> },
    pop: { key: 'pop', label: popHdr, tip: (youth ? 'Youth (4–19)' : 'Adult (20+)') + ' Census population — the /1k denominator', r: (x) => fmtPop(x.pop) },
    allCnt: { key: 'allCnt', label: 'All ath.', tip: 'Distinct residents who raced anywhere (all-states numerator)', r: (x) => fmtInt(x.allCnt) },
    pen: { key: 'pen', label: 'All /1k', tip: 'All-states athletes ÷ population × 1,000', r: (x) => <b>{f2(x.pen)}</b> },
    gap: { key: 'gap', label: 'All gap', tip: 'All-states /1k − national /1k (sets the band)', r: (x) => gapCell(x.gap) },
    headroom: { key: 'headroom', label: 'All headroom', tip: 'Athletes to reach national (all-states) = (nat − /1k)/1k × pop', r: (x) => head(x.headroom) },
    onlyInCnt: { key: 'onlyInCnt', label: 'In ath.', tip: 'Residents who raced only at home (in-state numerator)', r: (x) => fmtInt(x.onlyInCnt) },
    inPen: { key: 'inPen', label: 'In /1k', tip: 'In-state (home-only) athletes ÷ population × 1,000', r: (x) => <b>{f2(x.inPen)}</b> },
    inGap: { key: 'inGap', label: 'In gap', tip: 'In-state /1k − national in-state /1k', r: (x) => gapCell(x.inGap) },
    inHeadroom: { key: 'inHeadroom', label: 'In headroom', tip: 'Athletes to reach national (in-state)', r: (x) => head(x.inHeadroom) },
    both: { key: 'bothCnt', label: 'Both', tip: 'Residents who raced in-state AND out', r: (x) => fmtInt(x.bothCnt) },
    onlyOut: { key: 'onlyOutCnt', label: 'Only out', tip: 'Residents who raced only out of state', r: (x) => fmtInt(x.onlyOutCnt) },
    a419: { key: 'age419', label: '4–19%', tip: 'Age 4–19 share of participations', r: (x) => pct(x.age419) },
    a2029: { key: 'age2029', label: '20–29%', tip: 'Age 20–29 share', r: (x) => pct(x.age2029) },
    a30: { key: 'age30', label: '30+%', tip: 'Age 30+ share', r: (x) => pct(x.age30) },
    male: { key: 'male', label: 'M%', tip: 'Male share', r: (x) => pct(x.male) },
    female: { key: 'female', label: 'F%', tip: 'Female share', r: (x) => pct(x.female) },
    per: { key: 'perEvent', label: 'Ath/ev', tip: 'Average field size — participations ÷ events', r: (x) => fmtInt(x.perEvent) },
    net: { key: 'net', label: 'Net', tip: 'Outbound − inbound participations: residents’ out-of-state entries − visiting racers’ entries here. − = destination', r: (x) => x.net == null ? '—' : (x.net > 0 ? '+' : '') + fmtInt(x.net) },
    events: { key: 'events', label: 'Events', tip: 'Distinct events', r: (x) => fmtInt(x.events) },
    races: { key: 'races', label: 'Races', tip: 'Distinct races', r: (x) => fmtInt(x.races) },
  };
  const ALL = [C.name, C.reg, C.band, C.pop, C.allCnt, C.pen, C.gap, C.headroom, C.onlyInCnt, C.inPen, C.inGap, C.inHeadroom, C.both, C.onlyOut, C.a419, C.a2029, C.a30, C.male, C.female, C.per, C.net, C.events, C.races];
  const GAPS = [C.name, C.band, C.pop, C.pen, C.gap, C.headroom, C.inPen, C.inGap, C.inHeadroom];
  const cols = tab === 'gaps' ? GAPS : ALL;

  const exportCsv = () => downloadCsv('opportunity_' + tab + '.csv',
    ['Rank', 'State', 'Region', 'Band', 'Population', 'AllStates_ath', 'AllStates_1k', 'National_1k', 'AllStates_gap', 'AllStates_headroom', 'InState_ath', 'InState_1k', 'InState_natl_1k', 'InState_gap', 'InState_headroom', 'Both', 'Only_out', 'Age4_19', 'Age20_29', 'Age30plus', 'Male', 'Female', 'Ath_per_event', 'Net_flow', 'Events', 'Races'],
    sorted.map((r, i) => [i + 1, r.name, r.reg, OPP_LABEL[r.band], r.pop, r.allCnt, r.pen, nat, r.gap, r.headroom, r.onlyInCnt, r.inPen, inNat, r.inGap, r.inHeadroom, r.bothCnt, r.onlyOutCnt, r.age419, r.age2029, r.age30, r.male, r.female, r.perEvent, r.net, r.events, r.races]));

  const th = (col) => {
    const act = sortKey === col.key;
    return <th key={col.label} title={col.tip} onClick={() => setSort(col.key)} style={{ padding: '5px 7px', textAlign: col.l ? 'left' : 'center', fontWeight: act ? 700 : 600, color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--panel)' }}>{col.label}{act ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}</th>;
  };
  const tabBtn = (t, label) => (
    <button onClick={() => pickTab(t)} style={{
      padding: '5px 12px', border: '1px solid var(--line)', borderBottom: tab === t ? 'none' : '1px solid var(--line)',
      borderRadius: '7px 7px 0 0', background: tab === t ? 'var(--panel)' : 'transparent', marginBottom: -1,
      color: tab === t ? 'var(--ink)' : 'var(--muted)', fontSize: 12, fontWeight: tab === t ? 700 : 500, cursor: 'pointer',
    }}>{label}</button>
  );

  return (
    <div className="card" style={{ margin: '10px 0 0' }}>
      <button onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--ink)', font: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{collapsed ? '▸' : '▾'}</span>State ranking
      </button>
      {!collapsed ? (
        <div style={{ marginTop: 8 }}>
          <div className="small muted" style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'center' }}>
            <span>Showing:</span>
            {period ? <span><b style={{ color: 'var(--ink)' }}>{period}</b></span> : null}
            <span>·</span>
            <span><b style={{ color: youth ? OPP_TXT.under : OPP_TXT.leader }}>{youth ? 'Youth 4–19' : 'Adults 20+'}</b> (over {youth ? 'youth' : 'adult'} population)</span>
            <span>·</span>
            <span>map basis: <b style={{ color: 'var(--ink)' }}>{basisIn ? 'In-state' : 'All-states'}</b></span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, borderBottom: '1px solid var(--line)' }}>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'flex-end' }}>{tabBtn('all', 'All metrics')}{tabBtn('gaps', 'Gaps & headroom')}</span>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'flex-end', marginBottom: 4 }}>
              {onAgeChange ? (
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} title="Switch the whole ranking between adults 20+ and youth 4–19 (also flips the map's Age toggle).">
                  <span className="small muted" style={{ fontWeight: 700, marginRight: 2 }}>Age</span>
                  <button style={ageBtn('adult')} onClick={() => onAgeChange('adult')}>Adult</button>
                  <button style={ageBtn('youth')} onClick={() => onAgeChange('youth')}>Youth</button>
                </span>
              ) : null}
              <button style={miniBtn} title="Download the full ranking (CSV — all metrics)" onClick={exportCsv}>CSV</button>
            </span>
          </div>
          <div style={{ maxHeight: 340, minHeight: 120, overflow: 'auto', resize: 'vertical' }}>
            <table className="opphl" style={{ fontSize: 12, borderCollapse: 'collapse', minWidth: tab === 'all' ? 1180 : '100%' }}>
              <thead><tr>
                <th style={{ padding: '5px 7px', textAlign: 'center', color: 'var(--muted)', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--panel)' }}>#</th>
                {cols.map(th)}
              </tr></thead>
              <tbody>
                {sorted.map((r, i) => {
                  const on = sel === r.ab;
                  return (
                    <tr key={r.ab} onClick={() => onSelect(r.ab)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--line)', background: on ? (dark ? 'rgba(148,163,184,.20)' : 'rgba(15,23,42,.06)') : 'transparent' }}>
                      <td style={{ padding: '4px 7px', textAlign: 'center', color: 'var(--muted)' }}>{i + 1}</td>
                      {cols.map((col) => <td key={col.label} style={{ padding: '4px 7px', textAlign: col.l ? 'left' : 'center', fontWeight: (col.key === 'name' && on) ? 700 : undefined, whiteSpace: 'nowrap' }}>{col.r(r)}</td>)}
                    </tr>
                  );
                })}
                {!sorted.length ? <tr><td colSpan={cols.length + 1} className="muted small" style={{ padding: '8px 6px', textAlign: 'center' }}>No penetration data for this selection.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>{tab === 'gaps' ? 'Gap = /1k − national; Headroom = (national − /1k) ÷ 1,000 × population — shown for both all-states and in-state.' : 'Every state-card metric, per state (scroll →). CSV always exports the full set.'} Sortable · click a row to select · drag the bottom edge to resize.</div>
        </div>
      ) : null}
    </div>
  );
}

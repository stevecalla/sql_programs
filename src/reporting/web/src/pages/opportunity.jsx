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

// Merged stat card (mockup context fields + the opportunity block). Not collapsible; resizable (CSS).
// Fields run population → down, with the headroom payoff called out at the bottom.
export function OppCard({ row, national, flex }) {
  const base = { flex: '1 1 auto', minWidth: 260, resize: 'both', overflow: 'auto', margin: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0 };
  if (!row || row.band == null) {
    return <div className="card" style={base}><div className="small muted">Select a state on the map or table to see its penetration detail.</div></div>;
  }
  const rowEl = (a, b, opts) => (
    <tr title={(opts && opts.tip) || undefined} style={opts && opts.top ? { borderTop: '1px solid var(--line)' } : undefined}>
      <td className="muted" style={{ padding: '4px 0', cursor: opts && opts.tip ? 'help' : undefined }}>{a}{opts && opts.tip ? ' ⓘ' : ''}</td>
      <td style={{ textAlign: 'right', padding: '4px 0', color: (opts && opts.col) || undefined, fontWeight: (opts && opts.strong) ? 800 : 600 }}>{b}</td>
    </tr>
  );
  const netTxt = row.net == null ? '—' : (row.net > 0 ? '+' : '') + fmtInt(row.net) + ' · ' + (row.net < 0 ? 'destination' : 'feeder');
  return (
    <div className="card" style={{ ...base, borderLeft: '4px solid ' + OPP_C[row.band], padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 800 }}>{row.name}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: OPP_TXT[row.band], letterSpacing: '.03em' }}>{OPP_LABEL[row.band].toUpperCase()}</span>
      </div>
      <div className="muted" style={{ marginTop: 1, fontSize: 13 }}>{row.reg} region</div>
      <div title="Home penetration = home athletes ÷ population × 1,000. Gap = this rate − the national rate." style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '12px 0 8px', cursor: 'help' }}>
        <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{f2(row.pen)}</span>
        <span className="muted" style={{ fontSize: 12.5 }}>/1k home penetration · nat’l {f2(national)} · gap {row.gap > 0 ? '+' : ''}{f2(row.gap)}</span>
      </div>
      <table className="opphl" style={{ width: '100%', marginTop: 8, fontSize: 14.5, borderCollapse: 'collapse' }}><tbody>
        {rowEl('Population', fmtPop(row.pop), { tip: 'State resident population — US Census ACS 1-year (the per-capita denominator).' })}
        {rowEl('Home athletes', fmtInt(row.res), { tip: 'Distinct adult residents of the state who race (home or away), counted once — the penetration numerator, member-matched. Different from the “Home (count)” metric, which counts in-state race entries.' })}
        {rowEl('Event penetration /1k', f2(row.evp), { tip: 'Adult participations at in-state events ÷ population × 1,000 — supply-side reach (where events are held), vs. home penetration which counts residents.' })}
        {rowEl('Net flow (home−event)', netTxt, { col: row.net == null ? null : (row.net < 0 ? OPP_TXT.floor : OPP_TXT.leader), tip: 'Residents racing away − races hosted from out of state. Negative = destination (hosts more than its residents travel out); positive = feeder.' })}
        {rowEl('Athletes / event', fmtInt(row.perEvent), { tip: 'Average field size — participations ÷ events held in the state for this selection.' })}
        {rowEl('20–29 share', row.age2029 == null ? '—' : Math.round(row.age2029) + '%', { tip: 'Share of the state’s adult participations that come from the 20–29 age band.' })}
        {rowEl('Events · races', fmtInt(row.events) + ' · ' + fmtInt(row.races), { tip: 'Distinct events and distinct races held in the state for this selection (an event can hold several races).' })}
        {rowEl('Headroom to national', row.headroom ? '~' + fmtInt(row.headroom) + ' athletes' : '—', { top: true, strong: true, col: row.headroom ? OPP_TXT.under : null, tip: 'Estimated additional resident athletes to reach the national rate = (national − penetration) ÷ 1,000 × population.' })}
      </tbody></table>
    </div>
  );
}

// Full ranking as a real table: two DIFFERENT measure tabs — Penetration (all states, by rate) and
// Headroom (only under-national states, by headroom). Sortable, CSV, row-click selects (syncs map + card).
// The whole card collapses to just its header; the list area itself is drag-resizable.
export function OppTable({ rows, national, sel, onSelect, dark }) {
  const [tab, setTab] = useState('pen');            // 'pen' | 'headroom'
  const [sortKey, setSortKey] = useState('pen');
  const [sortDir, setSortDir] = useState('desc');
  const [collapsed, setCollapsed] = useState(false);

  const banded = useMemo(() => (rows || []).filter((r) => r.band != null), [rows]);
  const shown = useMemo(() => (tab === 'headroom' ? banded.filter((r) => r.headroom > 0) : banded), [banded, tab]);
  const sorted = useMemo(() => {
    const k = sortKey === 'band' ? 'pen' : sortKey;
    const a = shown.slice();
    a.sort((x, y) => {
      const xv = k === 'name' ? x.name : x[k], yv = k === 'name' ? y.name : y[k];
      if (xv == null && yv == null) return 0; if (xv == null) return 1; if (yv == null) return -1;
      const d = xv < yv ? -1 : xv > yv ? 1 : 0;
      return sortDir === 'desc' ? -d : d;
    });
    return a;
  }, [shown, sortKey, sortDir]);

  const setSort = (k) => { if (sortKey === k) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc')); else { setSortKey(k); setSortDir('desc'); } };
  const pickTab = (t) => { setTab(t); setSortKey(t === 'pen' ? 'pen' : 'headroom'); setSortDir('desc'); };

  const th = (k, label, tip) => {
    const act = sortKey === k;
    return <th title={tip} onClick={() => setSort(k)} style={{ padding: '5px 6px', textAlign: 'center', fontWeight: act ? 700 : 600, color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>{label}{act ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}</th>;
  };
  const tabBtn = (t, label) => (
    <button onClick={() => pickTab(t)} style={{
      padding: '5px 12px', border: '1px solid var(--line)', borderBottom: tab === t ? 'none' : '1px solid var(--line)',
      borderRadius: '7px 7px 0 0', background: tab === t ? 'var(--panel)' : 'transparent', marginBottom: -1,
      color: tab === t ? 'var(--ink)' : 'var(--muted)', fontSize: 12, fontWeight: tab === t ? 700 : 500, cursor: 'pointer',
    }}>{label}</button>
  );
  const exportCsv = () => downloadCsv('opportunity_ranking.csv',
    ['Rank', 'State', 'Band', 'Penetration_per_1k', 'National_per_1k', 'Gap_per_1k', 'Population', 'Resident_athletes', 'Headroom_athletes'],
    sorted.map((r, i) => [i + 1, r.name, OPP_LABEL[r.band], r.pen, national, r.gap, r.pop, r.res, r.headroom]));

  return (
    <div className="card" style={{ margin: '10px 0 0' }}>
      <button onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--ink)', font: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{collapsed ? '▸' : '▾'}</span>State ranking
      </button>
      {!collapsed ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, borderBottom: '1px solid var(--line)' }}>
            <span style={{ display: 'inline-flex', gap: 4 }}>{tabBtn('pen', 'Penetration /1k')}{tabBtn('headroom', 'Headroom')}</span>
            <button style={{ ...miniBtn, marginBottom: 4 }} title="Download this ranking (CSV)" onClick={exportCsv}>CSV</button>
          </div>
          <div style={{ maxHeight: 320, minHeight: 120, overflow: 'auto', resize: 'vertical' }}>
            <table className="opphl" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead><tr style={{ position: 'sticky', top: 0, background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
                <th title="Rank in this list" style={{ padding: '5px 6px', textAlign: 'center', color: 'var(--muted)', fontWeight: 600 }}>#</th>
                {th('name', 'State', 'State')}
                {th('band', 'Band', 'Leader / Mid / Under-penetrated / Floor, relative to the national rate')}
                {th('pop', 'Population', 'State resident population — US Census ACS 1-year')}
                {th('res', 'Home athletes', 'Distinct adult home-state athletes who race — counted by home state, wherever they raced')}
                {th('pen', 'Penetration /1k', 'Resident athletes ÷ population × 1,000 — home penetration per 1,000 residents')}
                {th('gap', 'Gap', 'Penetration minus the national rate (negative = below national)')}
                {th('headroom', 'Headroom', 'Estimated additional resident athletes to reach the national rate (gap × population)')}
              </tr></thead>
              <tbody>
                {sorted.map((r, i) => {
                  const on = sel === r.ab;
                  return (
                    <tr key={r.ab} onClick={() => onSelect(r.ab)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--line)', background: on ? (dark ? 'rgba(148,163,184,.20)' : 'rgba(15,23,42,.06)') : 'transparent' }}>
                      <td style={{ padding: '4px 6px', textAlign: 'center', color: 'var(--muted)' }}>{i + 1}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: on ? 700 : 400 }}>{r.name}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}><span title={OPP_LABEL[r.band]} style={{ width: 10, height: 10, borderRadius: 2, background: OPP_C[r.band], display: 'inline-block' }} /></td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>{fmtPop(r.pop)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>{fmtInt(r.res)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 700 }}>{f2(r.pen)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'center', color: r.gap < 0 ? OPP_TXT.floor : OPP_TXT.leader }}>{r.gap > 0 ? '+' : ''}{f2(r.gap)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 700 }}>{r.headroom ? '~' + fmtInt(r.headroom) : '—'}</td>
                    </tr>
                  );
                })}
                {!sorted.length ? <tr><td colSpan={8} className="muted small" style={{ padding: '8px 6px', textAlign: 'center' }}>{tab === 'headroom' ? 'No under-penetrated states in this selection.' : 'No penetration data for this selection.'}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>{tab === 'headroom' ? 'Headroom = additional resident athletes to reach the national rate (gap × population).' : 'All states by home penetration.'} Sortable columns · click a row to select · drag the list’s bottom edge to resize.</div>
        </div>
      ) : null}
    </div>
  );
}

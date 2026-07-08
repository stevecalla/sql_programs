import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

// Ops · Backends — live health of every routed backend. Mirrors the proxy console's Backends pane:
// same columns (# / Prefix / Port / Status / HTTP / ms / Error) + Target, sortable headers, and a
// persisted refresher (interval + pause + "now"). Read-only. Pings /api/ops/health.
const INTS = [[10, '10s'], [30, '30s'], [60, '1m'], [300, '5m'], [600, '10m'], [900, '15m'], [1800, '30m'], [3600, '1h']];
// [key, label, sortable]
const COLS = [
  ['n', '#', false],
  ['prefix', 'Prefix', true],
  ['port', 'Port', true],
  ['ok', 'Status', true],
  ['status', 'HTTP', true],
  ['ms', 'Latency (ms)', true],
  ['target', 'Target', true],
  ['error', 'Error', true],
];
const LS_SORT = 'usatapps_ops_backends_sort_v2';
const LS_REF = 'usatapps_ops_backends_refresh_15m';
function lsGet(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
function portOf(t) { const m = String(t || '').match(/:(\d+)(?:\/|$)/); return m ? Number(m[1]) : ''; }

export default function OpsBackends() {
  const [rows, setRows] = useState(null);
  const [when, setWhen] = useState('');
  const [allOk, setAllOk] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState(() => lsGet(LS_SORT, { key: 'prefix', dir: 1 }));
  const [refresh, setRefresh] = useState(() => lsGet(LS_REF, { sec: 900, paused: false }));
  const timer = useRef(null);

  const load = () => {
    setBusy(true); setErr('');
    api.opsHealth().then((r) => {
      setBusy(false);
      if (r.status === 200 && r.body.ok) {
        const data = (r.body.checked || []).map((c) => ({
          prefix: c.prefix, port: portOf(c.target), ok: c.ok,
          status: c.ok ? (c.status || '') : '', ms: c.ms, error: c.ok ? '' : (c.error || ''), target: c.target,
        }));
        setRows(data); setAllOk(!!r.body.all_ok); setWhen(new Date(r.body.time).toLocaleString());
      } else setErr(r.body.error || ('HTTP ' + r.status));
    }).catch((e) => { setBusy(false); setErr(String(e)); });
  };

  useEffect(() => { load(); }, []);
  // Auto-refresh (persisted interval + pause), same behavior as the proxy's refresher.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!refresh.paused && refresh.sec > 0) timer.current = setInterval(load, refresh.sec * 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const setSec = (sec) => { const n = { ...refresh, sec }; setRefresh(n); lsSet(LS_REF, n); };
  const setPaused = (paused) => { const n = { ...refresh, paused }; setRefresh(n); lsSet(LS_REF, n); };
  const clickCol = (key) => { const n = sort.key === key ? { key, dir: -sort.dir } : { key, dir: 1 }; setSort(n); lsSet(LS_SORT, n); };

  const sorted = useMemo(() => {
    if (!rows) return null;
    const k = sort.key;
    return rows.slice().sort((x, y) => {
      let xv = x[k], yv = y[k];
      if (k === 'ok') { xv = x.ok ? 1 : 0; yv = y.ok ? 1 : 0; }
      if (typeof xv === 'number' && typeof yv === 'number') return (xv - yv) * sort.dir;
      return String(xv == null ? '' : xv).localeCompare(String(yv == null ? '' : yv)) * sort.dir;
    });
  }, [rows, sort]);

  const arrow = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2>Backends</h2>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label className="small">Refresh&nbsp;
            <select value={refresh.sec} onChange={(e) => setSec(Number(e.target.value))}>
              {INTS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
            </select>
          </label>
          <label className="small" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={refresh.paused} onChange={(e) => setPaused(e.target.checked)} /> pause
          </label>
          <button className="btn" onClick={load} disabled={busy}>{busy ? 'Checking…' : '↻ now'}</button>
        </span>
      </div>
      <p className="muted small">
        Live health of each routed backend — pings the same endpoints the proxy's <code>/api/health</code> uses.
        {when ? ' Last checked: ' + when + ' · ' + (allOk ? 'all up' : 'some down') + '.' : ''}
      </p>
      {err ? <p className="err">{err}</p> : null}

      <div className="card">
        <table className="grid">
          <thead><tr>
            {COLS.map(([key, label, sortable]) => (
              <th key={key} style={{ textAlign: key === 'prefix' ? 'left' : 'center', ...(sortable ? { cursor: 'pointer' } : {}) }} onClick={sortable ? () => clickCol(key) : undefined}>{label}{sortable ? arrow(key) : ''}</th>
            ))}
          </tr></thead>
          <tbody>
            {!sorted ? <tr><td className="muted" colSpan={COLS.length}>Loading…</td></tr>
              : sorted.length === 0 ? <tr><td className="muted" colSpan={COLS.length}>No routes configured.</td></tr>
                : sorted.map((c, i) => (
                  <tr key={c.prefix}>
                    <td className="muted" style={{ textAlign: 'center' }}>{i + 1}</td>
                    <td><code>{c.prefix}</code></td>
                    <td style={{ textAlign: 'center' }}>{c.port || '—'}</td>
                    <td style={{ textAlign: 'center' }}><span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: c.ok ? 'rgba(22,121,74,.15)' : 'rgba(194,14,47,.15)', color: c.ok ? '#16794a' : 'var(--red)' }}>{c.ok ? 'UP' : 'DOWN'}</span></td>
                    <td style={{ textAlign: 'center' }}>{c.status || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{c.ms != null ? c.ms : '—'}</td>
                    <td className="muted small" style={{ textAlign: 'center' }}>{c.target}</td>
                    <td className="muted small" style={{ textAlign: 'center' }}>{c.error || ''}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

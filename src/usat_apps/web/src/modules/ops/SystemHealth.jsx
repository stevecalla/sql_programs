import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

// Ops · System health — host tiles (CPU/mem/swap/disk/PSI/temps), live commands, disk-usage explorer,
// crontab view/edit, daily health summary, and ubuntu update log. Mirrors the proxy console's pane.
const INTS = [[10, '10s'], [30, '30s'], [60, '1m'], [300, '5m'], [600, '10m'], [900, '15m'], [1800, '30m']];
const LS_REF = 'usatapps_ops_sys_refresh_15m';
function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
function gb(b) { return b == null ? '—' : (b / 1073741824).toFixed(1) + ' GiB'; }
function fmtUptime(sec) { if (sec == null) return '—'; const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600); return d ? d + 'd ' + h + 'h' : h + 'h ' + Math.floor((sec % 3600) / 60) + 'm'; }
function st(v, warn, bad) { if (v == null) return ''; if (v >= bad) return 'bad'; if (v >= warn) return 'warn'; return 'ok'; }
const badgeColor = { ok: ['rgba(22,121,74,.15)', '#16794a'], warn: ['rgba(212,146,10,.20)', '#b45309'], bad: ['rgba(194,14,47,.15)', '#c20e2f'] };

function Tile({ k, v, sub, state }) {
  const bc = state && badgeColor[state];
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
      <div className="muted small">{k}{bc ? <span style={{ marginLeft: 6, display: 'inline-block', padding: '0 6px', borderRadius: 999, fontSize: 9, fontWeight: 700, background: bc[0], color: bc[1] }}>{state === 'bad' ? 'HIGH' : state.toUpperCase()}</span> : null}</div>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{v}{sub ? <span className="muted small" style={{ fontWeight: 400 }}> {sub}</span> : null}</div>
    </div>
  );
}

function TermBox({ title, note, text, chips }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);   // collapsed by default
  const [big, setBig] = useState(false);
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="rail-group" style={{ padding: 0, textTransform: 'none', fontSize: 15, color: 'var(--ink)', width: 'auto', fontWeight: 700 }} onClick={() => setOpen((o) => !o)}>
          <span className="rail-caret" aria-hidden="true">{open ? '▾' : '▸'}</span> {title}{note ? <span className="muted small" style={{ fontWeight: 400 }}> — {note}</span> : null}
        </button>
        {open ? (
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => { if (ref.current) ref.current.scrollTop = 0; }}>⤒ top</button>
            <button className="btn" onClick={() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }}>⤓ bottom</button>
            <button className="btn" onClick={() => { try { navigator.clipboard.writeText(ref.current ? ref.current.innerText : ''); } catch (e) { /* ignore */ } }}>copy</button>
            <button className="btn" onClick={() => setBig((b) => !b)}>{big ? '⤢ shrink' : '⤢ expand'}</button>
          </span>
        ) : null}
      </div>
      {open ? (
        <>
          {chips ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '8px 0 0' }}>{chips}</div> : null}
          <div ref={ref} className="term" style={{ height: big ? 520 : 220, marginTop: 8 }}>{text}</div>
        </>
      ) : null}
    </div>
  );
}

export default function OpsSystemHealth() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [refresh, setRefresh] = useState(() => lsGet(LS_REF, { sec: 900, paused: false }));
  const [cmds, setCmds] = useState([]);
  const [cmdOut, setCmdOut] = useState('Pick a command above.');
  const [duPaths, setDuPaths] = useState([]);
  const [duOut, setDuOut] = useState('Pick a path above. Protected dirs (e.g. /var/lib/mysql) need sudo — run those in a terminal for exact numbers.');
  const [cron, setCron] = useState('');
  const [cronOpen, setCronOpen] = useState(false);   // collapsed by default
  const [cronEdit, setCronEdit] = useState(false);
  const [cronDraft, setCronDraft] = useState('');
  const [cronMsg, setCronMsg] = useState('');
  const timer = useRef(null);

  const load = () => { api.opsSystem().then((r) => { if (r.status === 200 && r.body.ok) setS(r.body); else setErr(r.body.error || ('HTTP ' + r.status)); }).catch((e) => setErr(String(e))); };
  const loadCron = () => { api.opsCron().then((r) => { if (r.status === 200 && r.body.ok) setCron(r.body.crontab || ''); }).catch(() => {}); };
  useEffect(() => {
    load(); loadCron();
    api.opsSystemCmds().then((r) => { if (r.status === 200 && r.body.ok) setCmds(r.body.cmds || []); }).catch(() => {});
    api.opsSystemDuPaths().then((r) => { if (r.status === 200 && r.body.ok) setDuPaths(r.body.paths || []); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!refresh.paused && refresh.sec > 0) timer.current = setInterval(load, refresh.sec * 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);
  const setSec = (sec) => { const n = { ...refresh, sec }; setRefresh(n); lsSet(LS_REF, n); };
  const setPaused = (p) => { const n = { ...refresh, paused: p }; setRefresh(n); lsSet(LS_REF, n); };

  const runCmd = (name) => { setCmdOut('Running ' + name + '…'); api.opsSystemCmd(name).then((r) => setCmdOut((r.body && (r.body.output || r.body.error)) || 'no output')).catch((e) => setCmdOut(String(e))); };
  const runDu = (p) => { setDuOut('Scanning ' + p + '…'); api.opsSystemDu(p).then((r) => setDuOut((r.body && (r.body.output || r.body.error)) || 'no output')).catch((e) => setDuOut(String(e))); };
  const saveCron = () => {
    setCronMsg('Saving…');
    api.opsCronSave(cronDraft).then((r) => {
      if (r.status === 200 && r.body.ok) { setCronMsg('Saved (backup ' + r.body.backup + ').'); setCronEdit(false); loadCron(); }
      else setCronMsg(r.body.error || ('HTTP ' + r.status));
    }).catch((e) => setCronMsg(String(e)));
  };

  const m = s && s.memory, sw = s && s.swap, c = s && s.cpu, d = s && s.disk, psi = s && s.psi;
  const chip = { padding: '2px 10px', border: '1px solid var(--line)', borderRadius: 999, background: 'var(--panel)', color: 'var(--ink)', cursor: 'pointer', fontSize: 12 };

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>System health {s ? <span className="muted small" style={{ fontWeight: 400 }}>— {s.host}</span> : null}</h2>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label className="small">Refresh <select value={refresh.sec} onChange={(e) => setSec(Number(e.target.value))}>{INTS.map(([x, l]) => <option key={x} value={x}>{l}</option>)}</select></label>
          <label className="small" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={refresh.paused} onChange={(e) => setPaused(e.target.checked)} /> pause</label>
          <button className="btn" onClick={load}>↻ now</button>
        </span>
      </div>
      {err ? <p className="err">{err}</p> : null}

      <div className="card">
        {!s ? <div className="muted">Loading…</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {m ? <Tile k="Memory used" v={(m.used_pct != null ? m.used_pct + '%' : '—')} sub={gb(m.used) + ' / ' + gb(m.total)} state={st(m.used_pct, 80, 92)} /> : null}
            {m ? <Tile k="Available" v={gb(m.available)} /> : null}
            {sw ? <Tile k="Swap used" v={sw.used_pct + '%'} sub={gb(sw.used) + ' / ' + gb(sw.total)} state={st(sw.used_pct, 60, 85)} /> : null}
            {c ? <Tile k="CPU load (1/5/15m)" v={c.load1 + ' / ' + c.load5 + ' / ' + c.load15} state={st(c.util_pct, 70, 90)} /> : null}
            {c ? <Tile k="CPU util · cores" v={(c.util_pct != null ? c.util_pct + '%' : '—')} sub={'· ' + c.cores + ' cores'} /> : null}
            {d ? <Tile k="Disk / used" v={d.used_pct + '%'} sub={gb(d.used) + ' / ' + gb(d.total)} state={st(d.used_pct, 80, 92)} /> : null}
            {psi && psi.memory ? <Tile k="Mem pressure (avg10)" v={'some ' + psi.memory.some + ' · full ' + psi.memory.full} state={st(psi.memory.some, 5, 20)} /> : null}
            {s.temps ? Object.keys(s.temps).map((t) => <Tile key={t} k={'Temp · ' + t} v={s.temps[t] + '°C'} state={st(s.temps[t], 75, 90)} />) : null}
            <Tile k="Uptime" v={fmtUptime(s.uptime_sec)} />
          </div>
        )}
      </div>

      <TermBox title="Live commands" text={cmdOut}
        chips={cmds.map((cc) => <button key={cc.id} style={chip} onClick={() => runCmd(cc.id)} title={cc.interactive ? 'terminal only' : ''}>{cc.label}{cc.interactive ? ' ⎘' : ''}</button>)} />

      <TermBox title="Disk usage explorer" text={duOut}
        chips={duPaths.concat(['journal']).map((p) => <button key={p} style={chip} onClick={() => runDu(p)}>{p}</button>)} />

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="rail-group" style={{ padding: 0, textTransform: 'none', fontSize: 15, color: 'var(--ink)', width: 'auto', fontWeight: 700 }} onClick={() => setCronOpen((o) => !o)}>
            <span className="rail-caret" aria-hidden="true">{cronOpen ? '▾' : '▸'}</span> Cron schedule
          </button>
          {cronOpen ? (
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {!cronEdit ? <button className="btn" onClick={() => { setCronDraft(cron); setCronEdit(true); setCronMsg(''); }}>✎ edit</button>
                : (<><button className="btn primary" onClick={saveCron}>Save</button><button className="btn" onClick={() => { setCronEdit(false); setCronMsg(''); }}>Cancel</button></>)}
            </span>
          ) : null}
        </div>
        {cronOpen ? (
          <>
            {cronMsg ? <p className="muted small" style={{ marginTop: 6 }}>{cronMsg}</p> : null}
            {cronEdit
              ? <textarea value={cronDraft} onChange={(e) => setCronDraft(e.target.value)} spellCheck={false} style={{ width: '100%', height: 300, marginTop: 8, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12 }} />
              : <div className="term" style={{ height: 300, marginTop: 8 }}>{cron || '(loading crontab…)'}</div>}
          </>
        ) : null}
      </div>

      {s && s.summary ? <TermBox title="Daily health summary" note={s.summary.mtime ? new Date(s.summary.mtime).toLocaleString() : ''} text={s.summary.text} /> : null}
      {s && s.ubuntu ? <TermBox title="Ubuntu update log" note={s.ubuntu.mtime ? new Date(s.ubuntu.mtime).toLocaleString() : ''} text={s.ubuntu.text} /> : null}
    </div>
  );
}

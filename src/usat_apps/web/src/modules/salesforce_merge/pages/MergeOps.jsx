// Merge Ops — admin-only panel (grantable in Users & Access via the `merge-ops` key). Phase 3:
//  (1) live settings editor — parallel on/off, chunk size, max batch, worker target, async-Apex cap —
//      DB-backed so edits take effect with no env change or redeploy;
//  (2) live worker/queue view — queue depth, workers actively draining, held (paused), active jobs.
// Batch-run control is a fast-follow. All actions emit tracking (panel: 'merge-ops').
import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { track } from '../../../lib/track.js';
import '../merge.css';

// Human labels + help for each setting key (kind comes from the server: 'bool' | 'int').
const META = {
  parallel_enabled: { label: 'Parallel enabled', help: 'Master on/off. When on, big jobs fan out into parallel batches; off = one run per job (kill switch).' },
  chunk_size: { label: 'Chunk size', help: 'Sets per parallel batch. Lower = more, smaller batches = more fan-out (1–50).' },
  max_batch: { label: 'Max sets per job', help: 'Cap on how many sets one Execute may run (hard-capped at 500).' },
  worker_target: { label: 'Worker target', help: 'Desired cluster size (1–8). Informational until on-the-fly scaling; start the cluster with pm2.' },
  apex_stop_enabled: { label: 'Async-Apex cap enabled', help: 'When on, a job pauses if async-Apex usage reaches the threshold (resumable).' },
  apex_stop_threshold: { label: 'Async-Apex cap (used)', help: 'Pause when DailyAsyncApexExecutions used reaches this. 200k leaves 50k headroom under the 250k cap.' },
};
const ORDER = ['parallel_enabled', 'chunk_size', 'max_batch', 'worker_target', 'apex_stop_enabled', 'apex_stop_threshold'];

// Format an MTN wall-clock string ('YYYY-MM-DD HH:MM:SS', already in Mountain Time) without any tz math.
function friendlyMtn(mtn) {
  if (!mtn) return 'never';
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(mtn));
  if (!m) return String(mtn);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let h = Number(m[4]); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}, ${h}:${m[5]} ${ap} MT`;
}

function sourceTag(src) {
  const map = { db: { t: 'saved', c: 'var(--green)' }, env: { t: 'env', c: 'var(--amber)' }, default: { t: 'default', c: 'var(--dim)' } };
  const s = map[src] || map.default;
  return <span className="pill" style={{ borderColor: s.c, color: s.c }}>{s.t}</span>;
}

export default function MergeOps() {
  const [settings, setSettings] = useState(null);   // { key: { value, source, def, kind } }
  const [draft, setDraft] = useState({});            // edited values, keyed by setting
  const [workers, setWorkers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [lastSaved, setLastSaved] = useState(null);

  const loadSettings = useCallback(() => {
    setBusy(true); setErr('');
    api.opsSettings()
      .then((r) => { setSettings(r.settings || {}); setDraft({}); setLastSaved(r.last_saved || null); })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  }, []);

  const loadWorkers = useCallback(() => {
    api.opsWorkers().then((r) => setWorkers(r.workers || null)).catch(() => {});
  }, []);

  useEffect(() => { track('merge_ops_view', { panel: 'merge-ops', view: 'ops' }); loadSettings(); loadWorkers(); }, [loadSettings, loadWorkers]);
  // Poll the worker/queue view every 5s so it stays live while jobs drain.
  useEffect(() => { const t = setInterval(loadWorkers, 5000); return () => clearInterval(t); }, [loadWorkers]);

  const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = Object.keys(draft).length > 0;

  const save = () => {
    if (!dirty) return;
    setSaving(true); setErr(''); setMsg('');
    api.opsSettingsSave(draft)
      .then((r) => {
        setSettings(r.settings || {}); setDraft({}); setLastSaved(r.last_saved || null);
        setMsg('Saved ' + Object.keys(r.stored || {}).join(', '));
        track('merge_ops_save', { panel: 'merge-ops', view: 'settings', keys: Object.keys(draft).join(',') });
        setTimeout(() => setMsg(''), 4000);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setSaving(false));
  };

  const curVal = (key) => (Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : (settings && settings[key] ? settings[key].value : ''));

  return (
    <div className="sfmerge">
      <div className="mx-ph"><h2>Merge Ops</h2><span className="muted small">admin · live tuning + worker view</span></div>
      {err ? <div className="err">{err}</div> : null}

      {/* ---- Live settings ---- */}
      <section className="mx-panel">
        <h2>Settings</h2>
        <p className="muted small">DB-backed — edits take effect on the next job, no redeploy. Values resolve DB → env → default; the tag shows where each current value comes from.</p>
        {!settings ? <p className="muted">{busy ? 'Loading…' : '—'}</p> : (
          <table className="mx-panel-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Setting</th><th style={{ textAlign: 'left' }}>Value</th><th style={{ textAlign: 'left' }}>Source</th><th style={{ textAlign: 'left' }}>Default</th></tr></thead>
            <tbody>
              {ORDER.filter((k) => settings[k]).map((k) => {
                const s = settings[k]; const meta = META[k] || { label: k, help: '' };
                const changed = Object.prototype.hasOwnProperty.call(draft, k);
                return (
                  <tr key={k} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px 8px 0' }}><strong>{meta.label}</strong><div className="muted small">{meta.help}</div></td>
                    <td style={{ padding: '8px 10px 8px 0' }}>
                      {s.kind === 'bool'
                        ? <label className="small"><input type="checkbox" checked={!!curVal(k)} onChange={(e) => setField(k, e.target.checked)} /> {curVal(k) ? 'on' : 'off'}</label>
                        : <input type="number" value={curVal(k)} onChange={(e) => setField(k, e.target.value)} style={{ width: 120 }} />}
                      {changed ? <span className="pill" style={{ marginLeft: 8, borderColor: 'var(--accent)', color: 'var(--accent)' }}>edited</span> : null}
                    </td>
                    <td style={{ padding: '8px 10px 8px 0' }}>{sourceTag(s.source)}</td>
                    <td className="muted small" style={{ padding: '8px 0' }}>{String(s.def)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn primary" style={{ width: 'auto' }} disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button className="btn" style={{ width: 'auto' }} disabled={busy} onClick={() => { track('merge_ops_refresh', { panel: 'merge-ops', view: 'settings' }); loadSettings(); }}>Refresh</button>
          <span className="muted small">Last saved: {friendlyMtn(lastSaved)}</span>
          {msg ? <span className="small" style={{ color: 'var(--green)' }}>{msg}</span> : null}
          {dirty ? <span className="muted small">unsaved changes</span> : null}
        </div>
      </section>

      {/* ---- Live workers / queue ---- */}
      <section className="mx-panel">
        <h2>Workers &amp; queue</h2>
        <p className="muted small">Live (5s). "Workers active" counts pm2 instances currently draining a run — idle-but-online instances aren&apos;t shown here. The cluster size is set with <code>pm2 scale salesforce_merge_worker N</code>.</p>
        {!workers ? <p className="muted">—</p> : (
          <div className="mx-cards">
            <div className="mx-card"><div className="k">Workers active</div><div className="v">{workers.workers_active}</div><div className="s">{workers.workers.join(', ') || 'none draining'}</div></div>
            <div className="mx-card"><div className="k">Queued</div><div className="v">{workers.queued}</div><div className="s">waiting to be claimed</div></div>
            <div className="mx-card"><div className="k">Running</div><div className="v">{workers.running}</div><div className="s">chunk-runs in flight</div></div>
            <div className="mx-card"><div className="k">Held (paused)</div><div className="v">{workers.held}</div><div className="s">resume from a job</div></div>
            <div className="mx-card"><div className="k">Active jobs</div><div className="v">{workers.active_jobs}</div><div className="s">fanned-out jobs</div></div>
          </div>
        )}
      </section>
    </div>
  );
}

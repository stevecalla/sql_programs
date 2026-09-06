// Merge Ops — admin-only panel (grantable in Users & Access via the `merge-ops` key). Folder tabs:
//   Settings  — live-tunable parallel/chunk/max-batch/worker-target/Apex-cap (DB-backed, no redeploy).
//   Batch run — launch a MERGE job (+ optional RESTORE phase) through the real fan-out path, two modes:
//               Approved (run the approved queue) or Random sample (seeded stress pick, like menu 32).
//   Workers   — live queue/worker view + on-the-fly pm2 cluster scaling.
// All actions emit tracking (panel: 'merge-ops').
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { track } from '../../../lib/track.js';
import LiveLog from '../../../components/LiveLog.jsx';
import { FilterSelect, FILTER_TIP, FILTER_OPTS, sizeOptions } from '../components/MergeFilters.jsx';
import '../merge.css';

const META = {
  parallel_enabled: { label: 'Parallel enabled', help: 'Master on/off. On = big jobs fan out into parallel batches; off = one run per job (kill switch).' },
  chunk_size: { label: 'Chunk size', help: 'Sets per parallel batch. Lower = more, smaller batches = more fan-out (1–50).' },
  max_batch: { label: 'Max sets per run (default)', help: 'Default cap on how many sets one Execute runs. Seeds the Process Merges box; a run can dial up to the hard cap below.' },
  max_batch_hard: { label: 'Max sets per run (hard cap)', help: 'Absolute ceiling no run can exceed — the default above is clamped to this. Env MERGE_MAX_BATCH_HARD; raise deliberately.' },
  worker_target: { label: 'Worker target', help: 'Desired cluster size (1–8). Set live from the Workers tab (pm2 scale).' },
  apex_stop_enabled: { label: 'Async-Apex cap enabled', help: 'When on, a job pauses if async-Apex usage reaches the threshold (resumable). Note: async-Apex is deferred, so this often reads ~0 during a run — the daily-API cap below is the live governor.' },
  apex_stop_threshold: { label: 'Async-Apex cap (used)', help: 'Pause when DailyAsyncApexExecutions used reaches this. 200k leaves 50k headroom under the 250k cap.' },
  api_stop_enabled: { label: 'Daily-API cap enabled', help: 'When on, a job pauses if DailyApiRequests usage reaches the threshold (resumable). This counter moves live, so unlike the apex cap it can actually fire mid-run. Independent of the apex cap.' },
  api_stop_threshold: { label: 'Daily-API cap (used)', help: (v) => { const n = Number(v) || 0; return 'Pause when DailyApiRequests used reaches this. Prod cap is ~410,000 (' + n.toLocaleString() + ' ≈ ' + Math.round((n / 410000) * 100) + '%); sandbox is ~5,000,000.'; } },
};
const ORDER = ['parallel_enabled', 'chunk_size', 'max_batch', 'max_batch_hard', 'worker_target', 'apex_stop_enabled', 'apex_stop_threshold', 'api_stop_enabled', 'api_stop_threshold'];

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
function statusColor(s) { return s === 'done' ? 'var(--green)' : s === 'error' ? 'var(--red)' : s === 'paused' ? 'var(--amber)' : 'var(--ink)'; }
function fmtSec(s) { if (s == null) return '—'; return s >= 60 ? Math.floor(s / 60) + 'm ' + String(s % 60) + 's' : s + 's'; }
// Median seconds-per-merge across the batches (concurrency-proof) + slowest batch time.
function batchStats(runs) {
  const rs = (runs || []).filter((r) => r.seconds != null);
  const perMerge = rs.map((r) => (r.total_sets ? r.seconds / r.total_sets : null)).filter((x) => x != null).sort((a, b) => a - b);
  const m = perMerge.length ? (perMerge.length % 2 ? perMerge[(perMerge.length - 1) / 2] : (perMerge[perMerge.length / 2 - 1] + perMerge[perMerge.length / 2]) / 2) : null;
  const slowest = rs.length ? Math.max(...rs.map((r) => r.seconds)) : null;
  return { sec_per_merge: m != null ? Math.round(m * 10) / 10 : null, slowest };
}

// One job's live progress block (used for both the Merge and Restore phases).
function JobProgress({ title, prog, report, onCancel, onResume }) {
  if (!prog) return null;
  const st = batchStats(prog.runs);
  const rows = prog.runs || [];
  return (
    <div style={{ marginTop: 12 }}>
      <div className="small"><strong>{title}</strong> · {prog.job_id} · <span style={{ color: statusColor(prog.status) }}>{prog.status}</span></div>
      <div className="mx-cards" style={{ marginTop: 8 }}>
        <div className="mx-card"><div className="k">Sets</div><div className="v">{prog.completed_sets}/{prog.total_sets}</div><div className="s">{prog.runs_done}/{prog.runs_total} batches</div></div>
        <div className="mx-card"><div className="k">Workers</div><div className="v">{prog.workers_active}</div><div className="s">draining now</div></div>
        <div className="mx-card"><div className="k">Total time</div><div className="v">{fmtSec(prog.total_seconds)}</div><div className="s">first start → last finish</div></div>
        <div className="mx-card"><div className="k">Sec / merge</div><div className="v">{st.sec_per_merge != null ? st.sec_per_merge : '—'}</div><div className="s">median batch</div></div>
        <div className="mx-card"><div className="k">Slowest batch</div><div className="v">{fmtSec(st.slowest)}</div><div className="s">longest run</div></div>
        <div className="mx-card"><div className="k">Held</div><div className="v">{prog.runs_held || 0}</div><div className="s">paused batches</div></div>
      </div>
      {rows.length ? (
        <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8, border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
          <table className="modal-table" style={{ width: '100%', fontSize: 12 }}>
            <thead><tr>{['Batch', 'Worker', 'Sets', 'Time', 'Status'].map((h) => <th key={h} style={{ textAlign: 'left', position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.run_id}>
                  <td>{r.batch_index || '—'}/{r.batch_total || rows.length}</td>
                  <td>{r.worker || '—'}</td>
                  <td>{r.completed_sets}/{r.total_sets}</td>
                  <td>{fmtSec(r.seconds)}</td>
                  <td style={{ color: statusColor(r.status) }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
        <button className="btn" style={{ width: 'auto' }} disabled={prog.status !== 'running'} onClick={onCancel}>Cancel</button>
        <button className="btn" style={{ width: 'auto' }} disabled={prog.status !== 'paused'} onClick={onResume}>Resume</button>
      </div>
      {report ? <p className="small muted" style={{ marginTop: 6 }}>Report: <span className="mono">{report}</span> (+ sweep row)</p> : null}
    </div>
  );
}

export default function MergeOps() {
  const [tab, setTab] = useState('settings');
  // settings
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [lastSaved, setLastSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  // workers + scaling
  const [workers, setWorkers] = useState(null);
  const [pm2, setPm2] = useState(null);
  const [scaleN, setScaleN] = useState('');
  const [scaleBusy, setScaleBusy] = useState(false);
  const [scaleMsg, setScaleMsg] = useState('');
  // batch run
  // Run-option choices persist across navigation (they're component state that would otherwise reset on
  // remount). Rehydrate from localStorage on mount; a small effect below re-saves them on any change.
  const readPref = (k, dflt) => { try { const p = JSON.parse(localStorage.getItem('sm_batch_prefs') || '{}'); return (p && Object.prototype.hasOwnProperty.call(p, k)) ? p[k] : dflt; } catch (e) { return dflt; } };
  const [batchMode, setBatchMode] = useState(() => readPref('batch_mode', 'approved'));   // 'approved' | 'random'
  const [runMode, setRunMode] = useState(() => readPref('run_mode', 'simulate'));        // 'simulate' | 'execute'
  const [restoreAfter, setRestoreAfter] = useState(() => !!readPref('restore_after', false));
  const [stampMerged, setStampMerged] = useState(() => readPref('stamp_merged', true) !== false);   // stamp usat_was_* on the survivor (parity with Process Merges)
  const [attachDossier, setAttachDossier] = useState(() => { try { return localStorage.getItem('mp_attach_dossier') !== '0'; } catch (e) { return true; } });
  const [approved, setApproved] = useState(null);
  const [approvedRows, setApprovedRows] = useState([]);
  const [rSource, setRSource] = useState(() => readPref('r_source', 'duplicate'));
  const [rSize, setRSize] = useState(() => readPref('r_size', ''));   // merge-id: exact group size (matches Select Merges' Size)
  const [rCount, setRCount] = useState(() => readPref('r_count', '10'));
  const [rSeed, setRSeed] = useState(() => readPref('r_seed', ''));   // persisted as typed; blank = new random each run
  const [rFoundation, setRFoundation] = useState(() => readPref('r_foundation', ''));   // '' any | 'has' | 'none'
  const [rPortal, setRPortal] = useState(() => readPref('r_portal', ''));           // '' any | 'has' | 'none' (Customer-Portal account in the set)
  const [rTier, setRTier] = useState(() => readPref('r_tier', ''));
  const [rSignal, setRSignal] = useState(() => readPref('r_signal', ''));
  const [rWhichList, setRWhichList] = useState(() => readPref('r_which_list', ''));
  const [rBucket, setRBucket] = useState(() => readPref('r_bucket', ''));
  const [rMinSim, setRMinSim] = useState(() => readPref('r_min_sim', ''));
  const [rMergeId, setRMergeId] = useState(() => readPref('r_merge_id', ''));
  const [rMember, setRMember] = useState(() => readPref('r_member', ''));
  // Queue filter — mirrors Select Merges' "Queue" filter exactly ('' all | 'unstaged' hide queued/merged |
  // 'staged' only queued/merged). Defaults to 'All', matching the Select Merges Queue default (parity).
  // Pick 'Not staged' when you want the sample to skip sets already queued/merged and run fresh merges.
  const [rQueueFilter, setRQueueFilter] = useState(() => readPref('r_queue_filter', ''));
  const [rSearch, setRSearch] = useState(() => readPref('r_search', ''));   // name/id search — same pool narrowing as Select Merges' list search
  const [facets, setFacets] = useState({});
  const [matchCount, setMatchCount] = useState(null);   // live "N sets match these filters"
  const [matchAccounts, setMatchAccounts] = useState(null);   // account companion (parity with Select Merges)
  // activity logs
  const [logsOpen, setLogsOpen] = useState(false);
  const [logScope, setLogScope] = useState('all');   // 'all' = full pm2 log; or a specific process name
  const [restorable, setRestorable] = useState(null);   // sets already merged and now ready to restore
  const [runBusy, setRunBusy] = useState(false);
  const [runErr, setRunErr] = useState('');
  const [runNote, setRunNote] = useState('');
  const [runIds, setRunIds] = useState(null);
  const [mergeJobId, setMergeJobId] = useState(null);
  const [mergeProg, setMergeProg] = useState(null);
  const [runKind, setRunKind] = useState(null);   // 'parallel' (fanned out) | 'single' (one run)
  const [restoreJobId, setRestoreJobId] = useState(null);
  const [restoreProg, setRestoreProg] = useState(null);
  const [mergeReport, setMergeReport] = useState(null);
  const [restoreReport, setRestoreReport] = useState(null);
  const [stagedSeed, setStagedSeed] = useState(null);   // the random seed used (shown in UI + report Seed column)
  // Fire-once guards (immune to the async state lag that made the pollers write duplicate reports/restores).
  const restoreStartedRef = useRef(false);
  const mergeReportedRef = useRef(false);
  const restoreReportedRef = useRef(false);

  const loadSettings = useCallback(() => {
    setBusy(true); setErr('');
    api.opsSettings().then((r) => { setSettings(r.settings || {}); setDraft({}); setLastSaved(r.last_saved || null); })
      .catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }, []);
  const loadWorkers = useCallback(() => { api.opsWorkers().then((r) => setWorkers(r.workers || null)).catch(() => {}); }, []);
  const loadPm2 = useCallback(() => { api.opsPm2().then((r) => setPm2(r)).catch(() => setPm2(null)); }, []);
  const loadApproved = useCallback(() => { api.mergeQueue('approved').then((r) => { const rows = r.rows || []; setApproved(rows.length); setApprovedRows(rows); }).catch(() => { setApproved(null); setApprovedRows([]); }); }, []);
  // Sets already merged and now sitting in "ready to restore" (checks the Recycle Bin, so a touch slower).
  const loadRestorable = useCallback(() => { api.mergeRestoreList().then((r) => setRestorable(r.rows || [])).catch(() => setRestorable([])); }, []);

  useEffect(() => { track('merge_ops_view', { panel: 'merge-ops', view: 'ops' }); loadSettings(); loadWorkers(); loadPm2(); loadApproved(); loadRestorable(); }, [loadSettings, loadWorkers, loadPm2, loadApproved, loadRestorable]);
  useEffect(() => { const t = setInterval(loadWorkers, 5000); return () => clearInterval(t); }, [loadWorkers]);
  // Reattach to an IN-FLIGHT job when you return to this panel. The job keeps running in the worker
  // cluster after you navigate away; without this the live progress panel comes back blank. Runs once on
  // mount, and only reattaches to a still-running job (never resurrects an old finished one). Mirrors the
  // Restore page's resume-on-mount. The existing job-progress poll effect takes over from here.
  useEffect(() => {
    // Reattach to the panel's last job — RUNNING or already FINISHED — from the persisted context, so
    // returning always re-shows it (a running job keeps polling live; a finished one shows its final
    // summary). It stays until you launch a new run or click "Reset panel". restore_job_id (+ the started
    // flag) prevents the restore-afterward chain from re-firing on a reattach.
    try {
      const saved = JSON.parse(localStorage.getItem('sm_active_batch') || 'null');
      if (saved && saved.job_id) {
        setMergeJobId(saved.job_id); setRunKind('parallel');
        if (saved.run_ids) setRunIds(saved.run_ids);
        if (saved.seed != null) setStagedSeed(saved.seed);
        if (saved.restore_job_id) { setRestoreJobId(saved.restore_job_id); restoreStartedRef.current = true; }
      }
    } catch (e) { /* ignore */ }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps  (runs on every mount → re-shows the last job)
  // Persist the whole batch form so it survives navigating away and back — run-option toggles PLUS the
  // sample/filter inputs (count, size range, seed-as-typed, and every filter dropdown).
  useEffect(() => {
    try {
      localStorage.setItem('sm_batch_prefs', JSON.stringify({
        batch_mode: batchMode, run_mode: runMode, restore_after: restoreAfter, stamp_merged: stampMerged, attach_dossier: attachDossier,
        r_source: rSource, r_count: rCount, r_seed: rSeed,
        r_foundation: rFoundation, r_portal: rPortal, r_tier: rTier, r_signal: rSignal,
        r_which_list: rWhichList, r_bucket: rBucket, r_min_sim: rMinSim, r_merge_id: rMergeId, r_member: rMember, r_size: rSize,
        r_queue_filter: rQueueFilter, r_search: rSearch,
      }));
    } catch (e) { /* ignore */ }
  }, [batchMode, runMode, restoreAfter, stampMerged, attachDossier, rSource, rCount, rSeed, rFoundation, rPortal, rTier, rSignal, rWhichList, rBucket, rMinSim, rMergeId, rMember, rSize, rQueueFilter, rSearch]);
  // Record the restore job id onto the persisted run so a reattach re-shows the restore phase (and doesn't re-fire it).
  const persistRestoreJobId = (id) => { try { const s = JSON.parse(localStorage.getItem('sm_active_batch') || 'null'); if (s) { s.restore_job_id = id; localStorage.setItem('sm_active_batch', JSON.stringify(s)); } } catch (e) { /* ignore */ } };
  const isTerminal = (s) => s === 'done' || s === 'error' || s === 'cancelled';   // 'paused' is NOT terminal (resumable)
  // Poll the merge phase — STOP once terminal so mergeProg stops churning (that churn caused duplicate reports).
  useEffect(() => {
    if (!mergeJobId) return undefined;
    let stop = false; let t = null;
    const tick = () => api.mergeJobProgress(mergeJobId).then((r) => { if (stop) return; const j = r.job || null; setMergeProg(j); if (j && isTerminal(j.status)) { stop = true; if (t) clearInterval(t); } }).catch(() => {});
    tick(); t = setInterval(() => { if (!stop) tick(); }, 2000);
    return () => { stop = true; if (t) clearInterval(t); };
  }, [mergeJobId]);
  // Poll the restore phase — same stop-on-terminal.
  useEffect(() => {
    if (!restoreJobId) return undefined;
    let stop = false; let t = null;
    const tick = () => api.mergeJobProgress(restoreJobId).then((r) => { if (stop) return; const j = r.job || null; setRestoreProg(j); if (j && isTerminal(j.status)) { stop = true; if (t) clearInterval(t); } }).catch(() => {});
    tick(); t = setInterval(() => { if (!stop) tick(); }, 2000);
    return () => { stop = true; if (t) clearInterval(t); };
  }, [restoreJobId]);
  // Auto-start the RESTORE phase once the merge phase finishes (fire-once via ref).
  useEffect(() => {
    if (restoreAfter && mergeProg && mergeProg.status === 'done' && runIds && runIds.length && !restoreJobId && !restoreStartedRef.current) {
      restoreStartedRef.current = true;
      api.opsBatchRestore(runIds, { mode: runMode, stamp_merged: stampMerged, attach_dossier: attachDossier })
        .then((r) => { if (r.job_id) { setRestoreJobId(r.job_id); persistRestoreJobId(r.job_id); } else setRunNote('Restore ran as a single run (parallel off).'); })
        .catch((e) => { setRunErr('restore: ' + e.message); restoreStartedRef.current = false; });
    }
  }, [mergeProg, restoreAfter, runIds, restoreJobId, runMode]);
  useEffect(() => { if (mergeProg && mergeProg.status !== 'running') loadWorkers(); }, [mergeProg, loadWorkers]);
  // When the merge job finishes, the sets it consumed are no longer "approved" — they moved to merged /
  // ready-to-restore. Refresh the approved list + count so the Approved-sets view reflects that transition
  // (previously it kept showing the just-merged sets as still approved until a manual refresh).
  useEffect(() => { if (mergeProg && isTerminal(mergeProg.status)) { loadApproved(); loadRestorable(); } }, [mergeProg, loadApproved, loadRestorable]);
  useEffect(() => { if (restoreProg && isTerminal(restoreProg.status)) { loadApproved(); loadRestorable(); } }, [restoreProg, loadApproved, loadRestorable]);
  // Finalize into the workbook + sweep row EXACTLY ONCE (fire-once via refs). With "Restore afterward",
  // both phases fold into ONE workbook (merge tabs + Restores tab) after the restore finishes; otherwise
  // the merge reports alone, and a manual restore reports on its own.
  useEffect(() => {
    if (restoreAfter) return;   // combined report is handled below when the restore phase completes
    if (mergeJobId && mergeProg && isTerminal(mergeProg.status) && !mergeReportedRef.current) {
      mergeReportedRef.current = true;
      api.mergeJobReport(mergeJobId, { seed: stagedSeed }).then((r) => setMergeReport(r.report || null)).catch(() => { mergeReportedRef.current = false; });
    }
  }, [mergeProg, mergeJobId, restoreAfter, stagedSeed]);
  useEffect(() => {
    if (!restoreJobId || !restoreProg || !isTerminal(restoreProg.status) || restoreReportedRef.current) return;
    restoreReportedRef.current = true;
    if (restoreAfter && mergeJobId) {
      // one combined workbook: merge job + the restore job folded in as the Restores tab
      api.mergeJobReport(mergeJobId, { restore_job_id: restoreJobId, seed: stagedSeed }).then((r) => setMergeReport(r.report || null)).catch(() => { restoreReportedRef.current = false; });
    } else {
      // manual restore (no prior auto-restore) — restore reports on its own
      api.mergeJobReport(restoreJobId, { seed: stagedSeed }).then((r) => setRestoreReport(r.report || null)).catch(() => { restoreReportedRef.current = false; });
    }
  }, [restoreProg, restoreJobId, restoreAfter, mergeJobId, stagedSeed]);
  // Fetch the selected list's facets (same source as the Select Merges filters) for the Random-mode dropdowns.
  useEffect(() => {
    if (batchMode !== 'random') return;
    const p = rSource === 'merge-id'
      ? api.mergeIdFacets({ q: rSearch, bucket: rBucket, foundation_state: rFoundation, portal_state: rPortal, which_list: rWhichList })
      : api.duplicatesFacets({ q: rSearch, merge_id_state: rMergeId, member_number_state: rMember, foundation_state: rFoundation, portal_state: rPortal, match_type: rSignal, best_min: rMinSim, tier: rTier });
    p.then((r) => { const f = r.facets || {}; setFacets({ ...f, ...(f.filter_counts || {}) }); }).catch(() => setFacets({}));   // size + per-option counts, scoped to the active filters
  }, [batchMode, rSource, rSearch, rBucket, rFoundation, rPortal, rWhichList, rMergeId, rMember, rSignal, rMinSim, rTier]);
  // Build the filter set the same way Select Merges does (filter_cols + filter_map keys) — shared by the
  // live count and the run.
  const buildFilters = () => {
    const filters = {}; const colFilters = {};
    if (rSource === 'duplicate') {
      if (rSize) filters.size_eq = rSize;            // exact cluster size — same as Select Merges' Size
      if (rTier) filters.tier = rTier;               // exact|fuzzy|nickname
      if (rSignal) filters.match_type = rSignal;     // exact|fuzzy|nickname (involves)
      if (rMinSim) filters.best_min = rMinSim;       // min best-pair similarity
      if (rMergeId) filters.merge_id_state = rMergeId;         // has|none
      if (rMember) filters.member_number_state = rMember;      // has|none
      if (rFoundation) filters.foundation_state = rFoundation; // has|none
      if (rPortal) filters.portal_state = rPortal;            // has|none
    } else {
      if (rFoundation) filters.foundation_state = rFoundation;
      if (rPortal) filters.portal_state = rPortal;
      if (rBucket) filters.bucket = rBucket;
      if (rWhichList) colFilters.which_list = rWhichList;
      if (rSize) colFilters.size = rSize;
    }
    return { filters, colFilters };
  };
  // Reset every random-sample filter to permissive (mirrors Select Merges' Clear filters — all blank,
  // Queue back to All). Count/Seed are sampler controls, not filters, so they're left alone.
  const clearRandomFilters = () => {
    setRQueueFilter(''); setRSearch(''); setRSize(''); setRSignal(''); setRTier(''); setRMinSim('');
    setRMergeId(''); setRMember(''); setRWhichList(''); setRBucket(''); setRFoundation(''); setRPortal('');
  };
  const anyRandomFilter = !!(rQueueFilter || rSearch || rSize || rSignal || rTier || rMinSim || rMergeId || rMember || rWhichList || rBucket || rFoundation || rPortal);
  // Live "N sets match" count, debounced, recomputed as the random-mode filters change.
  useEffect(() => {
    if (batchMode !== 'random') { setMatchCount(null); return undefined; }
    let stop = false;
    const { filters, colFilters } = buildFilters();
    const t = setTimeout(() => {
      api.opsBatchCount({ source: rSource, filters, colFilters, queue_filter: rQueueFilter, q: rSearch })
        .then((r) => { if (!stop) { setMatchCount(typeof r.count === 'number' ? r.count : null); setMatchAccounts(typeof r.accounts === 'number' ? r.accounts : null); } })
        .catch(() => { if (!stop) { setMatchCount(null); setMatchAccounts(null); } });
    }, 300);
    return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchMode, rSource, rSize, rTier, rSignal, rMinSim, rMergeId, rMember, rWhichList, rBucket, rFoundation, rPortal, rQueueFilter, rSearch]);

  const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = Object.keys(draft).length > 0;
  const curVal = (key) => (Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : (settings && settings[key] ? settings[key].value : ''));

  const save = () => {
    if (!dirty) return;
    setSaving(true); setErr(''); setMsg('');
    api.opsSettingsSave(draft).then((r) => {
      setSettings(r.settings || {}); setDraft({}); setLastSaved(r.last_saved || null);
      setMsg('Saved ' + Object.keys(r.stored || {}).join(', '));
      track('merge_ops_save', { panel: 'merge-ops', view: 'settings', keys: Object.keys(draft).join(',') });
      setTimeout(() => setMsg(''), 4000);
    }).catch((e) => setErr(e.message)).finally(() => setSaving(false));
  };

  const applyScale = () => {
    const n = Number(scaleN); if (!n) return;
    setScaleBusy(true); setScaleMsg('');
    track('merge_ops_scale', { panel: 'merge-ops', view: 'workers', n });
    api.opsScale(n).then((r) => { setScaleMsg(r.ok ? ('Scaled to ' + r.n + ' worker(s)') : ('pm2 error: ' + (r.error || 'failed'))); loadPm2(); loadSettings(); setTimeout(() => setScaleMsg(''), 6000); })
      .catch((e) => setScaleMsg(e.message)).finally(() => setScaleBusy(false));
  };

  const launchRun = () => {
    setRunBusy(true); setRunErr(''); setRunNote(''); setMergeProg(null); setMergeJobId(null); setRunKind(null); setRestoreProg(null); setRestoreJobId(null); setRunIds(null); setMergeReport(null); setRestoreReport(null); setStagedSeed(null);
    restoreStartedRef.current = false; mergeReportedRef.current = false; restoreReportedRef.current = false;
    track('merge_ops_run', { panel: 'merge-ops', view: 'batch-run', mode: runMode, source: batchMode });
    try { localStorage.removeItem('sm_active_batch'); } catch (e) { /* ignore */ }
    let stagedIds = []; let seedVal = null;   // captured for persistence so a reattach can resume the restore-afterward chain
    const { filters, colFilters } = buildFilters();
    const getIds = batchMode === 'random'
      ? api.opsBatchStage({ source: rSource, count: rCount, seed: rSeed || undefined, filters, colFilters, queue_filter: rQueueFilter, q: rSearch })
        .then((r) => { seedVal = r.seed; setStagedSeed(r.seed); setRunNote('Staged ' + r.staged + ' random set(s) (seed ' + r.seed + ', pool ' + r.pool + ', env ' + r.env + ').'); return r.ids || []; })
      : api.mergeQueue('approved').then((r) => (r.rows || []).map((x) => x.id).filter(Boolean));
    getIds
      .then((ids) => {
        if (!ids.length) throw new Error(batchMode === 'random' ? 'nothing resolvable to stage' : 'no approved sets to run');
        stagedIds = ids;
        setRunIds(ids);
        const opts = runMode === 'execute'
          ? { mode: 'execute', confirm: 'MERGE', dry_run: false, ack_drift: true, stamp_merged: stampMerged, attach_dossier: attachDossier }
          : { mode: 'simulate', dry_run: true, stamp_merged: stampMerged, attach_dossier: attachDossier };
        return api.mergeProcess(ids, opts);
      })
      .then((r) => {
        if (r.job_id) {
          setMergeJobId(r.job_id); setRunKind('parallel');
          // Persist the in-flight run so a reattach (after navigating away) can resume its restore-afterward
          // chain — the toggle values themselves live in sm_batch_prefs (below).
          try { localStorage.setItem('sm_active_batch', JSON.stringify({ job_id: r.job_id, run_ids: stagedIds, seed: seedVal, run_mode: runMode })); } catch (e) { /* ignore */ }
        }
        else { setRunKind('single'); setRunNote((n) => (n ? n + ' ' : '') + 'Merge ran as a SINGLE run (no fan-out) — either parallel is off, or the set count fit in one chunk (≤ chunk size).'); }
      })
      .catch((e) => setRunErr(e.message))
      .finally(() => setRunBusy(false));
  };

  const manualRestore = () => {
    if (!runIds || !runIds.length) return;
    track('merge_ops_restore_manual', { panel: 'merge-ops', view: 'batch-run' });
    setRestoreReport(null); restoreReportedRef.current = false;
    api.opsBatchRestore(runIds, { mode: runMode, stamp_merged: stampMerged, attach_dossier: attachDossier })
      .then((r) => { if (r.job_id) { setRestoreJobId(r.job_id); persistRestoreJobId(r.job_id); } else setRunNote('Restore ran as a single run (parallel off).'); })
      .catch((e) => setRunErr('restore: ' + e.message));
  };
  // Restore a single already-merged set straight from the "Ready to restore" list.
  const restoreOne = (id) => {
    if (!id) return;
    track('merge_ops_restore_one', { panel: 'merge-ops', view: 'batch-run' });
    setRestoreReport(null); restoreReportedRef.current = false;
    api.opsBatchRestore([id], { mode: runMode, stamp_merged: stampMerged, attach_dossier: attachDossier })
      .then((r) => { if (r.job_id) { setRestoreJobId(r.job_id); persistRestoreJobId(r.job_id); } else { setRunNote('Restore ran as a single run (parallel off).'); loadRestorable(); } })
      .catch((e) => setRunErr('restore: ' + e.message));
  };
  const cancel = (id) => { if (id) { track('merge_ops_job_cancel', { panel: 'merge-ops', view: 'batch-run' }); api.mergeJobCancel(id).catch(() => {}); } };
  const resume = (id) => { if (id) { track('merge_ops_job_resume', { panel: 'merge-ops', view: 'batch-run' }); api.mergeJobResume(id).catch(() => {}); } };
  // Manually clear the run panel back to the fresh form (job progress, reports, ids, seed). Does NOT touch
  // Salesforce or the job — just resets what this panel is showing. Keeps your saved run-option choices.
  const resetPanel = () => {
    setMergeProg(null); setMergeJobId(null); setRunKind(null); setRestoreProg(null); setRestoreJobId(null);
    setRunIds(null); setMergeReport(null); setRestoreReport(null); setStagedSeed(null); setRunNote(''); setRunErr('');
    restoreStartedRef.current = false; mergeReportedRef.current = false; restoreReportedRef.current = false;
    try { localStorage.removeItem('sm_active_batch'); } catch (e) { /* ignore */ }
    track('merge_ops_reset_panel', { panel: 'merge-ops', view: 'batch-run' });
  };

  const TABS = [['settings', 'Settings'], ['batch', 'Batch run']];   // Workers is always-visible below the tabs

  return (
    <div className="sfmerge">
      <div className="mx-ph"><h2>Merge Ops</h2><span className="muted small">admin · live tuning, batch runs, worker control</span></div>
      {err ? <div className="err">{err}</div> : null}

      <div className="mx-tabbar">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); track('merge_ops_tab', { panel: 'merge-ops', view: k }); }}>{label}</button>
        ))}
      </div>

      {/* ---- SETTINGS ---- */}
      {tab === 'settings' ? (
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
                      <td style={{ padding: '8px 10px 8px 0' }}><strong>{meta.label}</strong><div className="muted small">{typeof meta.help === 'function' ? meta.help(curVal(k)) : meta.help}</div></td>
                      <td style={{ padding: '8px 10px 8px 0' }}>
                        {s.kind === 'bool'
                          ? <label className="small"><input type="checkbox" checked={!!curVal(k)} onChange={(e) => setField(k, e.target.checked)} /> {curVal(k) ? 'on' : 'off'}</label>
                          : <input type="number" value={curVal(k)} onChange={(e) => setField(k, e.target.value)} style={{ width: 120 }} />}
                        {changed ? <span className="pill" style={{ marginLeft: 8, borderColor: 'var(--accent)', color: 'var(--accent)' }}>edited</span> : null}
                      </td>
                      <td style={{ padding: '8px 10px 8px 0' }}>{sourceTag(s.source)}</td>
                      <td className="muted small" style={{ padding: '8px 0' }}
                        title={s.default_source === 'env' ? ('From the env var (code default is ' + String(s.def) + '). This is what the value reverts to with no saved override.') : 'Hardcoded code default (no env var set).'}>
                        {(() => { const v = s.effective_default != null ? s.effective_default : s.def; return typeof v === 'number' ? v.toLocaleString() : String(v); })()}
                        {s.default_source === 'env' ? <span className="pill" style={{ marginLeft: 6 }}>env</span> : null}
                      </td>
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
      ) : null}

      {/* ---- BATCH RUN ---- */}
      {tab === 'batch' ? (
        <section className="mx-panel">
          <h2>Batch run</h2>
          <p className="muted small">Runs a <strong>MERGE</strong> job through the real fan-out path (splits into parallel batches when parallel is on + more than one chunk; needs the worker cluster online). Optionally follows with a <strong>RESTORE</strong> job. Simulate makes no Salesforce changes.</p>
          <details className="mx-help" style={{ margin: '4px 0 12px' }}>
            <summary className="small" style={{ cursor: 'pointer', color: 'var(--link)' }}>How this works — what each knob does</summary>
            <div className="muted small" style={{ marginTop: 8, lineHeight: 1.55, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '8px 28px' }}>
              <div><strong>Mode — Approved vs Random:</strong> <em>Approved</em> runs whatever you've approved on Select Merges. <em>Random sample</em> auto-picks sets for you (no hand-selection) using the filters below — good for stress runs or "just merge N of these."</div>
              <div><strong>Simulate vs Execute:</strong> <em>Simulate</em> rehearses everything (fan-out, progress) but makes <strong>no</strong> Salesforce changes. <em>Execute</em> does real merges (needs the typed-MERGE + execution gates server-side).</div>
              <div><strong>Restore afterward:</strong> after the merge job finishes, automatically runs a <strong>restore</strong> job over the same sets — used to prove reversibility. Off for a plain merge.</div>
              <div><strong>Filters (Random only):</strong> the same facets as Select Merges — size band, tier, signal, min similarity, merge-ID/membership presence, Foundation — narrow the random pick so it's targeted, not blind.</div>
              <div><strong>Chunk size / parallel:</strong> come from the <em>Settings</em> tab. A job fans out into parallel batches of that chunk size when parallel is on and there's more than one chunk; otherwise it runs as a single run.</div>
              <div><strong>Needs the cluster:</strong> batches only drain if the worker cluster is online (see Workers below / start via pm2).</div>
              <div><strong>Re-running a job:</strong> nothing special needed. <em>Approved</em> — just launch again; already-merged sets drop out of the approved queue, so it picks up the rest. <em>Random</em> — reuse the <strong>seed</strong> to re-stage the exact same sample; any set already merged skips safely (merges are idempotent).</div>
              <div><strong>Finding the seed:</strong> after staging it shows as a <em>Seed:</em> chip under the run controls (with <em>↺ reuse</em> / <em>copy</em>), and it's also written to the run's Excel report (Summary + sweep row). Reuse drops it back into the Seed box for an identical re-run.</div>
              <div><strong>Restore (undo):</strong> after a merge job finishes — or is <em>cancelled</em> midway — an <em>↩ Restore this run</em> button appears (you don't have to pick "Restore afterward" up front). It undoes only the sets that actually merged and skips the rest.</div>
            </div>
          </details>
          {runErr ? <div className="err">{runErr}</div> : null}

          <div className="mx-tabs" style={{ marginBottom: 10 }}>
            <button className={batchMode === 'approved' ? 'on' : ''} title="Run the sets you've approved on Select Merges. Shows the approved queue plus anything already merged and ready to restore." onClick={() => setBatchMode('approved')}>Approved sets (UI)</button>
            <button className={batchMode === 'random' ? 'on' : ''} title="Auto-pick a seeded random sample (narrowed by the filters below) — for stress runs and targeted testing. No hand-selection." onClick={() => setBatchMode('random')}>Random sample (stress)</button>
          </div>

          {/* Parallel status — so you know BEFORE running whether a job will fan out. A run only fans out when
              parallel is on AND there is more than one chunk (sets > chunk size); otherwise it's one run. */}
          {(() => {
            const pOn = !!(settings && settings.parallel_enabled && settings.parallel_enabled.value);
            const chunk = settings && settings.chunk_size ? settings.chunk_size.value : '?';
            return (
              <p className="small" style={{ marginBottom: 8 }}>
                Parallel: <strong style={{ color: pOn ? 'var(--green)' : 'var(--red)' }}>{pOn ? 'ON' : 'OFF'}</strong>
                {pOn ? <span className="muted"> · chunk size {chunk} — a run fans out only when sets &gt; {chunk} (else single run)</span> : <span className="muted"> · every run is a single run (enable in Settings)</span>}
              </p>
            );
          })()}

          {batchMode === 'approved' ? (
            <div>
              <p className="muted small">Runs the currently <strong>approved</strong> queue: {approved == null ? '…' : approved} set(s). <button className="btn" style={{ width: 'auto', padding: '1px 8px' }} onClick={loadApproved}>refresh</button></p>
              {approvedRows.length ? (
                <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 6 }}>
                  <table className="modal-table" style={{ width: '100%', fontSize: 12 }}>
                    <thead><tr>{[['#', 'Row number in this approved batch'], ['Survivor', 'The record that will be kept — losers merge into it'], ['Losers', 'How many duplicate records will be merged away into the survivor'], ['Cluster', 'The consolidated group / merge-id key that grouped these records']].map(([h, tip]) => <th key={h} title={tip} style={{ textAlign: 'left', position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1, cursor: 'help' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {approvedRows.map((r, i) => {
                        const losers = Array.isArray(r.loser_accounts) ? r.loser_accounts.length : String(r.loser_accounts || '').split(';').filter(Boolean).length;
                        return <tr key={r.id || i}><td>{i + 1}</td><td>{r.survivor_name || r.survivor_account || '—'}</td><td>{losers}</td><td className="mono" style={{ fontSize: 11 }}>{String(r.source_key || '').slice(0, 44)}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (approved === 0 ? <p className="muted small">No approved sets — approve some on Select Merges first.</p> : null)}

              {/* Ready to restore — sets already merged that can be undone (undelete losers + re-point children). */}
              <p className="muted small" style={{ marginTop: 12 }}>Ready to restore: {restorable == null ? '…' : restorable.length} set(s) — already merged, restore available. <button className="btn" style={{ width: 'auto', padding: '1px 8px' }} onClick={loadRestorable}>refresh</button></p>
              {restorable && restorable.length ? (
                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 6 }}>
                  <table className="modal-table" style={{ width: '100%', fontSize: 12 }}>
                    <thead><tr>{[['#', 'Row number in the ready-to-restore list'], ['Survivor', 'The kept record whose merge would be undone'], ['Losers', 'How many merged-away records would be restored (undeleted + re-pointed)'], ['Env', 'Salesforce environment the merge ran against (sandbox / production)'], ['Status', 'Whether all losers are still recoverable from the Recycle Bin (~15 days) — hover a row for detail'], ['', 'Restore just this set']].map(([h, tip], i) => <th key={h || i} title={tip} style={{ textAlign: 'left', position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1, cursor: 'help' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {restorable.map((r, i) => (
                        <tr key={r.id || i}>
                          <td>{i + 1}</td>
                          <td>{r.survivor_name || r.survivor_account || '—'}</td>
                          <td>{r.loser_count}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{r.environment || '—'}</td>
                          <td title={r.reason || ''} style={{ color: r.restorable ? 'var(--green)' : 'var(--red)' }}>{r.restorable ? '✓ recoverable' : '✕ ' + (r.reason || 'not recoverable')}</td>
                          <td><button className="btn" style={{ width: 'auto', padding: '1px 8px' }} disabled={!r.restorable || runBusy} title="Restore just this merged set (undelete losers + re-point children)." onClick={() => restoreOne(r.id)}>↩ restore</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (restorable && restorable.length === 0 ? <p className="muted small">Nothing merged yet — restorable sets appear here after a merge.</p> : null)}
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
                <label className="small" title="Which data list to sample from: the consolidated duplicate clusters, or the Salesforce merge-id groups.">Source<br /><span className="tb-select"><select value={rSource} onChange={(e) => setRSource(e.target.value)}><option value="duplicate">duplicate</option><option value="merge-id">merge-id</option></select></span></label>
                <label className="small" title="How many sets to select and run.">Count<br /><input type="number" value={rCount} onChange={(e) => setRCount(e.target.value)} style={{ width: 80 }} /></label>
                <label className="small" title="Reproducibility: the same seed picks the same random sample. Leave blank for a fresh random pick each time.">Seed (blank = random)<br /><input type="number" value={rSeed} onChange={(e) => setRSeed(e.target.value)} style={{ width: 110 }} /></label>
                <label className="small" title="Narrow the pool by name or id before sampling — same name/id search as the Select Merges list.">Search (name/id)<br /><input type="text" value={rSearch} onChange={(e) => setRSearch(e.target.value)} placeholder="name, id…" style={{ width: 150 }} /></label>
              </div>
              {/* Filters below the source — the same facets as the Select Merges list. */}
              <div className="mx-scope" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: '8px 10px', borderRadius: 'var(--radius)' }}>
                <span className="mx-scope-label small" style={{ width: '100%' }}>Filters (narrow the sample, like Select Merges):</span>
                {/* 100% parity with the Select Merges filter bar — SAME shared <FilterSelect> component + the SAME
                    FILTER_TIP / FILTER_OPTS defs, so labels, tooltips, and options can't drift. Order matches too:
                    group/duplicate → Queue, Size, Signal, Tier, Min similarity, Merge ID, Membership #, Foundation,
                    Customer portal; merge-id → Queue, Size, Which list, Bucket, Foundation, Customer portal. */}
                <FilterSelect label="Queue" tip={FILTER_TIP.queue} opts={FILTER_OPTS.queue} value={rQueueFilter} onChange={setRQueueFilter} />
                <FilterSelect label="Size" tip={FILTER_TIP.size} opts={sizeOptions(facets.size)} value={rSize} onChange={setRSize} />
                {rSource === 'duplicate' ? (
                  <>
                    <FilterSelect label="Signal" tip={FILTER_TIP.signal} opts={facets.signal || FILTER_OPTS.signal} value={rSignal} onChange={setRSignal} />
                    <FilterSelect label="Tier" tip={FILTER_TIP.tier} opts={facets.tier || FILTER_OPTS.tier} value={rTier} onChange={setRTier} />
                    <FilterSelect label="Min similarity" tip={FILTER_TIP.minSim} opts={FILTER_OPTS.minSim} value={rMinSim} onChange={setRMinSim} />
                    <FilterSelect label="Merge ID" tip={FILTER_TIP.mergeId} opts={facets.merge_id_state || FILTER_OPTS.mergeId} value={rMergeId} onChange={setRMergeId} />
                    <FilterSelect label="Membership #" tip={FILTER_TIP.member} opts={facets.member_number_state || FILTER_OPTS.member} value={rMember} onChange={setRMember} />
                  </>
                ) : (
                  <>
                    <FilterSelect label="Which list" tip={FILTER_TIP.whichList} opts={facets.which_list || FILTER_OPTS.whichList} value={rWhichList} onChange={setRWhichList} />
                    <FilterSelect label="Bucket" tip={FILTER_TIP.bucket} opts={facets.bucket || FILTER_OPTS.bucket} value={rBucket} onChange={setRBucket} />
                  </>
                )}
                <FilterSelect label="Foundation" tip={FILTER_TIP.foundation} opts={facets.foundation_state || FILTER_OPTS.foundation} value={rFoundation} onChange={setRFoundation} />
                <FilterSelect label="Customer portal" tip={FILTER_TIP.portal} opts={facets.portal_state || FILTER_OPTS.portal} value={rPortal} onChange={setRPortal} />
                {anyRandomFilter && <div style={{ alignSelf: 'flex-end' }}><button type="button" className="linkbtn" onClick={clearRandomFilters} title="Reset all filters to permissive (Count and Seed are left as-is)">Clear filters</button></div>}
              </div>
            </div>
          )}
          {batchMode === 'random' ? (
            <p className="small" style={{ marginTop: 8 }}>
              <strong>{matchCount == null ? '…' : matchCount.toLocaleString()}</strong> set(s){matchAccounts != null ? <span className="muted"> · {matchAccounts.toLocaleString()} accounts</span> : null} match these filters
              {matchCount != null && rCount ? <span className="muted"> · will run {Math.min(Number(rCount) || 0, matchCount).toLocaleString()} (Count vs pool)</span> : null}
            </p>
          ) : null}
          {batchMode === 'random' ? <p className="muted small">Stress/targeted mode: stages a seeded random sample (narrowed by the filters) against the loaded dataset, then runs it. Chunk size comes from Settings. Use in sandbox.</p> : null}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <span className="tb-select" title="Simulate makes no Salesforce changes; Execute performs real merges (subject to the server-side gates)."><select value={runMode} onChange={(e) => setRunMode(e.target.value)}><option value="simulate">Simulate</option><option value="execute">Execute (real merges)</option></select></span>
            <label className="small" title="After the merge job completes, automatically run a restore job over the same sets."><input type="checkbox" checked={restoreAfter} onChange={(e) => setRestoreAfter(e.target.checked)} /> Restore afterward</label>
            <label className="small" title="Stamp the survivor's usat_was_* fields (flag on + MERGE — you) on merge, and on restore/recreate. Same control as Process Merges."><input type="checkbox" checked={stampMerged} onChange={(e) => setStampMerged(e.target.checked)} /> Stamp survivor <code>(usat_was_*)</code></label>
            <label className="small" title="Attach the merge/restore dossier spreadsheet to the affected Salesforce records. Best-effort; same control as Process Merges."><input type="checkbox" checked={attachDossier} onChange={(e) => { setAttachDossier(e.target.checked); try { localStorage.setItem('mp_attach_dossier', e.target.checked ? '1' : '0'); } catch (er) {} }} /> 📎 Attach dossier</label>
            <button className={'btn ' + (runMode === 'execute' ? 'primary' : '')} style={{ width: 'auto' }} disabled={runBusy} onClick={launchRun}>{runBusy ? 'Launching…' : (runMode === 'execute' ? 'Run merges' : 'Simulate run')}</button>
          </div>
          {runNote ? <p className="small" style={{ color: 'var(--dim)' }}>{runNote}</p> : null}
          {/* Seed chip — the seed is what lets you reproduce a random sample for a re-run. Surface it clearly
              (also written to the Excel report) with one-click reuse + copy so it isn't buried in the note text. */}
          {batchMode === 'random' && stagedSeed != null ? (
            <p className="small" style={{ marginTop: 4 }}>
              Seed: <strong>{stagedSeed}</strong>{' '}
              <button className="btn" style={{ width: 'auto', padding: '1px 8px' }} title="Put this seed back in the Seed box to re-run the exact same sample." onClick={() => setRSeed(String(stagedSeed))}>↺ reuse</button>{' '}
              <button className="btn" style={{ width: 'auto', padding: '1px 8px' }} title="Copy the seed to the clipboard." onClick={() => { try { navigator.clipboard.writeText(String(stagedSeed)); } catch (e) { /* no clipboard */ } }}>copy</button>
            </p>
          ) : null}

          {runKind ? (
            <p className="small" style={{ marginTop: 6 }}>
              <span style={{ display: 'inline-block', padding: '0 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: runKind === 'parallel' ? 'rgba(22,121,74,.15)' : 'rgba(120,120,120,.18)', color: runKind === 'parallel' ? '#16794a' : 'var(--dim)' }}>
                {runKind === 'parallel' ? 'PARALLEL JOB' : 'SINGLE RUN'}
              </span>{' '}
              {runKind === 'parallel' ? <span className="muted">fanned out across the worker cluster{mergeProg && mergeProg.batch_total ? ' — ' + mergeProg.batch_total + ' batch(es)' : ''}</span> : <span className="muted">one run in the app server (no fan-out)</span>}
            </p>
          ) : null}
          <JobProgress title="Merge job" prog={mergeProg} report={mergeReport} onCancel={() => cancel(mergeJobId)} onResume={() => resume(mergeJobId)} />
          {/* Manual restore of the sets from this run — offered whether you skipped "Restore afterward" OR
              cancelled midway (a cancelled job may have merged some sets before stopping; restore undoes only
              what actually merged and safely skips the rest). runIds is staged before the merge, so it survives cancel. */}
          {mergeProg && (mergeProg.status === 'done' || mergeProg.status === 'cancelled') && runIds && runIds.length && !restoreJobId ? (
            <div style={{ marginTop: 10 }}>
              <button className="btn" style={{ width: 'auto' }} title="Restore the sets from this run (undelete losers + re-point children). Only sets that actually merged are affected; the rest are skipped." onClick={manualRestore}>↩ Restore this run ({runIds.length}){mergeProg.status === 'cancelled' ? ' — cancelled, undo partial merges' : ''}</button>
            </div>
          ) : null}
          <JobProgress title="Restore job" prog={restoreProg} report={restoreReport} onCancel={() => cancel(restoreJobId)} onResume={() => resume(restoreJobId)} />
          {mergeProg && isTerminal(mergeProg.status) && (!restoreProg || isTerminal(restoreProg.status)) ? (
            <div style={{ marginTop: 10 }}>
              <button className="btn" style={{ width: 'auto' }} title="Clear this panel back to the fresh run form. Does not touch Salesforce or the completed job — just resets what's shown here. Your run-option choices are kept." onClick={resetPanel}>↺ Reset panel</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---- WORKERS (always visible, below the tabs) ---- */}
      {(
        <section className="mx-panel">
          <h2>Workers &amp; queue</h2>
          <p className="muted small">Live (5s). "Workers active" counts pm2 instances currently draining a run; "Cluster online" is the true instance count from pm2.</p>
          {!workers ? <p className="muted">—</p> : (
            <div className="mx-cards">
              <div className="mx-card"><div className="k">Cluster online</div><div className="v">{pm2 && pm2.ok && pm2.online != null ? pm2.online : '—'}</div><div className="s">{pm2 && !pm2.ok ? (pm2.error || 'pm2 unavailable') : 'pm2 instances'}</div></div>
              <div className="mx-card"><div className="k">Workers active</div><div className="v">{workers.workers_active}</div><div className="s">{workers.workers.join(', ') || 'none draining'}</div></div>
              <div className="mx-card"><div className="k">Queued</div><div className="v">{workers.queued}</div><div className="s">waiting to be claimed</div></div>
              <div className="mx-card"><div className="k">Running</div><div className="v">{workers.running}</div><div className="s">chunk-runs in flight</div></div>
              <div className="mx-card"><div className="k">Held (paused)</div><div className="v">{workers.held}</div><div className="s">resume from a job</div></div>
              <div className="mx-card"><div className="k">Active jobs</div><div className="v">{workers.active_jobs}</div><div className="s">fanned-out jobs</div></div>
            </div>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="small">Scale cluster to</span>
            <input type="number" min="1" max="8" value={scaleN} placeholder={String((settings && settings.worker_target && settings.worker_target.value) || 4)} onChange={(e) => setScaleN(e.target.value)} style={{ width: 70 }} />
            <button className="btn" style={{ width: 'auto' }} disabled={scaleBusy || !scaleN} onClick={applyScale}>{scaleBusy ? 'Scaling…' : 'Apply (pm2 scale)'}</button>
            <button className="btn" style={{ width: 'auto' }} onClick={() => { loadPm2(); track('merge_ops_refresh', { panel: 'merge-ops', view: 'workers' }); }}>Refresh</button>
            {scaleMsg ? <span className="small" style={{ color: /error|fail/i.test(scaleMsg) ? 'var(--red)' : 'var(--green)' }}>{scaleMsg}</span> : null}
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>Runs <code>pm2 scale salesforce_merge_worker N</code> on the server (1–8) and saves it as <code>worker_target</code>. Requires pm2 on the platform host.</p>
        </section>
      )}

      {/* ---- Worker logs (live SSE stream — same component/styling as Ops → Server cards) ---- */}
      <section className="mx-panel">
        <h2>Activity logs</h2>
        <p className="muted small">Live pm2 stream — same console styling as <strong>Ops → Server cards</strong> (colored lines, instance number, expand, copy, reconnect, follow-tail), gated by <em>your Merge Ops grant</em> (no admin needed). <strong>All processes</strong> shows the whole pm2 log (incl. the main app server, so single-run merges appear here too); <strong>Worker only</strong> filters to the fan-out cluster.</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" style={{ width: 'auto' }} onClick={() => { const n = !logsOpen; setLogsOpen(n); track('merge_ops_logs', { panel: 'merge-ops', view: 'logs', open: n }); }}>{logsOpen ? 'Hide logs' : 'Show live logs'}</button>
          {logsOpen ? (
            <span className="tb-select" title="All processes = the full pm2 log; Worker only = just the salesforce_merge_worker cluster.">
              <select value={logScope} onChange={(e) => setLogScope(e.target.value)}>
                <option value="all">All processes</option>
                <option value="salesforce_merge_worker">Worker only</option>
              </select>
            </span>
          ) : null}
        </div>
        {logsOpen ? <div style={{ marginTop: 10 }}><LiveLog key={logScope} name={logScope === 'all' ? undefined : logScope} streamUrl="/api/salesforce-merge/ops/logs/stream" height={340} defaultLines={1000} /></div> : null}
      </section>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import WorkerBanner from '../components/WorkerBanner.jsx';
import RestoreDiffDetail from '../components/RestoreDiffDetail.jsx';
import { api } from '../lib/api.js';
import { awaitRun, summarize } from '../lib/run_poll.js';

const RESULT_COLOR = { restored: '#1a8a4f', simulated: '#1a8a4f', skipped: '#854f0b', failed: '#c0392b' };

// A labeled SOQL block with a one-click Copy button. Clipboard API with a textarea fallback for
// non-secure contexts. `note` is optional helper text under the label.
function CopyQuery({ label, sql, note }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(sql); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = sql; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
        <span className="muted small" style={{ fontWeight: 600 }}>{label}</span>
        <button type="button" onClick={copy} style={{ cursor: 'pointer', fontSize: 11, padding: '2px 10px', borderRadius: 5, border: '1px solid var(--border, rgba(127,127,127,0.4))', background: copied ? '#1a8a4f' : 'transparent', color: copied ? '#fff' : 'inherit', whiteSpace: 'nowrap' }}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--panel, rgba(127,127,127,0.12))', padding: 8, borderRadius: 6, fontSize: 11, margin: 0, userSelect: 'all' }}>{sql}</pre>
      {note && <p className="muted small" style={{ margin: '3px 0 0' }}>{note}</p>}
    </div>
  );
}

// Phase 4 — undo a completed merge (best-effort). Same safety model as Process Merges: Simulate by
// default; a real restore needs Execute mode + typed RESTORE + the deploy execution flag.
export default function Restore() {
  const [status, setStatus] = useState(null);
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [history, setHistory] = useState([]);
  const [mode, setMode] = useState('simulate');
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState(null);
  const [restoreReport, setRestoreReport] = useState(null);   // Excel report path written after a restore
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bin, setBin] = useState(null);
  // Secondary queue: sets routed to recreate-from-backup (losers gone from the Recycle Bin).
  const [recRows, setRecRows] = useState([]);
  const [recSel, setRecSel] = useState(() => new Set());
  const [recMode, setRecMode] = useState('simulate');
  const [recConfirm, setRecConfirm] = useState('');
  const [recResult, setRecResult] = useState(null);
  const [recReport, setRecReport] = useState(null);   // Excel report path written after a recreate
  const [recBusy, setRecBusy] = useState(false);
  const [diffOpen, setDiffOpen] = useState(() => new Set());
  const toggleDiff = (id) => setDiffOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [keepBySet, setKeepBySet] = useState({});   // { [queueId]: [fieldsToKeepCurrent] } — selective restore
  const onKeepChange = useCallback((id, fields) => setKeepBySet((p) => ({ ...p, [id]: fields })), []);
  // Post-merge diff: was the survivor edited IN SALESFORCE after the merge? On-demand (button or row).
  const [postDiff, setPostDiff] = useState({});     // { [queueId]: post-merge diff result }
  const [postBusy, setPostBusy] = useState(false);
  const [ackPost, setAckPost] = useState(false);    // acknowledge → restore edited-since-merge sets anyway
  const [attachDossier, setAttachDossier] = useState(() => { try { return localStorage.getItem('sm_attach_dossier') !== '0'; } catch (e) { return true; } });
  const setAttach = (v) => { setAttachDossier(v); try { localStorage.setItem('sm_attach_dossier', v ? '1' : '0'); } catch (e) {} };
  const [stampMerged, setStampMerged] = useState(() => { try { return localStorage.getItem('sm_stamp_merged') !== '0'; } catch (e) { return true; } });
  const setStamp = (v) => { setStampMerged(v); try { localStorage.setItem('sm_stamp_merged', v ? '1' : '0'); } catch (e) {} };
  const [stampFields, setStampFields] = useState(null);   // {usat_was_merged__c, _date__c, _by__c} presence on Account
  const fmtTs = (s) => { if (!s) return '—'; const d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleString(); };
  const checkPostMerge = async (checkIds) => {
    const list = (checkIds && checkIds.length) ? checkIds : rows.map((r) => r.id);
    if (!list.length) return;
    setPostBusy(true); setErr('');
    try {
      const r = await api.mergeRestorePostDiff(list);
      setPostDiff((p) => { const n = { ...p }; for (const d of (r.results || [])) if (d && d.queue_id != null) n[d.queue_id] = d; return n; });
    } catch (e) { setErr(e.message); }
    finally { setPostBusy(false); }
  };

  const load = useCallback(() => {
    api.mergeStatus().then(setStatus).catch((e) => setErr(e.message));
    api.stampFields().then(setStampFields).catch(() => setStampFields(null));
    api.mergeRestoreList().then((r) => { const rs = r.rows || []; setRows(rs); setSel(new Set(rs.filter((x) => x.restorable).map((x) => x.id))); }).catch((e) => setErr(e.message));
    api.mergeHistory().then((r) => setHistory((r.rows || []).filter((h) => ['restored', 'recreated', 'skipped', 'failed'].includes(h.result) && /(restor|recreat)/i.test(h.reason || '') ))).catch(() => {});
    api.recycleBin().then((r) => setBin({ rows: r.rows || [], error: r.error || null, connected: r.connected || null, queried_at: r.queried_at || null })).catch((e) => setBin({ rows: [], error: e.message }));
    api.mergeRecreateList().then((r) => { const rs = r.rows || []; setRecRows(rs); setRecSel(new Set(rs.filter((x) => x.has_snapshot).map((x) => x.id))); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  // Resume IN-FLIGHT restore / recreate runs when this panel (re)mounts (parity with Process Merges).
  // The run keeps executing in the worker; without this the busy state + result are lost on navigate-away.
  useEffect(() => {
    let cancelled = false;
    const resume = async (kind, setB, setRes) => {
      try {
        const p = await api.mergeProgress(kind);
        const rn = p && p.run;
        if (cancelled || !rn || (rn.status !== 'running' && rn.status !== 'queued')) return;
        setB(true);
        const finalRun = await awaitRun(api, kind, rn.run_id);
        if (!cancelled) { setRes(summarize(finalRun)); load(); }
      } catch (e) { /* idle */ }
      finally { if (!cancelled) setB(false); }
    };
    resume('restore', setBusy, setResult);
    resume('recreate', setRecBusy, setRecResult);
    return () => { cancelled = true; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...sel];
  const selCount = sel.size;
  // Org's ACTUAL stamp-field API names (backend resolves real casing); fall back to the lowercase
  // constants when a field is absent so the "create it" hint still names it correctly.
  const _sfR = (stampFields && stampFields.resolved) || {};
  const _sfF = (stampFields && stampFields.fields) || { flag: 'usat_Was_Merged__pc', date: 'usat_Was_Merged_Date__pc', by: 'usat_Was_Merged_By__pc' };
  const nmFlag = _sfR.flag || _sfF.flag, nmDate = _sfR.date || _sfF.date, nmBy = _sfR.by || _sfF.by;
  const safe = !status || status.safe_mode;
  const canExecute = !safe && mode === 'execute' && confirmText === 'RESTORE' && selCount > 0;
  // The run summary carries only counts; per-set failure/skip REASONS live in history (reloaded after a
  // run). Surface them inline so a failed run shows WHY (e.g. "restore halted: entity is deleted").
  const runReasons = (runId) => (history || [])
    .filter((h) => String(h.run_id) === String(runId) && (h.result === 'failed' || h.result === 'skipped'))
    .map((h) => h.reason).filter(Boolean);

  const run = async (execute) => {
    if (!ids.length) return;
    setBusy(true); setErr(''); setResult(null); setRestoreReport(null);
    try {
      // Selective restore: send the per-set "keep current" field choices for the sets being restored.
      const keep_fields = {};
      for (const id of ids) if (keepBySet[id] && keepBySet[id].length) keep_fields[id] = keepBySet[id];
      const q = await api.mergeRestore(ids, execute
        ? { mode: 'execute', confirm: confirmText, keep_fields, ack_post_merge: ackPost, attach_dossier: attachDossier, stamp_merged: stampMerged }
        : { mode: 'simulate', keep_fields, attach_dossier: attachDossier, stamp_merged: stampMerged });
      setConfirmText('');
      const finalRun = await awaitRun(api, 'restore', q.run_id);
      setResult(summarize(finalRun)); load();
      // Write the SAME Excel workbook + sweep row as a merge run does (report_run/report_job detect the
      // restore kind and label it Mode=restore). Best-effort — a report failure never fails the restore.
      try {
        const rep = q.job_id ? await api.mergeJobReport(q.job_id) : await api.mergeRunReport(q.run_id);
        if (rep && rep.report) setRestoreReport(rep.report);
      } catch (e) { /* report is best-effort */ }
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const recToggle = (id) => setRecSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const recIds = [...recSel];
  const recCanExecute = !safe && recMode === 'execute' && recConfirm === 'RECREATE' && recIds.length > 0;
  const runRecreate = async (execute) => {
    if (!recIds.length) return;
    setRecBusy(true); setErr(''); setRecResult(null); setRecReport(null);
    try {
      const keep_fields = {};
      for (const id of recIds) if (keepBySet[id] && keepBySet[id].length) keep_fields[id] = keepBySet[id];
      const q = await api.mergeRecreate(recIds, execute ? { mode: 'execute', confirm: recConfirm, keep_fields, attach_dossier: attachDossier, stamp_merged: stampMerged } : { mode: 'simulate', keep_fields, attach_dossier: attachDossier, stamp_merged: stampMerged });
      setRecConfirm('');
      const finalRun = await awaitRun(api, 'recreate', q.run_id);
      setRecResult(summarize(finalRun)); load();
      // Same workbook + sweep row as merges/restores (report_run detects the recreate kind). Best-effort.
      try {
        const rep = q.job_id ? await api.mergeJobReport(q.job_id) : await api.mergeRunReport(q.run_id);
        if (rep && rep.report) setRecReport(rep.report);
      } catch (e) { /* report is best-effort */ }
    } catch (e) { setErr(e.message); }
    finally { setRecBusy(false); }
  };

  return (
    <div className="mtbl">
      <h2>Restore</h2>
      <p className="muted small">Undo a completed merge — bring losers back from the Recycle Bin, re-link their children, and reset the master. Best-effort, ~15-day window. Safe mode performs no Salesforce writes.</p>
      <DatasetStamp />
      <WorkerBanner />
      {err && <p className="err">{err}</p>}

      <div className="card" style={{ margin: '8px 0 12px', borderColor: safe ? 'var(--green)' : 'var(--red)', background: safe ? 'var(--green-bg)' : 'var(--red-bg)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ color: safe ? 'var(--green)' : 'var(--red)' }}>{safe ? 'Safe mode is ON — no Salesforce writes' : 'Execution ENABLED'}</strong>
        <span className="muted small">{safe ? 'Restore runs as a preview (eligibility + plan) only.' : 'A real restore may run behind the gates.'}</span>
        <span style={{ marginLeft: 'auto' }} className="muted small">Target environment: <strong style={status && status.environment ? { color: status.environment === 'Production' ? 'var(--red)' : 'var(--green)' } : undefined}>{status ? (status.environment || '—') : '…'}</strong></span>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12, alignItems: 'stretch' }}>
        <div className="card" style={{ flex: '0 0 300px', minWidth: 0, margin: 0 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Run restore</p>
          <div className="seg" style={{ width: '100%', marginBottom: 8 }}>
            <button className={'seg-btn' + (mode === 'simulate' ? ' on' : '')} style={{ flex: 1 }} onClick={() => setMode('simulate')}>Simulate</button>
            <button className={'seg-btn' + (mode === 'execute' ? ' on' : '')} style={{ flex: 1 }} disabled={safe} title={safe ? 'Execution disabled (safe mode)' : ''} onClick={() => setMode('execute')}>Execute</button>
          </div>
          {mode === 'execute' && !safe && (
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="type RESTORE to confirm" style={{ width: '100%', marginBottom: 8 }} />
          )}
          {mode === 'execute' && !safe && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, margin: '0 0 8px' }}>
              <input type="checkbox" checked={ackPost} onChange={(e) => setAckPost(e.target.checked)} style={{ marginTop: 2 }} />
              <span>Restore even if the survivor was edited in Salesforce after the merge. <strong>Unchecked, edited‑since‑merge sets are held</strong> (left in the list) for review.</span>
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, margin: '0 0 6px' }}>
            <input type="checkbox" checked={stampMerged} onChange={(e) => setStamp(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Stamp survivor with the restore action <code>(usat_was_*)</code> — flag→off, <code>{nmBy}</code> = “RESTORE — you”.</span>
          </label>
          {stampMerged && stampFields && (!stampFields.usat_was_merged__c || !stampFields.usat_was_merged_date__c || !stampFields.usat_was_merged_by__c) && (
            <p className="small" style={{ margin: '0 0 8px', color: 'var(--amber)' }}>
              ⚠ {[!stampFields.usat_was_merged__c && nmFlag, !stampFields.usat_was_merged_date__c && nmDate, !stampFields.usat_was_merged_by__c && nmBy].filter(Boolean).join(' + ')} not found on Account — create it in Salesforce (Setup → Object Manager → Account → Fields). The restore still runs; the stamp is skipped for any missing field.
            </p>
          )}
          {stampMerged && stampFields && stampFields.usat_was_merged__c && stampFields.usat_was_merged_date__c && stampFields.usat_was_merged_by__c && (
            <p className="muted small" style={{ margin: '0 0 8px', color: 'var(--green)' }}>✓ stamp fields present ({nmFlag}, {nmDate}, {nmBy})</p>
          )}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, margin: '0 0 6px' }}>
            <input type="checkbox" checked={attachDossier} onChange={(e) => setAttach(e.target.checked)} style={{ marginTop: 2 }} />
            <span>📎 Attach restore dossier to every affected record (survivor + restored loser + re‑pointed children). Applies on Execute; best‑effort.</span>
          </label>
          <button className="btn primary" style={{ width: '100%', marginTop: 0 }} disabled={busy || !canExecute} onClick={() => run(true)}>▷ Restore selected{safe ? ' (off)' : ''}</button>
          <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy || selCount === 0} onClick={() => run(false)}>{busy ? 'Running…' : '👁 Simulate restore (' + selCount + ')'}</button>
          {result && (
            <p className="muted small" style={{ marginTop: 8, color: 'var(--accent)' }}>Run {result.run_id} ({result.mode}): {result.restored || 0} restored, {result.simulated || 0} simulated, {result.skipped} skipped, {result.failed} failed.</p>
          )}
          {restoreReport && (
            <p className="muted small" style={{ marginTop: 4 }}>Report written: <span className="mono">{restoreReport}</span> (+ sweep row)</p>
          )}
          {result && (result.failed > 0 || result.skipped > 0) && runReasons(result.run_id).map((r, i) => (
            <p key={i} className="small" style={{ margin: '2px 0 0', color: 'var(--red)' }}>⚠ {r}</p>
          ))}
        </div>

        <div className="card" style={{ flex: '1 1 320px', minWidth: 0, margin: 0, background: 'var(--card)' }}>
          <p style={{ margin: '0 0 6px', fontWeight: 700 }}>How restore works</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            <li><strong>Three steps.</strong> Undelete the losers from the Recycle Bin (original ids), re-point their children to their original parents (from the snapshot), and reset the master's overwritten fields (from the snapshot).</li>
            <li><strong>Best-effort, ~15-day window.</strong> Restore only works while the losers are still in the Recycle Bin — rows flagged <em>expired</em> can't be restored here. Downstream automation and external systems (e.g. Marketing Cloud) are not auto-undone.</li>
            <li><strong>Safe by default.</strong> Simulate previews eligibility and the plan with no writes; a real restore needs Execute mode, a typed <strong>RESTORE</strong>, and the deploy execution flag — then the set flips to <em>restored</em>.</li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 4px', fontWeight: 700 }}>Completed merges <span className="muted small" style={{ fontWeight: 400 }}>({rows.length})</span></p>
        <p className="muted small" style={{ margin: '0 0 8px' }}>Expand a row to diff the survivor's current Salesforce values against the pre-merge snapshot — “in sync” means a restore would change nothing; differences show what a restore would reset (and what may have been edited since the merge).</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={postBusy || rows.length === 0} onClick={() => checkPostMerge()} title="For each set, compare the survivor's current Salesforce values to the post-merge snapshot to flag anything edited after the merge">
            {postBusy ? 'Checking…' : '🔍 Check post‑merge changes'}
          </button>
          <span className="muted small">Flags survivors edited in Salesforce after the merge (a blind restore would overwrite those edits). On Execute, flagged sets are held unless acknowledged.</span>
        </div>
        <div className="dt-scroll" style={{ maxHeight: 320 }}>
          <table className="modal-table">
            <thead><tr><th>Diff</th><th>Sel</th><th>#</th><th>Survivor</th><th>Account</th><th>Merged</th><th>Source</th><th>Env</th><th>Restorable</th><th title="Whether the survivor was edited in Salesforce after the merge — run “Check post‑merge changes”">Post‑merge</th></tr></thead>
            <tbody>
              {rows.map((r, i) => [
                <tr key={r.id}>
                  <td><button type="button" onClick={() => toggleDiff(r.id)} title="Diff current vs pre-merge snapshot" style={{ border: 0, background: 'transparent', color: 'var(--dim)', cursor: 'pointer', padding: 0, font: 'inherit' }}>{diffOpen.has(r.id) ? '▾' : '▸'}</button></td>
                  <td><input type="checkbox" checked={sel.has(r.id)} disabled={r.restorable === false} onChange={() => toggle(r.id)} aria-label={'Select ' + r.id} /></td>
                  <td>{i + 1}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td><span style={{ userSelect: 'all', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} title="Click to select · triple-click to copy">{r.survivor_account || '—'}</span></td>
                  <td>{r.loser_count}</td>
                  <td><span className="muted small">{r.source_type === 'merge_id' ? 'merge id ' : 'group '}</span><span style={{ userSelect: 'all', whiteSpace: 'nowrap' }} title="Click to select · triple-click to copy">{r.source_key || '—'}</span></td>
                  <td>{r.environment || '—'}</td>
                  <td title={r.reason}>
                    <span className="pill" style={{ color: r.restorable ? 'var(--green)' : (r.restorable === false ? 'var(--amber)' : 'var(--dim)') }}>
                      {r.restorable === true ? '✓ restorable' : r.restorable === false ? '✕ expired' : '— unknown'}
                    </span>
                  </td>
                  <td>
                    {(() => {
                      const d = postDiff[r.id];
                      if (!d) return <span className="muted small">—</span>;
                      if (d.has_baseline === false) return <span className="pill" title={d.note} style={{ color: 'var(--dim)' }}>— no baseline</span>;
                      if (d.edited_since_merge) return <span className="pill" title={'SF last modified ' + fmtTs(d.sf_last_modified_now) + ' is after the post‑merge snapshot ' + fmtTs(d.sf_last_modified_at_merge)} style={{ color: 'var(--amber)' }}>⚠ edited since merge</span>;
                      return <span className="pill" style={{ color: 'var(--green)' }}>✓ untouched</span>;
                    })()}
                  </td>
                </tr>,
                diffOpen.has(r.id) ? <tr key={r.id + '_diff'}><td colSpan={10} style={{ padding: 0 }}>
                  {postDiff[r.id] && postDiff[r.id].has_baseline && (() => {
                    const pd = postDiff[r.id];
                    const changed = (pd.post_merge && pd.post_merge.rows ? pd.post_merge.rows : []).filter((x) => x.state === 'differ');
                    return (
                      <div className="small" style={{ padding: '6px 10px', background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
                        <div>Post‑merge snapshot: <strong>{fmtTs(pd.post_snapshot_at)}</strong> · SF last modified: <strong>{fmtTs(pd.sf_last_modified_now)}</strong>{' '}
                          {pd.edited_since_merge
                            ? <span style={{ color: 'var(--amber)' }}>— ⚠ edited in Salesforce after the merge ({changed.length} field{changed.length === 1 ? '' : 's'} changed)</span>
                            : <span style={{ color: 'var(--green)' }}>— ✓ untouched since the merge</span>}
                        </div>
                        {pd.edited_since_merge && changed.length > 0 && (
                          <table className="modal-table" style={{ marginTop: 4 }}>
                            <thead><tr><th>Field changed since merge</th><th>At merge</th><th>Now (Salesforce)</th></tr></thead>
                            <tbody>
                              {changed.map((x) => (
                                <tr key={x.field}>
                                  <td style={{ whiteSpace: 'nowrap' }}>{x.field}</td>
                                  <td><span style={{ userSelect: 'all' }}>{String(x.before == null ? '' : x.before) || '—'}</span></td>
                                  <td><span style={{ userSelect: 'all', color: 'var(--amber)' }}>{String(x.after == null ? '' : x.after) || '—'}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {pd.edited_since_merge && changed.length === 0 && (
                          <div className="muted" style={{ marginTop: 2 }}>Record modified after the merge, but no reviewed field differs (the change may be in a field the snapshot didn't capture).</div>
                        )}
                      </div>
                    );
                  })()}
                  <RestoreDiffDetail id={r.id} onKeepChange={onKeepChange} />
                </td></tr> : null,
              ])}
              {rows.length === 0 && <tr><td colSpan={10} className="muted small">No completed merges to restore.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 4px', fontWeight: 700 }}>Recreate queue <span className="muted small" style={{ fontWeight: 400 }}>(not in Recycle Bin · {recRows.length})</span></p>
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Secondary queue: sets whose losers are gone from the Recycle Bin (window expired or purged), routed here when a restore couldn’t use the bin. Recreate rebuilds the accounts from the pre-merge backup — the new records get <strong>new Salesforce ids</strong>, so external references (Marketing Cloud, data warehouse, etc.) won’t reconnect. User-initiated and gated like restore.
        </p>
        <div className="dt-scroll" style={{ maxHeight: 280 }}>
          <table className="modal-table">
            <thead><tr><th>Diff</th><th>Sel</th><th>#</th><th>Survivor</th><th>Account</th><th>Merged</th><th>Backup</th><th>Reason / considerations</th></tr></thead>
            <tbody>
              {recRows.flatMap((r, i) => [
                <tr key={r.id}>
                  <td><button type="button" onClick={() => toggleDiff(r.id)} title="Diff survivor vs pre-merge snapshot (+ pick fields to keep)" style={{ border: 0, background: 'transparent', color: 'var(--dim)', cursor: 'pointer', padding: 0, font: 'inherit' }}>{diffOpen.has(r.id) ? '▾' : '▸'}</button></td>
                  <td><input type="checkbox" checked={recSel.has(r.id)} disabled={!r.has_snapshot} onChange={() => recToggle(r.id)} aria-label={'Select ' + r.id} /></td>
                  <td>{i + 1}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td><span style={{ userSelect: 'all', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} title="Click to select · triple-click to copy">{r.survivor_account || '—'}</span></td>
                  <td>{r.loser_count}</td>
                  <td><span className="pill" style={{ color: r.has_snapshot ? 'var(--green)' : 'var(--red)' }}>{r.has_snapshot ? '✓ ' + r.snapshot_losers + ' acct / ' + r.snapshot_children + ' child' : '✕ none'}</span></td>
                  <td title={r.reason} className="small">{r.reason}</td>
                </tr>,
                diffOpen.has(r.id) ? <tr key={r.id + '_diff'}><td colSpan={8} style={{ padding: 0 }}><RestoreDiffDetail id={r.id} onKeepChange={onKeepChange} /></td></tr> : null,
              ])}
              {recRows.length === 0 && <tr><td colSpan={8} className="muted small">Nothing here — a set lands in this queue only when a restore can’t use the Recycle Bin.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <div className="seg" style={{ minWidth: 200 }}>
            <button className={'seg-btn' + (recMode === 'simulate' ? ' on' : '')} style={{ flex: 1 }} onClick={() => setRecMode('simulate')}>Simulate</button>
            <button className={'seg-btn' + (recMode === 'execute' ? ' on' : '')} style={{ flex: 1 }} disabled={safe} title={safe ? 'Execution disabled (safe mode)' : ''} onClick={() => setRecMode('execute')}>Execute</button>
          </div>
          {recMode === 'execute' && !safe && (
            <input value={recConfirm} onChange={(e) => setRecConfirm(e.target.value)} placeholder="type RECREATE to confirm" style={{ width: 200 }} />
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }} title="Attach a recreate dossier to the survivor + rebuilt accounts + re-pointed children (Execute; best-effort)">
            <input type="checkbox" checked={attachDossier} onChange={(e) => setAttach(e.target.checked)} /> 📎 dossier
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }} title="Stamp the survivor's usat_was_* fields with 'RECREATE — you' (Execute; best-effort, only if those fields exist)">
            <input type="checkbox" checked={stampMerged} onChange={(e) => setStamp(e.target.checked)} /> stamp
          </label>
          <button className="btn primary" disabled={recBusy || !recCanExecute} onClick={() => runRecreate(true)}>▷ Recreate selected{safe ? ' (off)' : ''}</button>
          <button className="btn" disabled={recBusy || recIds.length === 0} onClick={() => runRecreate(false)}>{recBusy ? 'Running…' : '👁 Simulate recreate (' + recIds.length + ')'}</button>
          {recResult && (
            <span className="muted small" style={{ color: 'var(--accent)' }}>Run {recResult.run_id} ({recResult.mode}): {recResult.recreated || 0} recreated, {recResult.simulated || 0} simulated, {recResult.skipped} skipped, {recResult.failed} failed.</span>
          )}
          {recReport && (
            <span className="muted small">Report written: <span className="mono">{recReport}</span> (+ sweep row)</span>
          )}
          {recResult && (recResult.failed > 0 || recResult.skipped > 0) && runReasons(recResult.run_id).map((r, i) => (
            <p key={i} className="small" style={{ margin: '2px 0 0', color: 'var(--red)' }}>⚠ {r}</p>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>App Recycle Bin <span className="muted small" style={{ fontWeight: 400 }}>(Accounts with <code>IsDeleted=true</code> via queryAll{bin ? ' · ' + bin.rows.length : ''})</span></p>
        <p className="muted small" style={{ margin: '0 0 8px' }}>This is the <strong>app's</strong> view, not the Salesforce Recycle Bin. It lists every Account the API returns as <code>IsDeleted=true</code> (the <code>queryAll</code>/<em>scanAll</em> endpoint), queried live as the tool's <strong>Salesforce write user</strong>. That set is a <strong>superset</strong> of the actual Salesforce Recycle Bin — Salesforce exposes <em>no</em> field for "is in the Recycle Bin," only <code>IsDeleted</code>, so a record that has already been purged from the SF Recycle Bin (15-day expiry, manual empty, or bin-overflow auto-purge) can still appear here during Salesforce's physical-delete lag. Such rows show up but are <strong>not restorable</strong> — a restore attempt detects it and auto-routes the set to the recreate-from-backup queue. The only definitive test of restorability is attempting the restore. “Merged into” is the surviving record a deleted account was merged into.</p>
        {bin && bin.connected && (
          <p className="muted small" style={{ margin: '0 0 8px', fontFamily: 'monospace', fontSize: 11 }}>
            Queried live as <strong>{bin.connected.username || '(unknown user)'}</strong> · org <strong>{bin.connected.org_id || '?'}</strong>{bin.connected.instance_host ? ' · ' + bin.connected.instance_host : ''}{bin.queried_at ? ' · at ' + new Date(bin.queried_at).toLocaleString() : ''}. Use this user + org when checking against Workbench (below) so you're comparing the same org.
          </p>
        )}
        {bin && bin.rows.length > 0 && (
          <details className="muted small" style={{ margin: '0 0 10px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>App Recycle Bin vs. Salesforce Recycle Bin — how to verify in Workbench</summary>
            <div style={{ marginTop: 6 }}>
              <p style={{ margin: '0 0 6px' }}>A record moves through these states. States 2 and 3 look <strong>identical</strong> to any query — both are just <code>IsDeleted=true</code> — which is why this panel can't tell them apart:</p>
              <ol style={{ margin: '0 0 8px 18px', padding: 0 }}>
                <li><strong>Live</strong> — <code>IsDeleted=false</code>. Normal queries see it.</li>
                <li><strong>In Salesforce Recycle Bin</strong> — <code>IsDeleted=true</code>, restorable, shows in the SF bin UI. Lasts ~15 days <em>or until the bin overflows its size cap</em> (Salesforce auto-purges oldest first — so in a busy sandbox, recent records can vanish within hours).</li>
                <li><strong>Purged, physical-delete pending</strong> — gone from the SF bin (not in the UI, <code>undelete</code> fails "not in recycle bin"), but <code>queryAll</code> still returns it <code>IsDeleted=true</code> for a lag window. <strong>This panel shows these; they are not restorable.</strong></li>
                <li><strong>Physically gone</strong> — <code>queryAll</code> returns nothing. The row drops off this panel on its own.</li>
              </ol>
              <p style={{ margin: '0 0 4px' }}>Run these in <strong>Workbench → queries → SOQL Query</strong> with <strong>“Deleted and archived records: Include”</strong> selected (that's Workbench's <code>queryAll</code> switch — a normal query hides deleted rows; note SOQL has no <code>SELECT *</code>, so fields are named explicitly):</p>
              <CopyQuery
                label="All deleted Accounts — latest 100 (with email + member #)"
                sql={"SELECT Id, Name, PersonEmail, cfg_Member_Number__pc, MasterRecordId, LastModifiedDate\nFROM Account\nWHERE IsDeleted = true\nORDER BY LastModifiedDate DESC\nLIMIT 100"}
              />
              <CopyQuery
                label="Check one member by name"
                sql={"SELECT Id, Name, IsDeleted, MasterRecordId, LastModifiedDate\nFROM Account\nWHERE Name = 'Kai German'"}
                note="Change the name to whichever member you're checking."
              />
              <CopyQuery
                label="Check the exact ids shown in this panel"
                sql={`SELECT Id, Name, IsDeleted, MasterRecordId, LastModifiedDate\nFROM Account\nWHERE Id IN (${bin.rows.map((r) => "'" + r.account + "'").join(', ')})`}
              />
              <p style={{ margin: '8px 0 0' }}>If a row comes back <code>IsDeleted=true</code> here but isn't in your <strong>My Recycle Bin</strong> or <strong>Org Recycle Bin</strong> (Setup → Recycle Bin), it's in state 3 — purged but still in Salesforce's lag window. It will drop off this panel once Salesforce finishes physical deletion; until then it's recreate-from-backup, not restore. (Note: <code>IsDeleted=true</code> alone never means "restorable" — only that the record is deleted.)</p>
            </div>
          </details>
        )}
        <div className="dt-scroll" style={{ maxHeight: 300 }}>
          <table className="modal-table">
            <thead><tr><th>#</th><th>Name</th><th>Member #</th><th>Account</th><th>Merged into</th><th>Deleted / modified</th></tr></thead>
            <tbody>
              {(bin ? bin.rows : []).map((r, i) => (
                <tr key={r.account}>
                  <td>{i + 1}</td>
                  <td>{r.name || '—'}</td>
                  <td>{r.member_number || '—'}</td>
                  <td><span style={{ userSelect: 'all', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} title="Click to select · triple-click to copy">{r.account || '—'}</span></td>
                  <td><span style={{ userSelect: 'all', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} title="Click to select · triple-click to copy">{r.master_record_id || '—'}</span></td>
                  <td>{r.last_modified ? new Date(r.last_modified).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {bin && bin.error && <tr><td colSpan={6} className="small" style={{ color: 'var(--red)' }}>Could not read Recycle Bin: {bin.error}</td></tr>}
              {bin && !bin.error && bin.rows.length === 0 && <tr><td colSpan={6} className="muted small">No Accounts returned with <code>IsDeleted=true</code> for this write user — nothing deleted in the queryAll window.</td></tr>}
              {!bin && <tr><td colSpan={6} className="muted small">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

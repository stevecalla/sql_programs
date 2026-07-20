import { useEffect, useState, useCallback } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { api, exportUrl } from '../lib/api.js';
import { track } from '../../../lib/track.js';

// Merge / restore history — TWO collapsible levels over the same audit:
//   1. Job history  — one row per run/job (sets, batches, workers, sec/merge, HONEST run-level API).
//   2. Account history — the immutable per-record audit (unchanged features) + a Job column.
// Expand a job to see its per-account rows; expand an account row to see the field-level diff.
const RESULT_COLOR = {
  done: '#1a8a4f', restored: '#1a8a4f', recreated: '#1a8a4f', simulated: '#3a6ea5',
  skipped: '#854f0b', failed: '#c0392b',
};
const STATUS_COLOR = { done: '#1a8a4f', running: '#3a6ea5', paused: '#854f0b', error: '#c0392b', cancelled: '#854f0b' };
const RESULTS = ['', 'done', 'restored', 'recreated', 'simulated', 'skipped', 'failed'];
const copyCell = { userSelect: 'all', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const shortJob = (id) => (id ? String(id) : '—');
const fmtHms = (s) => (s == null ? '—' : (s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's'));

const FILE_SHARE_HELP = 'Salesforce file shares (ContentDocumentLink) can’t be re-parented with a field '
  + 'update — they are insert/delete only. On restore/recreate the tool ADDITIVELY re-links them: it '
  + 'creates a new share on the loser and KEEPS the survivor’s, so a file is never unshared or lost. '
  + 'Shares captured before this feature (no ContentDocumentId recorded) can’t be recreated automatically '
  + 'and are left on the survivor — run repair_file_shares.js to re-link those. This message is expected, not an error.';
const isFileShareNote = (reason) => /ContentDocumentLink/i.test(String(reason || ''));

function useSort(initialKey = null) {
  const [s, setS] = useState({ key: initialKey, dir: 'asc' });
  const onSort = (key) => setS((p) => (p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const apply = (rows) => {
    if (!s.key) return rows;
    return [...rows].sort((a, b) => {
      const x = a[s.key]; const y = b[s.key];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return r * (s.dir === 'asc' ? 1 : -1);
    });
  };
  const arrow = (key) => (s.key === key ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '');
  return { onSort, apply, arrow };
}

function DiffDetail({ diff, row }) {
  if (!diff || typeof diff !== 'object') {
    const res = row && row.result;
    const why = (res === 'done' || res === 'simulated')
      ? 'No field-level diff for this merge. This row records drift — fields that changed between when the set was queued and when it processed — and there was none, so nothing changed to show. (The survivorship plan actually written to the survivor is shown live on Process Merges; it isn’t stored here.)'
      : (res === 'restored' || res === 'recreated')
        ? 'No field-level changes for this restore — no survivor fields needed resetting (and none were kept), so there is nothing to diff.'
        : (res === 'skipped' || res === 'failed')
          ? ('No field-level changes were made (this set was ' + res + ' — see the Reason column for why).')
          : 'No field-level changes were recorded for this row.';
    return <p className="muted small" style={{ padding: '6px 10px', margin: 0 }}>{why}</p>;
  }
  if (diff.kind === 'merge_drift') {
    const fields = diff.fields || [];
    return (
      <table className="modal-table" style={{ margin: '6px 10px' }}>
        <thead><tr><th>Account</th><th>Field changed since staging</th><th>Staged</th><th>At merge</th></tr></thead>
        <tbody>{fields.map((f, i) => (
          <tr key={i}><td style={copyCell}>{f.account}</td><td>{f.field}</td><td>{String(f.before ?? '') || '—'}</td><td style={{ color: 'var(--amber)' }}>{String(f.after ?? '') || '—'}</td></tr>
        ))}</tbody>
      </table>
    );
  }
  const reset = diff.reset || []; const kept = diff.kept || [];
  return (
    <div style={{ padding: '6px 10px' }}>
      {reset.length > 0 && (
        <table className="modal-table" style={{ marginBottom: kept.length ? 8 : 0 }}>
          <thead><tr><th>Field reset to pre-merge value</th><th>Value</th></tr></thead>
          <tbody>{reset.map((r, i) => (<tr key={i}><td>{r.field}</td><td style={copyCell}>{String(r.value ?? '') || '—'}</td></tr>))}</tbody>
        </table>
      )}
      {kept.length > 0 && <p className="small" style={{ margin: 0 }}>Kept current (not reset): <strong>{kept.join(', ')}</strong></p>}
      {reset.length === 0 && kept.length === 0 && <p className="muted small" style={{ margin: 0 }}>No fields changed.</p>}
    </div>
  );
}

export default function History() {
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(() => new Set());               // expanded account rows (diff)
  const toggle = (id) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sort = useSort();

  // Job history (run-level)
  const [jobs, setJobs] = useState([]);
  const [jobsBusy, setJobsBusy] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(true);                  // collapse the Job history section
  const [acctOpen, setAcctOpen] = useState(true);                  // collapse the Account history section
  const [jobExpanded, setJobExpanded] = useState(() => new Set()); // expanded job rows (their account rows)
  const toggleJob = (k) => setJobExpanded((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const jsort = useSort();

  const load = useCallback(() => {
    setBusy(true); setErr('');
    api.mergeHistoryQuery({ result: result || undefined, q: q || undefined, limit })
      .then((r) => setRows(r.rows || []))
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  }, [result, q, limit]);
  const loadJobs = useCallback(() => {
    setJobsBusy(true);
    api.mergeJobHistory({ limit: 50 }).then((r) => setJobs(r.jobs || [])).catch(() => setJobs([])).finally(() => setJobsBusy(false));
  }, []);
  useEffect(() => { load(); }, [result, limit]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadJobs(); }, [loadJobs]);

  const when = (r) => r.created_at_mtn || r.created_at || '';
  // Honest per-merge comes from the run-level job (total ÷ sets), keyed by job_id (or run_id for single runs).
  const jobsByKey = {}; jobs.forEach((j) => { jobsByKey[j.job_key] = j; });
  const keyOf = (r) => r.job_id || r.run_id;
  const perMerge = (r) => { const j = jobsByKey[keyOf(r)]; return j && j.api_per_merge != null ? j.api_per_merge : null; };
  const acctForJob = (j) => rows.filter((r) => keyOf(r) === j.job_key);
  const exportParams = { result: result || undefined, q: q || undefined, limit: 5000 };

  const SectionHeader = ({ open: isOpen, onClick, title, meta, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={onClick}>
      <span style={{ color: 'var(--dim)' }}>{isOpen ? '▾' : '▸'}</span>
      <strong>{title}</strong>
      {meta ? <span className="muted small">{meta}</span> : null}
      <span style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>{children}</span>
    </div>
  );

  return (
    <div className="mtbl">
      <h2>History</h2>
      <p className="muted small">Every processed set, every run — grouped by job above, per record below. Immutable audit; expand a job for its merges, expand a record for its field-level diff.</p>
      <DatasetStamp />
      {err && <p className="err">{err}</p>}

      {/* ---- Job history (run-level) ---- */}
      <div className="card" style={{ marginTop: 8 }}>
        <SectionHeader open={jobsOpen} onClick={() => setJobsOpen((v) => !v)} title="Job history" meta={'per run · ' + jobs.length + (jobsBusy ? ' · loading…' : '')}>
          <button className="btn" style={{ width: 'auto' }} onClick={() => { track('history_jobs_refresh', { panel: 'merge', view: 'history' }); loadJobs(); }} disabled={jobsBusy}>↻ Refresh</button>
        </SectionHeader>
        {jobsOpen && (
          <div className="dt-scroll" style={{ maxHeight: '42vh', marginTop: 8 }}>
            <table className="modal-table" style={{ width: '100%' }}>
              <thead><tr>
                <th style={{ width: 30 }} />
                <th style={{ cursor: 'pointer' }} onClick={() => jsort.onSort('job_key')}>Job{jsort.arrow('job_key')}</th>
                <th style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => jsort.onSort('when_mtn')}>When (MT){jsort.arrow('when_mtn')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => jsort.onSort('mode')}>Mode{jsort.arrow('mode')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => jsort.onSort('total_sets')}>Sets{jsort.arrow('total_sets')}</th>
                <th style={{ textAlign: 'right' }}>Done</th>
                <th style={{ textAlign: 'right' }} title="Chunk-runs the job fanned into (1 = single run)">Batches</th>
                <th style={{ textAlign: 'right' }} title="Distinct pm2 workers that ran a batch">Workers</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} title="Median batch time ÷ sets — concurrency-proof" onClick={() => jsort.onSort('sec_per_merge')}>sec/merge{jsort.arrow('sec_per_merge')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} title="Whole-run before→after delta of DailyApiRequests (org-wide, approximate)" onClick={() => jsort.onSort('api_total')}>API total{jsort.arrow('api_total')}</th>
                <th style={{ textAlign: 'right' }} title="API total ÷ sets (approx · org-wide)">/merge</th>
                <th style={{ cursor: 'pointer' }} onClick={() => jsort.onSort('status')}>Status{jsort.arrow('status')}</th>
              </tr></thead>
              <tbody>
                {jsort.apply(jobs).map((j) => [
                  <tr key={j.job_key}>
                    <td><button type="button" onClick={() => toggleJob(j.job_key)} title="Show this job's merges" style={{ border: 0, background: 'transparent', color: 'var(--dim)', cursor: 'pointer', padding: 0, font: 'inherit' }}>{jobExpanded.has(j.job_key) ? '▾' : '▸'}</button></td>
                    <td><span className="mono" style={{ fontSize: 12 }} title={j.job_key}>{shortJob(j.job_key)}</span>{j.is_job ? <span className="muted small"> ·job</span> : null}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{j.when_mtn || '—'}</td>
                    <td>{j.mode}{j.kind && j.kind !== 'merge' ? ' · ' + j.kind : ''}</td>
                    <td style={{ textAlign: 'right' }}>{j.total_sets}</td>
                    <td style={{ textAlign: 'right' }}>{j.done}{j.failed ? <span style={{ color: 'var(--red)' }}> ·{j.failed}✗</span> : null}</td>
                    <td style={{ textAlign: 'right' }}>{j.batches}</td>
                    <td style={{ textAlign: 'right' }}>{j.workers || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{j.sec_per_merge != null ? j.sec_per_merge + 's' : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{j.api_total != null ? Number(j.api_total).toLocaleString() : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--dim)' }}>{j.api_per_merge != null ? '≈' + Number(j.api_per_merge).toLocaleString() : '—'}</td>
                    <td><span className="pill" style={{ color: STATUS_COLOR[j.status] || 'var(--dim)' }}>{j.status}</span></td>
                  </tr>,
                  jobExpanded.has(j.job_key) ? (
                    <tr key={j.job_key + '_d'}><td colSpan={12} style={{ padding: 0, background: 'var(--card)' }}>
                      <div style={{ padding: '6px 10px' }}>
                        <div className="muted small" style={{ marginBottom: 4 }}>
                          {j.batches} batch(es) · {j.workers || 1} worker(s) · elapsed {fmtHms(j.seconds)} · API {j.api_total != null ? Number(j.api_total).toLocaleString() + ' total · ≈' + (j.api_per_merge != null ? j.api_per_merge : '—') + '/merge (approx · org-wide)' : 'n/a'}
                        </div>
                        {acctForJob(j).length ? (
                          <table className="modal-table" style={{ width: '100%' }}>
                            <thead><tr><th>When</th><th>Survivor</th><th style={{ textAlign: 'right' }}>Losers</th><th>Result</th><th>Reason</th></tr></thead>
                            <tbody>{acctForJob(j).map((r) => (
                              <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}>{when(r)}</td><td>{r.survivor_name || '—'}</td><td style={{ textAlign: 'right' }}>{r.loser_count}</td><td><span className="pill" style={{ color: RESULT_COLOR[r.result] || 'var(--dim)' }}>{r.result}</span></td><td className="small">{r.reason}</td></tr>
                            ))}</tbody>
                          </table>
                        ) : <p className="muted small" style={{ margin: 0 }}>No matching per-account rows loaded — widen the Account history limit or clear its filters to see them.</p>}
                      </div>
                    </td></tr>
                  ) : null,
                ])}
                {jobs.length === 0 && !jobsBusy && <tr><td colSpan={12} className="muted small">No jobs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Account merge / restore history (per record) ---- */}
      <div className="card" style={{ marginTop: 12 }}>
        <SectionHeader open={acctOpen} onClick={() => setAcctOpen((v) => !v)} title="Account merge / restore history" meta={'per record · ' + rows.length + ' row' + (rows.length === 1 ? '' : 's')}>
          <span className="dl-group"><span className="muted small">Export</span>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/history/export', { ...exportParams, format: 'csv' })}>CSV</a>
            <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/history/export', { ...exportParams, format: 'xlsx' })}>Excel</a>
          </span>
        </SectionHeader>
        {acctOpen && (<>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
          <span className="muted small">Result</span>
          <select className="tb-select" style={{ width: 130 }} value={result} onChange={(e) => setResult(e.target.value)}>
            {RESULTS.map((r) => <option key={r} value={r}>{r === '' ? 'All' : r}</option>)}
          </select>
          <input className="search" style={{ width: 260 }} placeholder="Search name, account id, or source…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} />
          <button className="btn" style={{ width: 'auto' }} onClick={load} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
          <button className="btn" style={{ width: 'auto' }} onClick={() => { track('history_refresh', { panel: 'merge', view: 'history' }); load(); }} disabled={busy} title="Reload the latest history">{busy ? '…' : '↻ Refresh'}</button>
          <span className="muted small">Show</span>
          <select className="tb-select" style={{ width: 90 }} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="pill">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="dt-scroll" style={{ maxHeight: '58vh' }}>
          <table className="modal-table" style={{ width: '100%' }}>
            <thead><tr>
              <th style={{ width: 30 }} />
              <th style={{ width: 40, textAlign: 'right' }}>#</th>
              <th style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => sort.onSort('created_at_mtn')}>When (MT){sort.arrow('created_at_mtn')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('survivor_name')}>Survivor{sort.arrow('survivor_name')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('survivor_account')}>Account{sort.arrow('survivor_account')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('result')}>Result{sort.arrow('result')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('mode')}>Mode{sort.arrow('mode')}</th>
              <th style={{ cursor: 'pointer' }} title="The run/job this record belongs to (see Job history above)" onClick={() => sort.onSort('job_id')}>Job{sort.arrow('job_id')}</th>
              <th style={{ textAlign: 'right' }} title="Run/job API total ÷ sets (approx · org-wide). The exact per-merge API only comes from a serial run.">API /merge</th>
              <th style={{ cursor: 'pointer', textAlign: 'right' }} title="Async Apex recorded for this run (approximate — rollups fire after the merge, so it can read low)" onClick={() => sort.onSort('apex_cost')}>Apex{sort.arrow('apex_cost')}</th>
              <th>Reason</th>
              <th style={{ cursor: 'pointer' }} onClick={() => sort.onSort('environment')}>Env{sort.arrow('environment')}</th>
              <th>Dossier</th>
            </tr></thead>
            <tbody>
              {sort.apply(rows).map((r, i) => [
                <tr key={r.id}>
                  <td><button type="button" onClick={() => toggle(r.id)} title="Show field-level diff" style={{ border: 0, background: 'transparent', color: 'var(--dim)', cursor: 'pointer', padding: 0, font: 'inherit' }}>{open.has(r.id) ? '▾' : '▸'}</button></td>
                  <td style={{ textAlign: 'right', color: 'var(--dim)' }}>{i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r)}</td>
                  <td>{r.survivor_name || '—'}</td>
                  <td><span style={copyCell} title="Click to select · triple-click to copy">{r.survivor_account || '—'}</span></td>
                  <td><span className="pill" style={{ color: RESULT_COLOR[r.result] || 'var(--dim)' }}>{r.result}</span></td>
                  <td>{r.mode}</td>
                  <td><span className="mono" style={{ fontSize: 11 }} title={keyOf(r) || ''}>{keyOf(r) ? shortJob(keyOf(r)) : '—'}</span></td>
                  <td style={{ textAlign: 'right', color: 'var(--dim)' }}>{perMerge(r) != null ? '≈' + perMerge(r).toLocaleString() : '—'}</td>
                  <td style={{ textAlign: 'right' }} title="Async Apex recorded for this run. Rollups fire AFTER the merge commits (deferred), so this reads 0 until the settle re-read lands (~90s) — a dash means 'not yet / deferred', not zero cost.">{r.apex_cost != null && Number(r.apex_cost) > 0 ? Number(r.apex_cost).toLocaleString() : '—'}</td>
                  <td className="small" title={r.reason}>
                    {r.reason}
                    {isFileShareNote(r.reason) && (
                      <span title={FILE_SHARE_HELP} style={{ marginLeft: 4, cursor: 'help', color: 'var(--dim)', borderBottom: '1px dotted var(--dim)' }}>ⓘ file share</span>
                    )}
                  </td>
                  <td>{r.environment || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.dossier_id
                      ? <a className="dl-link" href={exportUrl('/api/salesforce-merge/merge/dossier/' + r.dossier_id + '/download', {})} title={'Download the merge dossier (.xlsx)' + (r.dossier_doc_id ? ' · Salesforce File ' + r.dossier_doc_id : '')}>📎 dossier</a>
                      : <span className="muted small">—</span>}
                  </td>
                </tr>,
                open.has(r.id) ? <tr key={r.id + '_d'}><td colSpan={13} style={{ padding: 0, background: 'var(--card)' }}><DiffDetail diff={r.diff} row={r} /></td></tr> : null,
              ])}
              {rows.length === 0 && !busy && <tr><td colSpan={13} className="muted small">No history rows match — adjust the filters.</td></tr>}
            </tbody>
          </table>
        </div>
        </>)}
      </div>
    </div>
  );
}

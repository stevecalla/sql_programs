// RunPanel.jsx — drives a submission run. Starts the server-side loop, streams progress + the current
// filled-form screenshot over SSE, and exposes the approval gate: Approve / Skip / Approve-all / Stop.
// The run itself is headless on the server; the user reviews each certificate as a screenshot here.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';

const RUNNING = ['launching', 'login', 'running', 'awaiting', 'submitting'];
const STATUS_LABEL = {
  launching: 'Launching browser…', login: 'Signing in to the portal…', running: 'Filling the form…',
  awaiting: 'Waiting for your review', submitting: 'Submitting…', done: 'Run complete',
  stopped: 'Run stopped', error: 'Run error',
};

function ResultsLog({ results }) {
  if (!results.length) return null;
  return (
    <div className="coi-run-results">
      <table className="grid">
        <thead><tr><th>#</th><th>Holder</th><th>Result</th><th>Detail</th></tr></thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i}>
              <td className="coi-rownum">{(r.index != null ? r.index : i) + 1}</td>
              <td>{r.name}</td>
              <td className={r.status === 'failed' ? 'coi-req' : ''}>{r.status}</td>
              <td className="muted small">{r.error || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RunPanel({ request, holders, ready, problems }) {
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [current, setCurrent] = useState(null);   // { index, name, screenshot }
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [autoAll, setAutoAll] = useState(false);
  const [err, setErr] = useState('');
  const esRef = useRef(null);

  useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

  function openStream(id) {
    const es = new EventSource(api.coiRunStreamUrl(id));
    esRef.current = es;
    es.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      switch (m.type) {
        case 'snapshot': setStatus(m.status); setTotal(m.total); setAutoAll(m.autoAll); setResults(m.results || []); if (m.current) setCurrent(m.current); break;
        case 'status': setStatus(m.status); break;
        case 'stage': setCurrent({ index: null, name: m.label, screenshot: m.screenshot || null }); break;
        case 'holder-start': setStatus('running'); setCurrent({ index: m.index, name: m.name, screenshot: null }); break;
        case 'filled': setStatus('running'); setCurrent({ index: m.index, name: m.name, screenshot: m.screenshot }); break;
        case 'awaiting': setStatus('awaiting'); setCurrent((c) => ({ ...(c || {}), index: m.index, name: m.name })); break;
        case 'submitting': setStatus('submitting'); break;
        case 'result': setResults((r) => [...r, { index: m.index, name: m.name, status: m.status, error: m.error }]); break;
        case 'done': setStatus(m.status); if (m.results) setResults(m.results); es.close(); break;
        case 'error': setStatus('error'); setErr(m.error || 'run failed'); if (m.results) setResults(m.results); if (m.screenshot) setCurrent({ index: null, name: 'What the browser saw', screenshot: m.screenshot }); es.close(); break;
        default: break;
      }
    };
    es.onerror = () => { /* EventSource auto-retries; once the run ends the server 404s and we've closed it */ };
  }

  async function start() {
    setErr(''); setResults([]); setCurrent(null); setAutoAll(false);
    const body = { event: request.event, requestor: request.requestor, options: request.options, holders, mode: 'review' };
    const r = await api.coiRunStart(body);
    if (r.status === 200 && r.body.ok) { setRunId(r.body.runId); setTotal(r.body.total); setStatus('launching'); openStream(r.body.runId); }
    else if (r.status === 400 && r.body.problems) setErr('Complete before submitting: ' + r.body.problems.join(', ') + '.');
    else if (r.status === 409) setErr(r.body.error || 'a run is already in progress');
    else setErr((r.body && r.body.error) || 'could not start the run');
  }
  function reset() { if (esRef.current) esRef.current.close(); setRunId(null); setStatus('idle'); setCurrent(null); setResults([]); setErr(''); setAutoAll(false); }

  const approve = () => runId && api.coiRunApprove(runId);
  const skip = () => runId && api.coiRunSkip(runId);
  const stop = () => runId && api.coiRunStop(runId);
  const approveAll = () => { if (runId) { setAutoAll(true); api.coiRunApproveAll(runId); } };

  const running = RUNNING.includes(status);
  const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});

  if (status === 'idle') {
    return (
      <div className="coi-runrow">
        <button className="btn primary" disabled={!ready} onClick={start}>Start submission loop →</button>
        {ready
          ? <span className="muted small">Runs on the server; you approve each certificate (or “Approve all remaining”). Nothing submits without your OK.</span>
          : <span className="coi-req small">Complete before submitting: {(problems || []).join(', ')}.</span>}
      </div>
    );
  }

  return (
    <div className="coi-run">
      <div className="coi-run-status">
        <strong>{STATUS_LABEL[status] || status}</strong>
        <span className="muted small"> · {results.length}/{total} processed
          {counts.submitted ? ` · ${counts.submitted} submitted` : ''}
          {counts.failed ? ` · ${counts.failed} failed` : ''}
          {counts.skipped ? ` · ${counts.skipped} skipped` : ''}
          {autoAll && running ? ' · auto' : ''}
        </span>
      </div>
      {err && <p className="err">{err}</p>}

      {current && current.name && (
        <div className="coi-run-current">
          <div className="muted small">{current.index != null ? `Certificate ${current.index + 1} of ${total}: ` : ''}<strong>{current.name}</strong></div>
          {current.screenshot && <img className="coi-run-shot" src={current.screenshot} alt={'Filled form for ' + current.name} />}
        </div>
      )}

      {status === 'awaiting' && (
        <div className="coi-run-actions">
          <button className="btn primary" onClick={approve}>Approve &amp; submit</button>
          <button className="btn" onClick={skip}>Skip</button>
          <button className="btn" onClick={approveAll}>Approve all remaining</button>
          <button className="btn coi-run-stop" onClick={stop}>Stop</button>
        </div>
      )}
      {running && status !== 'awaiting' && (
        <div className="coi-run-actions"><button className="btn coi-run-stop" onClick={stop}>Stop</button></div>
      )}

      {(status === 'done' || status === 'stopped' || status === 'error') && (
        <>
          <ResultsLog results={results} />
          <div className="coi-run-actions"><button className="btn" onClick={reset}>Start a new run</button></div>
        </>
      )}
    </div>
  );
}

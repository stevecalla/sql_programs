// RunPanel.jsx — drives a submission run. Starts the server-side loop, streams progress + the current
// filled-form screenshot over SSE, and exposes the approval gate: Approve / Skip / Approve-all / Stop.
// The run itself is headless on the server; the user reviews each certificate as a screenshot here.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import { holderOptions } from '../lib/coverage.js';

const RUNNING = ['queued', 'launching', 'login', 'running', 'awaiting', 'submitting'];
const STATUS_LABEL = {
  queued: 'Waiting for a free slot…', launching: 'Launching browser…', login: 'Signing in to the portal…',
  running: 'Filling the form…', awaiting: 'Waiting for your review', submitting: 'Submitting…',
  done: 'Run complete', stopped: 'Run stopped', error: 'Run error',
};

// Portal LOGIN page. (The deep Race-Certificate form link 404s when opened without an authenticated
// CSR24 session, and we can't sign in on the user's behalf — so this lands them on the login page.)
const PORTAL_FORM_URL = 'https://portalv03.csr24.com/mvc/1239375044';

// Open a base64 screenshot at full size. Chrome blocks navigating a new tab to a data: URL, so convert
// to a Blob URL (allowed) and open that.
export function openFull(dataUrl) {
  try {
    const comma = dataUrl.indexOf(',');
    const mime = (dataUrl.slice(0, comma).match(/data:(.*?);base64/) || [])[1] || 'image/png';
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { window.open(dataUrl, '_blank'); }
}

export default function RunPanel({ request, holders, ready, problems, onLog, coverageMode }) {
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [current, setCurrent] = useState(null);   // { index, name, screenshot }
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [autoAll, setAutoAll] = useState(false);
  const [queuePos, setQueuePos] = useState(0);   // position in the server's run queue while status==='queued'
  const [err, setErr] = useState('');
  const esRef = useRef(null);
  const shotsRef = useRef({});   // index -> filled-form screenshot, so the log can link each job's form

  useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);
  // Bubble the results up so the parent can render the persistent Submission-log card (#5).
  useEffect(() => { if (onLog) onLog(results); }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  function openStream(id) {
    const es = new EventSource(api.coiRunStreamUrl(id));
    esRef.current = es;
    es.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      switch (m.type) {
        case 'snapshot': setStatus(m.status); setTotal(m.total); setAutoAll(m.autoAll); if (m.position) setQueuePos(m.position); setResults((prev) => (prev.length ? prev : (m.results || []))); if (m.current) setCurrent(m.current); break;
        case 'queued': setStatus('queued'); setQueuePos(m.position || 0); break;
        case 'status': setStatus(m.status); if (m.status !== 'queued') setQueuePos(0); break;
        case 'stage': setCurrent({ index: null, name: m.label, screenshot: m.screenshot || null }); break;
        case 'holder-start': setStatus('running'); setCurrent({ index: m.index, name: m.name, screenshot: null }); break;
        case 'filled': shotsRef.current[m.index] = m.screenshot; setStatus('running'); setCurrent({ index: m.index, name: m.name, screenshot: m.screenshot }); break;
        case 'awaiting': setStatus('awaiting'); setCurrent((c) => ({ ...(c || {}), index: m.index, name: m.name })); break;
        case 'submitting': setStatus('submitting'); break;
        case 'result': setResults((r) => [...r, { index: m.index, name: m.name, status: m.status, error: m.error, confirmation: m.confirmation || null, at: m.at || Date.now(), formScreenshot: shotsRef.current[m.index] || null, confirmScreenshot: m.confirmShot || null }]); break;
        case 'done': setStatus(m.status); setResults((prev) => (prev.length ? prev : (m.results || []))); es.close(); break;
        case 'error': setStatus('error'); setErr(m.error || 'run failed'); setResults((prev) => (prev.length ? prev : (m.results || []))); if (m.screenshot) setCurrent({ index: null, name: 'What the browser saw', screenshot: m.screenshot }); es.close(); break;
        default: break;
      }
    };
    es.onerror = () => { /* EventSource auto-retries; once the run ends the server 404s and we've closed it */ };
  }

  async function start() {
    setErr(''); setResults([]); setCurrent(null); setAutoAll(false);
    // Attach each holder's effective coverage: per-holder columns when in per-holder mode, else the shared Step 2 options.
    const runHolders = holders.map((h) => ({ ...h, options: coverageMode === 'perHolder' ? holderOptions(h) : request.options }));
    const body = { event: request.event, requestor: request.requestor, options: request.options, holders: runHolders, mode: 'review' };
    const r = await api.coiRunStart(body);
    if (r.status === 200 && r.body.ok) { setRunId(r.body.runId); setTotal(r.body.total); setStatus(r.body.queued ? 'queued' : 'launching'); openStream(r.body.runId); }
    else if (r.status === 400 && r.body.problems) setErr('Complete before submitting: ' + r.body.problems.join(', ') + '.');
    else if (r.status === 409) setErr('A previous run is still active on the server — click “Reset run”, then Start again.');
    else setErr((r.body && r.body.error) || 'could not start the run');
  }
  async function reset() {
    if (esRef.current) esRef.current.close();
    try { await api.coiRunReset(runId || undefined); } catch (e) { /* best-effort */ }
    shotsRef.current = {};
    setRunId(null); setStatus('idle'); setCurrent(null); setResults([]); setErr(''); setAutoAll(false); setQueuePos(0);
  }

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
        <button className="btn" onClick={reset} title="Clear any submission run in progress on the server">Reset run</button>
        <a className="coi-dl" href={PORTAL_FORM_URL} target="_blank" rel="noreferrer" title="Open the CSR24 portal login in a new tab (sign in there to reach the form manually)">Open portal login ↗</a>
        {err
          ? <span className="coi-req small">{err}</span>
          : ready
            ? <span className="muted small">Runs on the server; you approve each certificate (or “Approve all remaining”). Nothing submits without your OK.</span>
            : <span className="coi-req small">Complete before submitting: {(problems || []).join(', ')}.</span>}
      </div>
    );
  }

  return (
    <div className="coi-run">
      <div className="coi-run-status">
        <strong>{STATUS_LABEL[status] || status}</strong>
        {status === 'queued'
          ? <span className="muted small"> · the server is at capacity{queuePos ? ` · #${queuePos} in line` : ''} — your run starts automatically when a slot frees. Keep this open.</span>
          : <span className="muted small"> · {results.length}/{total} processed
              {counts.submitted ? ` · ${counts.submitted} submitted` : ''}
              {counts.failed ? ` · ${counts.failed} failed` : ''}
              {counts.skipped ? ` · ${counts.skipped} skipped` : ''}
              {autoAll && running ? ' · auto' : ''}
            </span>}
        <a className="coi-dl" href={PORTAL_FORM_URL} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }} title="Open the CSR24 portal login in a new tab">Open portal login ↗</a>
      </div>
      {err && <p className="err">{err}</p>}

      {current && current.name && (
        <div className="coi-run-current">
          <div className="coi-run-current-head">
            <span className="muted small">{current.index != null ? `Certificate ${current.index + 1} of ${total}: ` : ''}<strong>{current.name}</strong></span>
            {current.screenshot && <a className="coi-dl" href={current.screenshot} onClick={(e) => { e.preventDefault(); openFull(current.screenshot); }}>Open full ↗</a>}
          </div>
          {current.screenshot && (
            <div className="coi-run-shotwrap">
              <img className="coi-run-shot" src={current.screenshot} alt={'Filled form for ' + current.name} />
            </div>
          )}
        </div>
      )}

      {status === 'awaiting' && (
        <>
          <div className="coi-run-actions">
            <button className="btn primary" onClick={approve} title="Submit a certificate for this holder, then move on">Approve &amp; submit</button>
            <button className="btn" onClick={skip} title="Do NOT submit this holder — move to the next one">Skip (no submit)</button>
            <button className="btn" onClick={approveAll} title="Submit this one and auto-submit all remaining holders">Approve all remaining</button>
            <button className="btn coi-run-stop" onClick={stop} title="Stop the whole run">Stop</button>
          </div>
          <div className="muted small">Approve = submit this certificate · Skip = leave this holder out and go to the next · Approve all remaining = auto-submit the rest.</div>
        </>
      )}
      {running && status !== 'awaiting' && (
        <div className="coi-run-actions"><button className="btn coi-run-stop" onClick={stop}>Stop</button></div>
      )}

      {(status === 'done' || status === 'stopped' || status === 'error') && (
        <div className="coi-run-actions"><button className="btn" onClick={reset}>Start a new run</button><span className="muted small">See the full log in the Submission log below.</span></div>
      )}
    </div>
  );
}

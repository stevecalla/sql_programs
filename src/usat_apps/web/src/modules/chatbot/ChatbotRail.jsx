import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import * as store from './lib/store.js';
import { api } from './lib/api.js';
import ResizeHandle from '../../lib/ResizeHandle.jsx';
import { formatMtnDateTime } from '../../lib/mtnDate.js';   // email-queue timestamp style (MDT)
import './chatbot.css';

// Score → badge color (matches the scorecard's grade bands).
function scoreColor(v) { const n = Number(v); if (!isFinite(n)) return '#64748b'; if (n >= 85) return '#1f9d55'; if (n >= 70) return '#2563eb'; if (n >= 50) return '#c2740c'; return '#c0392b'; }

// QA & Training rail — shown on /chatbot/stress-test instead of the conversation browser. The queue picker
// (which bot is under test) stays relevant; the conversation list is replaced by a RUN HISTORY. Clicking a
// run loads it into the main view via a window event; EvalSection dispatches 'eval-active'/'eval-runs-updated'
// so this list highlights the open run and refreshes when a run finishes.
function QARail({ s }) {
  const [runs, setRuns] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(false);
  const load = () => { setLoading(true); api.evalRuns(30, s.queue || undefined).then((r) => setRuns(r.runs || [])).catch(() => setRuns([])).finally(() => setLoading(false)); };
  useEffect(() => {
    load();   // (re)loads whenever the bot-under-test changes, so the history matches the selected bot
    const onUpd = () => load();
    const onActive = (e) => setActiveId(e && e.detail ? String(e.detail) : '');
    window.addEventListener('usatapps:eval-runs-updated', onUpd);
    window.addEventListener('usatapps:eval-active', onActive);
    return () => { window.removeEventListener('usatapps:eval-runs-updated', onUpd); window.removeEventListener('usatapps:eval-active', onActive); };
  }, [s.queue]);
  const openRun = (rid) => { setActiveId(String(rid)); try { window.dispatchEvent(new CustomEvent('usatapps:eval-load-run', { detail: rid })); } catch (e) { /* non-browser */ } };
  return (
    <>
      <div className="cbx-card cbx-railcard">
        <div className="cbx-cardbody">
          <label className="cbx-lbl">Bot under test</label>
          <select className="cbx-select" value={s.queue} onChange={(e) => store.selectQueue(e.target.value)}>
            {(s.queues || []).length === 0 ? <option value={s.queue || ''}>{s.queue || 'Team USA'}</option> : null}
            {(s.queues || []).map((q) => <option key={q.key} value={q.key}>{q.name || q.label || q.key}</option>)}
          </select>
          <div className="cbx-hint">The stress test grades this bot’s answers against its own knowledge + corrections.</div>
        </div>
      </div>

      <div className="cbx-rail-listhead">
        <span>Run history{runs.length ? ' · ' + runs.length : ''}</span>
        <span className="cbx-listhead-actions">
          <button className="cbx-btn xs" onClick={load} title="Refresh run history">↻</button>
        </span>
      </div>
      <div className="cbx-thread-list">
        {loading ? <div className="cbx-dim cbx-pad">Loading…</div> : null}
        {!loading && runs.length === 0 ? <div className="cbx-dim cbx-pad">No runs yet. Set up a batch on the right and press “Run stress test.”</div> : null}
        {runs.map((r) => (
          <div key={r.run_id} className="cbx-thread-row">
            <button className={'cbx-thread' + (activeId === String(r.run_id) ? ' on' : '')} onClick={() => openRun(r.run_id)} title="Open this run's results">
              <div className="cbx-thread-top">
                <span className="cbx-badge" style={{ background: scoreColor(r.score_overall), color: '#fff' }}>{r.score_overall == null ? '—' : r.score_overall}</span>
                <span className="cbx-thread-time">{r.created_at_mtn || ''}{r.status && r.status !== 'done' ? ' · ' + r.status : ''}</span>
              </div>
              <div className="cbx-thread-prev">{(r.queue || 'bot') + ' · ' + (r.total || 0) + ' question' + ((r.total === 1) ? '' : 's')}</div>
              <div className="cbx-thread-meta">Coverage {r.coverage_pct == null ? '—' : r.coverage_pct + '%'} · Safety {r.safety_pct == null ? '—' : r.safety_pct + '%'}</div>
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

// Conversation browser rail — the default AI Chat Bot rail (Queue & filters + the conversation list).
function ConversationRail({ s }) {
  const curObj = (s.queues || []).find((q) => q.key === s.queue);
  const notSynced = curObj && curObj.aligned === false;
  const threads = s.threads;
  return (
    <>
      <div className="cbx-card cbx-railcard">
        <div className="cbx-cardhead" onClick={store.toggleCard}>
          <h3 className="cbx-h">Queue &amp; filters</h3>
          <span className="cbx-summary">{s.queue ? (((curObj && curObj.name) || s.queue) + (threads ? ' · ' + threads.length + ' shown' : '')) : 'pick a queue'}</span>
          <span className={'cbx-chev' + (s.cardOpen ? ' open' : '')}>›</span>
        </div>
        {s.cardOpen ? (
          <div className="cbx-cardbody">
            <label className="cbx-lbl">Queue</label>
            <select className="cbx-select" value={s.queue} onChange={(e) => store.selectQueue(e.target.value)}>
              {(s.queues || []).map((q) => <option key={q.key} value={q.key}>{q.name || q.label}</option>)}
            </select>
            <div className="cbx-hint">Sets the AI’s knowledge + corrections context.{notSynced ? ' · offline' : ' · synced from Salesforce'}</div>

            <label className="cbx-lbl">Show</label>
            <div className="cbx-seg">
              {[
                ['all', 'All', 'Show every conversation — both test runs and live traffic.'],
                ['1', 'Test', 'Test conversations: ones you created here via “Test the assistant” or the chat bubble. Safe practice runs, not real member traffic.'],
                ['0', 'Live', 'Live conversations: real end-user chats (e.g. the public widget). Excludes your test runs.'],
              ].map(([v, lab, tip]) => (
                <button key={v} className={'cbx-segbtn' + (s.filter === v ? ' on' : '')} onClick={() => store.setFilter(v)} title={tip}>{lab}</button>
              ))}
            </div>

            <label className="cbx-lbl">Dates</label>
            <div className="cbx-hint">Default: yesterday to today.</div>
            <div className="cbx-daterow">
              <label className="cbx-dcol"><span>From</span><input type="date" value={s.from || ''} max={s.to || undefined} onChange={(e) => store.setFrom(e.target.value)} /></label>
              <label className="cbx-dcol"><span>To</span><input type="date" value={s.to || ''} min={s.from || undefined} onChange={(e) => store.setTo(e.target.value)} /></label>
            </div>
            <div className="cbx-presets">
              <button className="cbx-preset" onClick={() => store.preset(7)}>7d</button>
              <button className="cbx-preset" onClick={() => store.preset(30)}>30d</button>
              <button className="cbx-preset" onClick={() => store.preset(90)}>90d</button>
              {(s.from || s.to) ? <button className="cbx-clear" onClick={store.clearDates}>any date</button> : null}
            </div>

            <label className="cbx-lbl">Search</label>
            <input className="cbx-input" placeholder="Search conversations…" value={s.search} onChange={(e) => store.setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') store.view(); }} />

            <button className="cbx-btn primary cbx-viewbtn" onClick={store.view}>View</button>
          </div>
        ) : null}
      </div>

      <div className="cbx-rail-listhead">
        <span>Conversations{threads ? ' · ' + threads.length : ''}</span>
        <span className="cbx-listhead-actions">
          <button className="cbx-btn xs" title={'Delete ALL test conversations for ' + (s.queue || 'this queue')}
            onClick={() => { if (window.confirm('Delete ALL test conversations for ' + (s.queue || 'this queue') + '? This cannot be undone.')) store.clearTest(); }}>Clear test</button>
          <button className="cbx-btn xs" onClick={store.loadThreads} title="Refresh">↻</button>
        </span>
      </div>
      <div className="cbx-thread-list">
        {s.loadingThreads ? <div className="cbx-dim cbx-pad">Loading…</div> : null}
        {!s.loadingThreads && threads && threads.length === 0 ? <div className="cbx-dim cbx-pad">No conversations match. Use “Test the assistant” or the bubble to create one.</div> : null}
        {(threads || []).map((t) => (
          <div key={t.conversation_id} className="cbx-thread-row">
            <button className={'cbx-thread' + (s.selectedId === t.conversation_id ? ' on' : '')} onClick={() => store.selectConversation(t.conversation_id)}>
              <div className="cbx-thread-top">
                <span className={'cbx-badge ' + (t.is_test ? 'test' : 'live')}>{t.is_test ? 'test' : 'live'}</span>
                <span className="cbx-thread-time" title={t.last_utc}>{formatMtnDateTime(t.last_utc)}</span>
              </div>
              <div className="cbx-thread-prev">{t.preview || '(no preview)'}</div>
              <div className="cbx-thread-meta">{t.turns} turn{t.turns === 1 ? '' : 's'} · {t.answers} answer{t.answers === 1 ? '' : 's'}</div>
            </button>
            {t.is_test ? (
              <button className="cbx-thread-del" title="Delete this test conversation"
                onClick={() => { if (window.confirm('Delete this test conversation? This cannot be undone.')) store.deleteConversation(t.conversation_id); }}>🗑</button>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

// Platform left siderail for the AI Chat Bot (mirrors EmailQueueRail). Route-aware: the QA & Training page
// (/chatbot/stress-test) gets a run-history rail; every other chatbot page gets the conversation browser.
// Rendered by App.jsx on /chatbot. Resizable via the trailing ResizeHandle (target='prev' resizes this nav).
export default function ChatbotRail() {
  const s = store.useStore();
  const location = useLocation();
  const isQA = location.pathname.startsWith('/chatbot/stress-test');
  useEffect(() => { store.init(); }, []);
  return (
    <>
      <nav className="siderail cbx-siderail" aria-label="AI Chat Bot" style={{ width: s.railW }}>
        <div className="rail-section">
          <NavLink to="/" end className="rail-link"><span className="rail-ico" aria-hidden="true">‹</span> USAT Apps</NavLink>
        </div>
        {isQA ? <QARail s={s} /> : <ConversationRail s={s} />}
      </nav>

      <ResizeHandle target="prev" dir={1} min={store.RAIL_MIN} max={store.RAIL_MAX} def={store.RAIL_DEF}
        current={() => store.getState().railW} onCommit={store.setRailW}
        title="Drag to resize the queue rail · double-click to reset" />
    </>
  );
}

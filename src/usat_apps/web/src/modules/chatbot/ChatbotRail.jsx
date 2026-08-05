import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import * as store from './lib/store.js';
import ResizeHandle from '../../lib/ResizeHandle.jsx';
import { formatMtnDateTime } from '../../lib/mtnDate.js';   // email-queue timestamp style (MDT)
import './chatbot.css';

// Platform left siderail for the AI Chat Bot (mirrors EmailQueueRail): Queue & filters + the conversation
// list, sharing state with the Section via the store. Rendered by App.jsx on /chatbot. Resizable via the
// trailing ResizeHandle (target='prev' resizes this nav).
export default function ChatbotRail() {
  const s = store.useStore();
  useEffect(() => { store.init(); }, []);
  const curObj = (s.queues || []).find((q) => q.key === s.queue);
  const notSynced = curObj && curObj.aligned === false;
  const threads = s.threads;
  return (
    <>
      <nav className="siderail cbx-siderail" aria-label="AI Chat Bot" style={{ width: s.railW }}>
        <div className="rail-section">
          <NavLink to="/" end className="rail-link"><span className="rail-ico" aria-hidden="true">‹</span> USAT Apps</NavLink>
        </div>

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
                {[['all', 'All'], ['1', 'Test'], ['0', 'Live']].map(([v, lab]) => (
                  <button key={v} className={'cbx-segbtn' + (s.filter === v ? ' on' : '')} onClick={() => store.setFilter(v)}>{lab}</button>
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
          <button className="cbx-btn xs" onClick={store.loadThreads} title="Refresh">↻</button>
        </div>
        <div className="cbx-thread-list">
          {s.loadingThreads ? <div className="cbx-dim cbx-pad">Loading…</div> : null}
          {!s.loadingThreads && threads && threads.length === 0 ? <div className="cbx-dim cbx-pad">No conversations match. Use “Test the assistant” or the bubble to create one.</div> : null}
          {(threads || []).map((t) => (
            <button key={t.conversation_id} className={'cbx-thread' + (s.selectedId === t.conversation_id ? ' on' : '')} onClick={() => store.selectConversation(t.conversation_id)}>
              <div className="cbx-thread-top">
                <span className={'cbx-badge ' + (t.is_test ? 'test' : 'live')}>{t.is_test ? 'test' : 'live'}</span>
                <span className="cbx-thread-time" title={t.last_utc}>{formatMtnDateTime(t.last_utc)}</span>
              </div>
              <div className="cbx-thread-prev">{t.preview || '(no preview)'}</div>
              <div className="cbx-thread-meta">{t.turns} turn{t.turns === 1 ? '' : 's'} · {t.answers} answer{t.answers === 1 ? '' : 's'}</div>
            </button>
          ))}
        </div>
      </nav>

      <ResizeHandle target="prev" dir={1} min={store.RAIL_MIN} max={store.RAIL_MAX} def={store.RAIL_DEF}
        current={() => store.getState().railW} onCommit={store.setRailW}
        title="Drag to resize the queue rail · double-click to reset" />
    </>
  );
}

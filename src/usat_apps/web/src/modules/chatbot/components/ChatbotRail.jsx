import { fmtMtnShort } from './ui.jsx';

// Left rail — one collapsible "Queue & filters" card (same name/behavior as the email queue: shows a summary
// and collapses after you View) + the conversation-thread list below. Lists our OWN logged conversations
// (non-PII), not live Salesforce cases. Reuses the cbx-card/cardhead/summary/chev classes.
export default function ChatbotRail({
  queues, queue, onQueue,
  filter, onFilter, search, onSearch,
  from, to, onFrom, onTo, onPreset, onClearDates,
  cardOpen, onToggleCard, onView,
  threads, loading, selectedId, onSelect, onRefresh,
}) {
  const curObj = (queues || []).find((q) => q.key === queue);
  const notSynced = curObj && curObj.aligned === false;
  const summary = queue ? ((curObj && curObj.name ? curObj.name : queue) + (threads ? ' · ' + threads.length + ' shown' : '')) : 'pick a queue';
  return (
    <aside className="cbx-rail">
      <div className="cbx-card cbx-railcard">
        <div className="cbx-cardhead" onClick={onToggleCard}>
          <h3 className="cbx-h">Queue &amp; filters</h3>
          <span className="cbx-summary">{summary}</span>
          <span className={'cbx-chev' + (cardOpen ? ' open' : '')}>›</span>
        </div>
        {cardOpen ? (
          <div className="cbx-cardbody">
            <label className="cbx-lbl">Queue</label>
            <select className="cbx-select" value={queue} onChange={(e) => onQueue(e.target.value)}>
              {(queues || []).map((q) => <option key={q.key} value={q.key}>{q.name || q.label}</option>)}
            </select>
            <div className="cbx-hint">Sets the AI’s knowledge + corrections context.{notSynced ? ' · name not synced from Salesforce (offline)' : ' · name synced from Salesforce'}</div>

            <label className="cbx-lbl">Show</label>
            <div className="cbx-seg">
              {[['all', 'All'], ['1', 'Test'], ['0', 'Live']].map(([v, lab]) => (
                <button key={v} className={'cbx-segbtn' + (filter === v ? ' on' : '')} onClick={() => onFilter(v)}>{lab}</button>
              ))}
            </div>

            <label className="cbx-lbl">Dates</label>
            <div className="cbx-hint">Default: yesterday to today.</div>
            <div className="cbx-daterow">
              <label className="cbx-dcol"><span>From</span><input type="date" value={from || ''} max={to || undefined} onChange={(e) => onFrom(e.target.value)} /></label>
              <label className="cbx-dcol"><span>To</span><input type="date" value={to || ''} min={from || undefined} onChange={(e) => onTo(e.target.value)} /></label>
            </div>
            <div className="cbx-presets">
              <button className="cbx-preset" onClick={() => onPreset(7)}>7d</button>
              <button className="cbx-preset" onClick={() => onPreset(30)}>30d</button>
              <button className="cbx-preset" onClick={() => onPreset(90)}>90d</button>
              {(from || to) ? <button className="cbx-clear" onClick={onClearDates}>any date</button> : null}
            </div>

            <label className="cbx-lbl">Search</label>
            <input className="cbx-input" placeholder="Search conversations…" value={search} onChange={(e) => onSearch(e.target.value)} />

            <button className="cbx-btn primary cbx-viewbtn" onClick={onView}>View</button>
          </div>
        ) : null}
      </div>

      <div className="cbx-rail-listhead">
        <span>Conversations{threads ? ' · ' + threads.length : ''}</span>
        <button className="cbx-btn xs" onClick={onRefresh} title="Refresh">↻</button>
      </div>
      <div className="cbx-thread-list">
        {loading ? <div className="cbx-dim cbx-pad">Loading…</div> : null}
        {!loading && threads && threads.length === 0 ? <div className="cbx-dim cbx-pad">No conversations match. Use “Test the assistant” or the bubble to create one.</div> : null}
        {(threads || []).map((t) => (
          <button key={t.conversation_id} className={'cbx-thread' + (selectedId === t.conversation_id ? ' on' : '')} onClick={() => onSelect(t.conversation_id)}>
            <div className="cbx-thread-top">
              <span className={'cbx-badge ' + (t.is_test ? 'test' : 'live')}>{t.is_test ? 'test' : 'live'}</span>
              <span className="cbx-thread-time" title={t.last_mtn}>{fmtMtnShort(t.last_mtn)}</span>
            </div>
            <div className="cbx-thread-prev">{t.preview || '(no preview)'}</div>
            <div className="cbx-thread-meta">{t.turns} turn{t.turns === 1 ? '' : 's'} · {t.answers} answer{t.answers === 1 ? '' : 's'}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}

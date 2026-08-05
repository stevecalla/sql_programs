import { useEffect, useRef, useState } from 'react';
import { formatMtnDateTime } from '../../../lib/mtnDate.js';   // email-queue timestamp style (MDT)

const GROUNDED_TIP = "Grounded: this answer was generated with the queue's curated knowledge loaded (Context files + Corrections), so the bot had real material to base its reply on.";
const NOKN_TIP = "No knowledge was loaded for this queue when this answer was generated, so the bot had nothing to ground on and would say it doesn't have the info.";

// Center pane: the selected conversation's transcript. Turns are collapsible (like the email queue's
// Collapse all / Expand all), auto-scroll to the most recent, and can be jumped to top/bottom.
export default function Transcript({ id, turns, loading }) {
  const bodyRef = useRef(null);
  const [collapsed, setCollapsed] = useState({});
  useEffect(() => { setCollapsed({}); }, [id]);
  // roll to the newest turn whenever the conversation or its turns change
  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [turns, loading, id]);

  if (!id) {
    return (
      <div className="cbx-center cbx-center-empty">
        <div className="cbx-empty-card">
          <div className="cbx-empty-emoji">💬</div>
          <h3>Select a conversation</h3>
          <p className="cbx-dim">Pick a conversation from the left, or use <b>Test the assistant</b> on the right to start a new one. Every turn is logged here for review.</p>
        </div>
      </div>
    );
  }

  const list = turns || [];
  const toggle = (tid) => setCollapsed((c) => Object.assign({}, c, { [tid]: !c[tid] }));
  const setAll = (v) => { const c = {}; list.forEach((t) => { c[t.id] = v; }); setCollapsed(c); };
  const toTop = () => { if (bodyRef.current) bodyRef.current.scrollTop = 0; };
  const toBottom = () => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; };

  return (
    <div className="cbx-center">
      <div className="cbx-center-head">
        <span className="cbx-mono" title={id}>{id}</span>
        <span className="cbx-center-actions">
          {list.length ? <span className="cbx-dim">{list.length} turn{list.length === 1 ? '' : 's'}</span> : null}
          <button className="cbx-btn xs" onClick={() => setAll(true)} disabled={!list.length} title="Collapse all turns">Collapse all</button>
          <button className="cbx-btn xs" onClick={() => setAll(false)} disabled={!list.length} title="Expand all turns">Expand all</button>
          <button className="cbx-btn xs" onClick={toTop} disabled={!list.length} title="Scroll to top">↑</button>
          <button className="cbx-btn xs" onClick={toBottom} disabled={!list.length} title="Scroll to newest">↓</button>
        </span>
      </div>
      <div className="cbx-thread-body" ref={bodyRef}>
        {loading ? <div className="cbx-dim cbx-pad">Loading…</div> : null}
        {!loading && list.map((t) => {
          const isCol = !!collapsed[t.id];
          return (
            <div key={t.id} className={'cbx-turn ' + (t.role === 'bot' ? 'bot' : 'user') + (isCol ? ' collapsed' : '')}>
              <div className="cbx-turn-role" onClick={() => toggle(t.id)} title="Click to collapse / expand">
                <span className={'cbx-caret' + (isCol ? '' : ' open')}>›</span>
                {t.role === 'bot' ? 'Assistant' : 'User'}
                <span className="cbx-turn-time">{formatMtnDateTime(t.created_at_utc)}</span>
              </div>
              {isCol
                ? <div className="cbx-turn-prev">{String(t.text || '').replace(/\s+/g, ' ').slice(0, 90)}{(t.text || '').length > 90 ? '…' : ''}</div>
                : <div className="cbx-turn-text">{t.text}</div>}
              {!isCol && t.role === 'bot' && (t.model || t.latency_ms != null) ? (
                <div className="cbx-turn-meta">
                  {t.grounded
                    ? <span className="cbx-tag ok" title={GROUNDED_TIP}>grounded</span>
                    : <span className="cbx-tag warn" title={NOKN_TIP}>no knowledge</span>}
                  {t.model ? <span className="cbx-dim">{t.model}</span> : null}
                  {t.latency_ms != null ? <span className="cbx-dim">{t.latency_ms} ms</span> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { fmtMtn } from './ui.jsx';

// Center pane: the selected conversation's transcript (user/bot turns), with per-answer meta. This is our
// own logged conversation — never a Salesforce email thread, so no member PII appears here.
export default function Transcript({ id, turns, loading }) {
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
  return (
    <div className="cbx-center">
      <div className="cbx-center-head">
        <span className="cbx-mono" title={id}>{id}</span>
        {turns && turns.length ? <span className="cbx-dim">{turns.length} turn{turns.length === 1 ? '' : 's'}</span> : null}
      </div>
      <div className="cbx-thread-body">
        {loading ? <div className="cbx-dim cbx-pad">Loading…</div> : null}
        {!loading && turns && turns.map((t) => (
          <div key={t.id} className={'cbx-turn ' + (t.role === 'bot' ? 'bot' : 'user')}>
            <div className="cbx-turn-role">{t.role === 'bot' ? 'Assistant' : 'User'}<span className="cbx-turn-time">{fmtMtn(t.created_at_mtn)}</span></div>
            <div className="cbx-turn-text">{t.text}</div>
            {t.role === 'bot' && (t.model || t.latency_ms != null) ? (
              <div className="cbx-turn-meta">
                {t.grounded
                  ? <span className="cbx-tag ok" title="Grounded: this answer was generated with the queue's curated knowledge loaded (Context files + Corrections), so the bot had real material to base its reply on.">grounded</span>
                  : <span className="cbx-tag warn" title="No knowledge was loaded for this queue when this answer was generated, so the bot had nothing to ground on and would say it doesn't have the info.">no knowledge</span>}
                {t.model ? <span className="cbx-dim">{t.model}</span> : null}
                {t.latency_ms != null ? <span className="cbx-dim">{t.latency_ms} ms</span> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

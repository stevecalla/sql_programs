import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import './sfeq.css';
import * as store from './lib/store.js';
import ResizeHandle from '../../lib/ResizeHandle.jsx';   // shared grabber (common with the chatbot)

function statusColor(s) { s = String(s || '').toLowerCase(); if (s.includes('clos')) return 'var(--eq-dim)'; if (s.includes('wait')) return 'var(--eq-gold)'; if (s.includes('new')) return 'var(--eq-blue)'; return 'var(--eq-ink)'; }

// Always-visible indicator of which Salesforce org this Email Queue is pointed at (from the module /config
// sf_env). PRODUCTION is red (replies/changes hit real cases); SANDBOX is blue (safe to test). Sits next to
// the "USAT Apps" link in the rail so no one ever sends from the wrong org by accident.
export function SfEnvBadge({ env }) {
  if (!env) return null;
  const isProd = env !== 'sandbox';
  const st = isProd
    ? { color: '#ff6b8a', bg: 'rgba(168,12,52,.18)', bd: '#a80c34', label: 'Production' }
    : { color: '#8fb4e6', bg: 'rgba(58,90,140,.22)', bd: '#3a5a8c', label: 'Sandbox' };
  const tip = isProd
    ? 'Connected to Salesforce PRODUCTION — replies and status changes affect real cases and members.'
    : 'Connected to a Salesforce SANDBOX — safe to test; nothing reaches real members.';
  return (
    <span title={tip} aria-label={'Salesforce ' + st.label}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: '.4px',
        textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, color: st.color, background: st.bg, border: '1px solid ' + st.bd,
        whiteSpace: 'nowrap', flex: '0 0 auto' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color }} />SF · {st.label}
    </span>
  );
}
export function TriageBadge({ t }) {
  if (!t || !t.status) return null;
  const isLocal = t.ai === false;
  const src = isLocal ? 'Local rule (no AI)' : (t.ai === true ? ('AI' + (t.ai_model ? ' · ' + t.ai_model : '')) : '');
  const tip = (src ? src + ' — ' : '') + (t.reason || '');
  const label = (store.TRIAGE_LABEL[t.status] || t.status) + (isLocal ? ' *' : '');
  return <span className={'tstat ' + t.status} title={tip}>{label}</span>;
}

export default function EmailQueueRail() {
  const s = store.useEq();
  useEffect(() => { store.init(); }, []);
  const visible = store.visibleCases();
  const chev = (open) => <span className={'eq-chev' + (open ? ' open' : '')}>›</span>;

  function onView() {
    if (!s.queueId) { store.set({ casesErr: 'Pick a queue first.' }); return; }
    const v = store.validateRange();
    if (!v.ok) { store.set({ casesErr: v.msg }); return; }
    store.set({ search: '', cardOpen: false, casesErr: '' });
    store.loadCounts(); store.loadCases();
  }

  return (
    <>
    <nav className="siderail sfeq sfeq-rail" aria-label="Email Queue" style={{ width: s.railW }}>
      <div className="rail-section">
        <NavLink to="/" end className="rail-link"><span className="rail-ico" aria-hidden="true">‹</span>USAT Apps</NavLink>
      </div>

      <div className="eq-card">
        <div className="eq-cardhead" onClick={() => store.set({ cardOpen: !s.cardOpen })}>
          <h3 className="eq-h" style={{ margin: 0 }}>Queue &amp; filters</h3>
          <span className="eq-summary">{s.queueId ? (store.queueName() + (s.loaded ? ' · ' + visible.length + ' shown' : '')) : 'pick a queue'}</span>
          {chev(s.cardOpen)}
        </div>
        {s.cardOpen ? (
          <div className="eq-cardbody">
            <div className="eq-lbl">Queue</div>
            <select className="eq-fld" value={s.queueId} onChange={(e) => store.selectQueue(e.target.value)}>
              <option value="">- pick a queue -</option>
              {s.queues.map((q) => <option key={q.id} value={q.id}>{q.name}  ({q.open_count != null ? q.open_count : '?'} open)</option>)}
            </select>

            <div className="eq-lbl">Status</div>
            <select className="eq-fld" value={s.status} onChange={(e) => store.setStatusFilter(e.target.value)}>
              <option value="open">Open only</option>
              <option value="all">All statuses</option>
              {s.statuses.map((st) => { const n = s.counts[st]; return <option key={st} value={st}>{st}{n != null ? '  (' + n + ')' : ''}</option>; })}
            </select>

            <div className="eq-subhead" onClick={() => store.set({ datesOpen: !s.datesOpen })}>
              <h3 className="eq-h" style={{ margin: 0 }}>Dates</h3>
              <span className="eq-summary">{s.anyDate ? 'Any date' : (s.from + ' → ' + s.to)}</span>
              {chev(s.datesOpen)}
            </div>
            {s.datesOpen ? (
              <div>
                <div className="dim" style={{ fontSize: 11, margin: '2px 0 6px' }}>Default: yesterday to today (max {store.MAX_RANGE} days, back to {store.MIN_DATE}).</div>
                <div className="eq-two">
                  <div><div className="eq-mini">From</div><input type="date" className="eq-fld" disabled={s.anyDate} min={store.MIN_DATE} max={store.eqToday()} value={s.from} onChange={(e) => { store.set({ from: e.target.value }); store.clampDates(); }} /></div>
                  <div><div className="eq-mini">To</div><input type="date" className="eq-fld" disabled={s.anyDate} value={s.to} onChange={(e) => { store.set({ to: e.target.value }); store.clampDates(); }} /></div>
                </div>
                <div className="eq-inline">
                  <label className="eq-check" style={{ margin: 0 }}><input type="checkbox" checked={s.anyDate} onChange={(e) => store.set({ anyDate: e.target.checked })} /> Any date</label>
                  <span className="dim" style={{ fontSize: 12 }}>by</span>
                  <select className="eq-fld" style={{ margin: 0, flex: 1 }} disabled={s.anyDate} value={s.dateField} onChange={(e) => store.set({ dateField: e.target.value })}>
                    <option value="LastModifiedDate">Last activity</option>
                    <option value="CreatedDate">Created date</option>
                  </select>
                </div>
              </div>
            ) : null}

            <div className="eq-lbl">Search</div>
            <div className="eq-inline">
              <input className="eq-fld" style={{ margin: 0, flex: 1 }} placeholder="Search (subject, status, #, sender, date)…" value={s.search} onChange={(e) => store.set({ search: e.target.value })} />
              <button className="eq-btn sm" title="Clear search" onClick={() => store.set({ search: '' })}>×</button>
            </div>
            <div className="eq-inline" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <label className="eq-check" style={{ margin: 0 }}><input type="checkbox" checked={s.attachOnly} onChange={(e) => store.set({ attachOnly: e.target.checked })} /> Only with attachments</label>
              <span className="eq-inline"><span className="dim" style={{ fontSize: 12 }}>Show</span>
                <select className="eq-fld" style={{ margin: 0, width: 'auto' }} value={String(s.limit)} onChange={(e) => { store.set({ limit: parseInt(e.target.value, 10) || 25 }); if (s.loaded) store.loadCases(); }}>
                  {[25, 50, 100, 200].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                </select>
              </span>
            </div>
            <button className="eq-btn eq-viewbtn" onClick={onView} disabled={s.loadingCases}>{s.loadingCases ? 'Loading…' : 'View'}</button>
            {s.casesErr ? <div className="eq-err">{s.casesErr}</div> : null}
          </div>
        ) : null}
      </div>

      <div className="eq-triageline">
        <button className="eq-btn sm" onClick={() => store.triageVisible()} disabled={!visible.length}>AI triage visible</button>
        <button className="eq-btn sm" title="Clear + re-run triage for the visible cases" onClick={() => store.retriage()} disabled={!Object.keys(s.triage).length}>↻ Refresh</button>
        <span className="dim" style={{ fontSize: 12 }}>{s.triageProg}</span>
      </div>
      <div className="dim" style={{ fontSize: 11, margin: '-2px 0 8px' }} title="Badges marked * were decided by a local rule (no AI cost). Hover a badge for the reason.">* = local rule (no AI) · hover a badge for the reason.</div>

      <div className="eq-caselist">
        {!s.loaded ? <div className="dim">Choose queue, status and dates, then click View.</div>
          : s.loadingCases ? <div className="dim">Loading…</div>
          : !s.cases.length ? <div className="dim">No cases for that queue / status / date range.</div>
          : (
            <>
              {(s.search || s.attachOnly) && visible.length !== s.cases.length
                ? <div className="dim" style={{ fontSize: 12, margin: '0 0 6px' }}>Showing {visible.length} of {s.cases.length}{s.attachOnly ? ' (with attachments)' : ''}{s.search ? ' matching "' + s.search + '"' : ''}</div> : null}
              {s.cases.length >= s.limit
                ? <div className="dim" style={{ fontSize: 12, margin: '0 0 6px' }}>Showing the first {s.cases.length} (by recent activity). Raise "Show" to load more.</div> : null}
              {!visible.length ? <div className="dim">No cases match your search.</div> : null}
              {visible.map((c, i) => {
                const t = s.triage[c.case_id];
                const on = s.sel && s.sel.case_id === c.case_id;
                return (
                  <div key={c.case_id} className={'eq-case' + (on ? ' sel' : '') + (s.checked[c.case_id] ? ' checked' : '')}>
                    <span className="eq-casenum">{i + 1}</span>
                    <input type="checkbox" className="eq-cb" checked={!!s.checked[c.case_id]} onClick={(e) => e.stopPropagation()} onChange={() => store.toggleChecked(c.case_id)} />
                    <div className="eq-casebody" onClick={() => store.selectCase(c)}>
                      <div className="subj">{c.subject || '(no subject)'}</div>
                      <div className="date">{c.modified_mtn || ''}{c.case_number ? ' · #' + c.case_number : ''}</div>
                      <div className="eq-row">
                        {c.status ? <span className="b b-status" style={{ color: statusColor(c.status) }}>{c.status}</span> : null}
                        {t ? <TriageBadge t={t} /> : null}
                        <span className="b b-msg">{c.message_count || 0} msg</span>
                        {c.has_attachment ? <span className="b b-att">attachment</span> : null}
                        {c.link_count ? <span className="b b-link" title={c.link_count + ' link(s) — click to preview'} onClick={(e) => { e.stopPropagation(); store.openLink(c.first_link); }}>🔗 {c.link_count}</span> : null}
                        {s.instanceUrl ? <a className="b b-sf" href={s.instanceUrl + '/lightning/r/Case/' + c.case_id + '/view'} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>SF ↗</a> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
      </div>
    </nav>
    <ResizeHandle target="prev" dir={1} min={store.RAIL_MIN} max={store.RAIL_MAX} def={store.RAIL_DEF}
      current={() => store.getState().railW} onCommit={store.setRailW} title="Drag to resize the queue rail · double-click to reset" />
    </>
  );
}

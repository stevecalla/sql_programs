// Shared metrics chrome for the platform Usage-metrics page and the SF Merge metrics page.
// The two pages read DIFFERENT tables (usat_apps_events vs salesforce_merge_events) and render
// different stat cards / funnels / charts / tables, but the top control surface is identical.
// This component owns that surface so the pages don't duplicate it: header + last-activity, an
// optional scope slot, the period buttons, Refresh, Auto-refresh, an optional Include-test toggle,
// Purge, and the admin-only "flag my activity as test" toggle. Purely presentational — every piece
// of state and every handler is passed in. AskPanel (the "Ask your data" wrapper) is exported
// alongside so each page drops in its own AskData (which talks to its own backend) without
// re-writing the wrapper markup.

const PERIODS = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']];

export default function MetricsControls({
  title, lastActivity, scopeSlot,
  days, onDays,
  auto, onAuto,
  includeTest,            // optional { checked, onChange, title } -> renders the Include-test toggle
  onRefresh,
  isAdmin,
  showPurge, onPurge, purgeMsg,
  mtestOn, onToggleMtest,
}) {
  return (
    <>
      <div className="mx-ph" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}>{title}</h2>
        <span className="mx-last" style={{ marginLeft: 'auto' }}>
          <span className="mx-last-label">Last user activity</span>
          <span className="mx-last-val">{lastActivity || '—'}</span>
        </span>
      </div>

      {scopeSlot || null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '10px 0 16px' }}>
        <div className="mx-periods">
          {PERIODS.map(([n, lbl]) => (
            <button key={n} className={days === n ? 'active' : ''} onClick={() => onDays(n)}>{lbl}</button>
          ))}
        </div>
        <button className="btn" onClick={onRefresh}>↻ Refresh</button>
        <label className="mx-auto"><input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} /> Auto-refresh</label>
        {includeTest && (
          <label className="mx-auto" title={includeTest.title || 'Include is_test=1 rows in every card/table.'}>
            <input type="checkbox" checked={includeTest.checked} onChange={(e) => includeTest.onChange(e.target.checked)} /> Include test rows
          </label>
        )}
        {showPurge && <button className="btn mx-purge" onClick={onPurge}>Purge test</button>}
        {purgeMsg && <span className="muted small">{purgeMsg}</span>}
        {isAdmin && (
          <label className="mx-auto" style={{ marginLeft: 'auto' }} title="Turns on ?metrics_test=1 for ALL your activity so it is flagged is_test and kept out of the real figures.">
            <input type="checkbox" checked={mtestOn} onChange={onToggleMtest} /> Flag my activity as test (?metrics_test=1)
          </label>
        )}
      </div>
    </>
  );
}

export function AskPanel({ children }) {
  return (
    <div className="mx-panel">
      <h2>Ask your data <span className="dim" style={{ fontWeight: 400, fontSize: 13, textTransform: 'none', letterSpacing: 0 }}>— read-only AI</span></h2>
      {children}
    </div>
  );
}

import { useState } from 'react';

// Shared SQL reference for the metrics pages. One collapsible panel with two groups — "Recreate tables (DDL)"
// from report.schema ({ tableName: ddl }) and "Metric queries (SELECT)" from report.queries ([{ label, sql }],
// the exact aggregations with the current window/test filter already substituted). EACH block is individually
// collapsible (click its title) so you expand only the query you want; each has a Copy button. Sourced from the
// module code so nothing drifts. Returns null if empty.
export default function SqlReference({ schema, queries, title }) {
  const [open, setOpen] = useState(false);       // outer panel
  const [openIds, setOpenIds] = useState({});    // per-block open state
  const [copied, setCopied] = useState('');
  const tables = (schema && typeof schema === 'object') ? Object.keys(schema).filter((k) => schema[k]) : [];
  const list = Array.isArray(queries) ? queries.filter((q) => q && q.sql) : [];
  if (!tables.length && !list.length) return null;

  const toggleId = (id) => setOpenIds((m) => Object.assign({}, m, { [id]: !m[id] }));
  const copy = (id, text) => { try { navigator.clipboard.writeText(text || ''); setCopied(id); setTimeout(() => setCopied(''), 1500); } catch (e) { /* clipboard blocked */ } };

  const groupLabel = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', margin: '10px 0 6px' };
  const preStyle = { overflow: 'auto', background: 'var(--bg, #0b1220)', borderTop: '1px solid var(--line)', borderRadius: '0 0 8px 8px', padding: '10px 12px', fontSize: 12, lineHeight: 1.5, margin: 0 };

  const block = (id, label, text, mono) => {
    const isOpen = !!openIds[id];
    return (
      <div key={id} style={{ border: '1px solid var(--line)', borderRadius: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' }} onClick={() => toggleId(id)}>
          <span style={{ fontSize: 11, color: 'var(--muted)', width: 10 }}>{isOpen ? '▾' : '▸'}</span>
          <b className={mono ? 'mono' : undefined} style={{ fontSize: 13 }}>{label}</b>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={(e) => { e.stopPropagation(); copy(id, text); }}>{copied === id ? 'Copied ✓' : 'Copy'}</button>
        </div>
        {isOpen && <pre style={preStyle}><code>{text}</code></pre>}
      </div>
    );
  };

  return (
    <div className="mx-panel">
      <h2 style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setOpen((o) => !o)}>
        {title || 'SQL reference'} <span className="dim" style={{ fontWeight: 400, fontSize: 13, textTransform: 'none', letterSpacing: 0 }}>— recreate the tables + pull any metric by hand</span>
        <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13 }}>{open ? '− Hide' : '+ Show'}</span>
      </h2>
      {open && (
        <div style={{ marginTop: 6 }}>
          {tables.length > 0 && (
            <>
              <div style={groupLabel}>Recreate tables (DDL)</div>
              {tables.map((name) => block('t:' + name, name, schema[name], true))}
            </>
          )}
          {list.length > 0 && (
            <>
              <div style={groupLabel}>Metric queries (SELECT)</div>
              {list.map((q, i) => block('q:' + i, q.label, q.sql, false))}
            </>
          )}
          <p className="muted small">Click a title to expand its SQL. Sourced from the module code so they can't drift; DDL is idempotent (<code>CREATE TABLE IF NOT EXISTS</code>), and the SELECTs have the <b>current period and test filter already filled in</b> — copy one and run it read-only against the app DB.</p>
        </div>
      )}
    </div>
  );
}

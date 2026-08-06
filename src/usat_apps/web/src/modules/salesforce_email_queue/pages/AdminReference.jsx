import { ReorderableCards } from '../../../lib/ReorderableList.jsx';   // shared collapsible + drag-reorder cards

// Email Queue admin → Reference. System reference facts. Card is collapsible + drag-reorderable via the
// shared component. Read-only, no endpoints.
export default function AdminReference() {
  const items = [{
    key: 'reference', title: 'System reference', defaultOpen: true, children: (
      <ul style={{ lineHeight: 1.9, margin: 0, paddingLeft: 18 }}>
        <li><b>Analytics table:</b> <code>salesforce_email_queue_events</code> (local MySQL; created on startup).</li>
        <li><b>Ask-your-data:</b> natural-language questions run one read-only, guarded <code>SELECT</code> over that same events table (single-statement, this table only, capped) — see the Metrics page.</li>
        <li><b>Test mode:</b> open a page with <code>?metrics_test=1</code> → events are flagged <code>is_test=1</code> (per URL only), purgeable from the Metrics page. The Admin/Metrics links carry it; normal queue work is real (no flag), so it always counts.</li>
        <li><b>No member PII is stored:</b> counts / enums + operator staff username + queue name only — never message content.</li>
        <li>Admin pages reuse the platform session with role <code>admin</code> (no second login). This area is granted via the <b>Email Queue admin</b> panel in Users &amp; access.</li>
        <li>Sensitive data lives OUTSIDE the repo (in the module data dir): <code>config.json</code> (settings), <code>queue_access.json</code> (queue allow-list), the operator corrections DB table, and the shared context-files folder.</li>
        <li><b>Env:</b> <code>SF_PROD_*</code> / <code>SF_DEV_*</code> (Salesforce), <code>OPENAI_API_KEY</code> / <code>ANTHROPIC_API_KEY</code> (+ <code>OPENAI_MODEL</code> / <code>ANTHROPIC_MODEL</code> defaults), and the platform MySQL credentials — all in the repo-root <code>.env</code>.</li>
      </ul>
    )
  }];
  return (
    <div className="page">
      <h2>Email Queue · Reference</h2>
      <ReorderableCards storageKey="eq_admin_reference" items={items} />
    </div>
  );
}

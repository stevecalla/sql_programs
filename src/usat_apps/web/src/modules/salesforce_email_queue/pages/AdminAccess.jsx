// Email Queue admin → Access. MOVED: queue access is now managed in the shared Knowledge & AI admin
// (/admin/knowledge), the single place the chatbot's queue picker and the email queue both honor. This page
// is a pointer so old links/tabs don't 404.
export default function AdminAccess() {
  return (
    <div className="page">
      <h2>Email Queue · Access</h2>
      <div className="card">
        <h3>Queue access has moved</h3>
        <p className="muted small">Which Salesforce <b>queues each non-admin user can see</b> is now managed in <a href="/admin/knowledge"><b>Admin → Knowledge &amp; AI → Queue access</b></a>. It’s the shared allow-list that both the chatbot and the email queue honor, so there’s one place to set it. App logins and roles are still in <a href="/admin/users">Users &amp; access</a>.</p>
      </div>
    </div>
  );
}

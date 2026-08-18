'use strict';
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
// READ-ONLY Salesforce "can we send email?" capability probe for the email-queue module.
// Connects as the SAME integration user the app uses (write role) and reports whether that user can:
//   - create EmailMessage (log an outbound reply on a case thread)
//   - edit Case (change status / close)
//   - use a verified Org-Wide Email Address (the "from" address)
//   - has the "Send Email" user permission
// It ONLY describes objects and runs SELECT queries. It never creates, updates, or sends anything.
//   node src/usat_apps/modules/salesforce_email_queue/check_sf_send_capability.js [--sandbox]
const sf = require('./sf');

function line(ok, label, detail) {
  console.log((ok === true ? 'PASS ' : ok === false ? 'FAIL ' : '···  ') + label + (detail ? '  — ' + detail : ''));
}

(async () => {
  const is_test = process.argv.includes('--sandbox');
  console.log('=== SF send-capability probe (READ-ONLY) · ' + (is_test ? 'SANDBOX' : 'PRODUCTION') + ' ===');
  let r;
  try {
    r = await sf.connect({ is_test: is_test, role: 'write' });
    console.log('Connected: ' + (r.label || (is_test ? 'sandbox' : 'production')) + ' · org ' + (r.org_id || '(unknown)') + (r.mode ? ' · auth ' + r.mode : '') + (r.username ? ' · soap-user ' + r.username : ''));
  } catch (e) { console.error('FAIL connect: ' + ((e && e.message) || e)); process.exit(1); }
  const conn = r.conn;

  // Who are we, really (the run-as user behind the External Client App under OAuth)?
  let userId = '';
  try {
    const id = await conn.identity();
    userId = id.user_id || '';
    line(null, 'Identity', (id.username || '') + '  (name: ' + (id.display_name || '') + ', id: ' + userId + ')');
  } catch (e) {
    try { if (conn.userInfo && conn.userInfo.id) userId = conn.userInfo.id; } catch (e2) { /* noop */ }
    line(null, 'Identity', 'conn.identity() unavailable (' + ((e && e.message) || e) + ')' + (userId ? ' — using userInfo id ' + userId : ''));
  }

  // User details (type / profile / active) — API-only integration users sometimes have send restrictions.
  if (userId) {
    try {
      const u = (await conn.query("SELECT Name, Username, UserType, IsActive, Profile.Name FROM User WHERE Id = '" + userId + "'")).records[0] || {};
      line(null, 'User', (u.Name || '') + ' · type ' + (u.UserType || '?') + ' · profile ' + ((u.Profile && u.Profile.Name) || '?') + ' · active ' + (u.IsActive === true));
    } catch (e) { line(null, 'User', 'lookup failed: ' + ((e && e.message) || e)); }
  }

  // Create EmailMessage? (needed to log the outbound reply on the case thread)
  try {
    const d = await conn.sobject('EmailMessage').describe();
    line(!!d.createable, 'Create EmailMessage', d.createable ? 'can log outbound replies on a case' : 'NOT createable by this user');
  } catch (e) { line(false, 'Create EmailMessage', 'describe failed: ' + ((e && e.message) || e)); }

  // Edit Case? (needed only if we also change status / close on send)
  try {
    const d = await conn.sobject('Case').describe();
    line(!!d.updateable, 'Edit Case (status/close)', d.updateable ? 'can update cases' : 'read-only on Case');
  } catch (e) { line(false, 'Edit Case (status/close)', 'describe failed: ' + ((e && e.message) || e)); }

  // "Send Email" user permission — via any assigned permission set OR the profile (profiles appear here too).
  if (userId) {
    try {
      const rows = (await conn.query(
        "SELECT PermissionSet.Name, PermissionSet.IsOwnedByProfile, PermissionSet.PermissionsSendEmail " +
        "FROM PermissionSetAssignment WHERE AssigneeId = '" + userId + "'")).records || [];
      const granting = rows.filter(function (x) { return x.PermissionSet && x.PermissionSet.PermissionsSendEmail === true; });
      line(granting.length > 0, 'Send Email permission',
        granting.length ? 'granted via ' + granting.map(function (x) { return x.PermissionSet.Name + (x.PermissionSet.IsOwnedByProfile ? ' (profile)' : ' (permset)'); }).join(', ')
                        : 'NOT granted by profile or any permission set');
    } catch (e) { line(null, 'Send Email permission', 'could not evaluate: ' + ((e && e.message) || e)); }
  }

  // Verified Org-Wide Email Addresses (the "from" the reply is sent as).
  try {
    const owe = (await conn.query("SELECT Id, Address, DisplayName, IsAllowAllProfiles FROM OrgWideEmailAddress ORDER BY DisplayName")).records || [];
    line(owe.length > 0, 'Org-Wide Email Addresses', owe.length + ' found');
    owe.slice(0, 15).forEach(function (o) { console.log('     - ' + (o.DisplayName || '') + '  <' + (o.Address || '') + '>  ' + (o.IsAllowAllProfiles ? '[all profiles]' : '[restricted profiles]') + '  id=' + o.Id); });
    if (!owe.length) console.log('     (none — a verified from-address must exist to send as a support inbox)');
  } catch (e) { line(false, 'Org-Wide Email Addresses', 'query failed: ' + ((e && e.message) || e)); }

  console.log('=== done — nothing was written or sent ===');
  process.exit(0);
})();

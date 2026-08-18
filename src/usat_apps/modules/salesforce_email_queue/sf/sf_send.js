'use strict';
// Outbound: send a case reply THROUGH Salesforce so SF delivers the email to the member AND logs it as an
// outbound EmailMessage on the case thread (SF handles delivery + threading + the email-to-case token). Uses
// the standard "emailSimple" invocable action, related to the Case. Connection is INJECTED (write role).
// MVP: text body, single/again recipient string, verified org-wide "from"; no attachments, no HTML template.
function esc(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// Pull a human-readable message out of a Salesforce/jsforce error (its .message is often a JSON blob of the
// invocable-action result). Falls back to the raw text.
function clean_sf_error(e) {
  let m = (e && e.message) || String(e || 'error');
  try {
    const j = JSON.parse(m);
    const arr = Array.isArray(j) ? j : [j];
    const msgs = [];
    arr.forEach(function (a) { (a && a.errors ? a.errors : []).forEach(function (x) { if (x && (x.message || x.statusCode)) msgs.push(x.message || x.statusCode); }); });
    if (msgs.length) return msgs.join('; ');
  } catch (e2) { /* not JSON — use as-is */ }
  return m;
}

// Resolve a verified Org-Wide Email Address id from its address, so we can send "as" that support inbox.
async function resolve_owe_id(conn, address) {
  if (!address) return null;
  try {
    const r = await conn.query("SELECT Id, Address FROM OrgWideEmailAddress WHERE Address = '" + esc(address) + "' LIMIT 1");
    return (r.records && r.records[0] && r.records[0].Id) || null;
  } catch (e) { return null; }
}

// Log the outbound reply as an EmailMessage ON the case, so it appears in the case's Emails list in Salesforce
// AND in the app's thread (which reads EmailMessage WHERE ParentId = case). emailSimple only DELIVERS the mail;
// it doesn't reliably create this record — so we create it explicitly. Best-effort: a failure here doesn't
// undo the (already delivered) email; we just report that it couldn't be logged.
async function log_outbound(conn, o) {
  try {
    const rec = await conn.sobject('EmailMessage').create({
      ParentId: o.caseId,
      Incoming: false,
      Status: '3',                                          // 3 = Sent
      Subject: String(o.subject || '').slice(0, 3000),
      TextBody: o.body,
      ToAddress: o.to,
      FromAddress: o.from || undefined,
      MessageDate: new Date().toISOString(),
    });
    if (rec && (rec.success || rec.id)) return { logged: true, id: rec.id };
    return { logged: false, error: (rec && rec.errors && JSON.stringify(rec.errors)) || 'EmailMessage create failed' };
  } catch (e) { return { logged: false, error: clean_sf_error(e) }; }
}

// Send one reply on a case. opts: { case_id, to, from, subject, body, sender_user }.
// 1) DELIVER via the emailSimple action; 2) LOG an outbound EmailMessage on the case. Returns status of both.
async function send_case_email(conn, opts) {
  const o = opts || {};
  const caseId = String(o.case_id || '');
  const to = String(o.to || '').trim();
  const body = String(o.body || '');
  if (!caseId) throw new Error('case_id required');
  if (!to) throw new Error('a recipient (to) is required');
  if (!body.trim()) throw new Error('the reply body is empty');

  const version = conn.version || '59.0';
  const path = '/services/data/v' + version + '/actions/standard/emailSimple';
  const oweId = await resolve_owe_id(conn, o.from);

  // One delivery attempt. withOwe=true sends "as" the org-wide address; false sends as the connected user.
  async function attempt(withOwe) {
    const input = { emailAddresses: to, emailSubject: String(o.subject || '').slice(0, 3000), emailBody: body };
    if (withOwe && oweId) { input.senderType = 'OrgWideEmailAddress'; input.orgWideEmailAddressId = oweId; }
    let res;
    try { res = await conn.requestPost(path, { inputs: [input] }); }
    catch (e) { throw new Error(clean_sf_error(e)); }      // 4xx -> jsforce throws with a JSON body; clean it
    const r0 = Array.isArray(res) ? res[0] : res;
    if (r0 && r0.isSuccess === false) throw new Error(clean_sf_error({ message: JSON.stringify([r0]) }));
    return { ok: true };
  }

  // ---- 1) DELIVER: prefer the org-wide "from"; fall back to the connected user if SF rejects it ----
  let result;
  if (oweId) {
    try { await attempt(true); result = { sent_as: 'orgwide', from_used: o.from, effective_from: o.from }; }
    catch (e) {
      await attempt(false);
      result = { sent_as: 'user', from_used: null, effective_from: o.sender_user || '', note: 'The “From” address (' + o.from + ') was rejected by Salesforce — sent from your Salesforce user instead. (SF: ' + e.message + ')' };
    }
  } else {
    await attempt(false);
    result = { sent_as: 'user', from_used: null, effective_from: o.sender_user || '' };
  }

  // ---- 2) LOG on the case (best-effort) ----
  const logres = await log_outbound(conn, { caseId: caseId, from: result.effective_from, to: to, subject: o.subject, body: body });
  return Object.assign({ ok: true, id: logres.id || null }, result, { logged: logres.logged, log_error: logres.error || null });
}

// Send via the deployed Apex REST class (CaseReplyService @ /services/apexrest/caseReply). Apex relates the
// email to the Case (setWhatId) so Salesforce threads it AND logs the outbound EmailMessage itself — so we do
// NOT also call log_outbound here. Optional org-wide "from" is passed through (used once those addresses are verified).
async function send_case_email_apex(conn, opts) {
  const o = opts || {};
  const caseId = String(o.case_id || '');
  const to = String(o.to || '').trim();
  const body = String(o.body || '');
  if (!caseId) throw new Error('case_id required');
  if (!to) throw new Error('a recipient (to) is required');
  if (!body.trim()) throw new Error('the reply body is empty');

  const oweId = await resolve_owe_id(conn, o.from);
  const payload = { caseId: caseId, toAddress: to, subject: String(o.subject || ''), body: body };
  if (oweId) payload.orgWideEmailAddressId = oweId;

  let res;
  try { res = await conn.requestPost('/services/apexrest/caseReply', payload); }
  catch (e) { throw new Error(clean_sf_error(e)); }   // 4xx/5xx from Apex -> jsforce throws
  if (res && res.success === false) throw new Error(res.error || 'Apex CaseReplyService rejected the send');
  return { ok: true, via: 'apex', sent_as: oweId ? 'orgwide' : 'user', from_used: oweId ? o.from : null, logged: true };
}

module.exports = { send_case_email, send_case_email_apex, resolve_owe_id, log_outbound };

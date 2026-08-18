'use strict';
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
// READ-ONLY: discover the Email-to-Case routing / "from" addresses actually in use PER QUEUE. Small sample:
// take a few RECENT cases per queue, then read only THOSE cases' emails (selective — avoids the polymorphic
// EmailMessage scan that hits SF's "100000 distinct ids" limit). For each queue it shows:
//   - inbound "To"  = the routing address customers emailed (the queue's Email-to-Case address)
//   - outbound "From" = what replies actually went out as (e.g. teamusa@ from a native case reply)
// Queries only — writes/sends nothing.
//   node src/usat_apps/modules/salesforce_email_queue/check_sf_routing_addresses.js [--sandbox] [--per N]
const sf = require('./sf');

function argv_val(name, def) { const i = process.argv.indexOf(name); return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : def; }
function soql_ids(ids) { return ids.map(function (x) { return "'" + String(x).replace(/'/g, '') + "'"; }).join(','); }
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
function fmt(map) { const ks = Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }); return ks.length ? ks.map(function (a) { return a + ' (' + map[a] + ')'; }).join(', ') : '—'; }

(async () => {
  const is_test = process.argv.includes('--sandbox');
  const per = Math.max(1, Math.min(50, Number(argv_val('--per', '6')) || 6));   // recent cases sampled per queue
  console.log('=== Email-to-Case routing/from addresses per queue (READ-ONLY) · ' + (is_test ? 'SANDBOX' : 'PRODUCTION') + ' ===');
  let r;
  try { r = await sf.connect({ is_test: is_test, role: 'read' }); console.log('Connected: ' + (r.label || '') + ' · org ' + (r.org_id || '') + (r.username ? ' · ' + r.username : '')); }
  catch (e) { console.error('FAIL connect: ' + ((e && e.message) || e)); process.exit(1); }
  const conn = r.conn;

  let queues = [];
  try { queues = (await conn.query("SELECT Id, Name FROM Group WHERE Type = 'Queue' ORDER BY Name")).records || []; }
  catch (e) { console.error('FAIL list queues: ' + ((e && e.message) || e)); process.exit(1); }
  console.log('Sampling up to ' + per + ' recent case(s) per queue across ' + queues.length + ' queues…\n');

  // Recent cases per queue (selective by OwnerId).
  const caseOwner = {};
  for (const q of queues) {
    try { (await conn.query("SELECT Id FROM Case WHERE OwnerId = '" + q.Id + "' ORDER BY LastModifiedDate DESC LIMIT " + per)).records.forEach(function (c) { caseOwner[c.Id] = q.Id; }); }
    catch (e) { /* skip this queue */ }
  }
  const caseIds = Object.keys(caseOwner);

  // Emails for ONLY those cases (ParentId IN <specific ids> is selective — no polymorphic explosion).
  const byQ = {};
  for (const grp of chunk(caseIds, 150)) {
    let ems = [];
    try { ems = (await conn.query("SELECT Incoming, FromAddress, ToAddress, ParentId FROM EmailMessage WHERE ParentId IN (" + soql_ids(grp) + ")")).records || []; }
    catch (e) { console.error('  (email chunk failed: ' + ((e && e.message) || e) + ')'); }
    ems.forEach(function (m) {
      const qid = caseOwner[m.ParentId]; if (!qid) return;
      const o = byQ[qid] || (byQ[qid] = { inbound_to: {}, outbound_from: {}, n: 0 });
      o.n++;
      if (m.Incoming) { String(m.ToAddress || '').split(/[;,]/).forEach(function (a) { a = a.trim().toLowerCase(); if (a) o.inbound_to[a] = (o.inbound_to[a] || 0) + 1; }); }
      else { const a = String(m.FromAddress || '').trim().toLowerCase(); if (a) o.outbound_from[a] = (o.outbound_from[a] || 0) + 1; }
    });
  }

  queues.forEach(function (q) {
    const o = byQ[q.Id];
    console.log('▶ ' + q.Name + '  [QUEUE]' + (o ? '  · ' + o.n + ' emails' : '  · no emails in sample'));
    if (o) {
      console.log('    inbound  To  (customers emailed): ' + fmt(o.inbound_to));
      console.log('    outbound From (replies sent as):  ' + fmt(o.outbound_from));
    }
  });
  console.log('\n=== done — nothing was written or sent ===');
  process.exit(0);
})();

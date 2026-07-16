'use strict';
// Repair file shares after a restore — re-attach a restored loser's Files that stayed on the survivor.
//
// Why this exists: when two accounts merge, Salesforce moves the losers' file shares
// (ContentDocumentLink) onto the survivor. A ContentDocumentLink's LinkedEntityId is NOT updateable, so
// older restores couldn't move those shares back and the files look "missing" on the restored loser
// (they're actually still on the survivor — never deleted). This tool re-links each such file to the
// loser it belonged to.
//
// SAFE: purely ADDITIVE. It only CREATES ContentDocumentLinks (grants the loser access again). It never
// deletes a link, moves a file, or touches the ContentDocument. Dry-run by default; --apply to write.
//
//   node modules/salesforce_merge/repair_file_shares.js --queue 5           # dry run (no writes)
//   node modules/salesforce_merge/repair_file_shares.js --queue 5 --apply   # create the missing loser links
//   add --prod for production (default sandbox). Run where the SF_* env is loaded (or: node -r dotenv/config ...).
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }
const { query: db } = require('../../store/db');
const W = require('./store/salesforce_write');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const nxt = process.argv[i + 1];
  return (nxt && !nxt.startsWith('--')) ? nxt : true;
}
const soqlIn = (arr) => arr.map((x) => "'" + String(x).replace(/'/g, '') + "'").join(',');

async function main() {
  const queueId = arg('--queue');
  const apply = !!arg('--apply');
  const isProd = !!arg('--prod');
  if (!queueId) { console.error('usage: repair_file_shares.js --queue <queue_id> [--apply] [--prod]'); process.exit(1); }

  // 1) The file-share children the losers had at pre-merge time (from our snapshot).
  const rows = await db("SELECT account, fields FROM salesforce_merge_premerge_snapshot WHERE queue_id = ? AND child_object = 'ContentDocumentLink'", [Number(queueId)]);
  if (!rows.length) { console.log('No ContentDocumentLink rows were captured for queue ' + queueId + ' — nothing to repair.'); process.exit(0); }
  const shares = rows.map((r) => { let f = {}; try { f = JSON.parse(r.fields); } catch (e) { /* */ } return { loser: f.parent_id || r.account, cdl_id: f.id, cdid: f.content_document_id || null, share_type: f.share_type || 'V', visibility: f.visibility || 'AllUsers' }; });

  const conn = await W.default_write_connect(!isProd);

  // 2) Resolve ContentDocumentId for older snapshots that didn't capture it: look up the captured link id
  //    (if it still exists — it now points at the survivor).
  const needDoc = shares.filter((s) => !s.cdid && s.cdl_id);
  if (needDoc.length) {
    try {
      const q = await conn.query('SELECT Id, ContentDocumentId FROM ContentDocumentLink WHERE Id IN (' + soqlIn(needDoc.map((s) => s.cdl_id)) + ')');
      const byId = {}; for (const r of (q.records || [])) byId[r.Id] = r.ContentDocumentId;
      for (const s of needDoc) if (byId[s.cdl_id]) s.cdid = byId[s.cdl_id];
    } catch (e) { /* leave unresolved */ }
  }

  // 3) File titles + which loser links already exist (so we don't double-link).
  const docIds = [...new Set(shares.map((s) => s.cdid).filter(Boolean))];
  const title = {}; const existing = new Set();
  if (docIds.length) {
    try { const t = await conn.query('SELECT Id, Title FROM ContentDocument WHERE Id IN (' + soqlIn(docIds) + ')'); for (const r of (t.records || [])) title[r.Id] = r.Title; } catch (e) { /* */ }
    try {
      const losers = [...new Set(shares.map((s) => s.loser).filter(Boolean))];
      const l = await conn.query('SELECT ContentDocumentId, LinkedEntityId FROM ContentDocumentLink WHERE ContentDocumentId IN (' + soqlIn(docIds) + ') AND LinkedEntityId IN (' + soqlIn(losers) + ')');
      for (const r of (l.records || [])) existing.add(r.ContentDocumentId + '|' + r.LinkedEntityId);
    } catch (e) { /* */ }
  }

  // 4) Report + (with --apply) additively re-link.
  let relinked = 0; let already = 0; let cannot = 0; let failed = 0;
  console.log('\nqueue ' + queueId + '  ' + (isProd ? '[PRODUCTION]' : '[sandbox]') + '  ' + (apply ? 'APPLY' : 'DRY RUN') + '  — ' + shares.length + ' file share(s)\n');
  for (const s of shares) {
    const name = s.cdid ? (title[s.cdid] || s.cdid) : '(unknown file)';
    if (!s.cdid) { cannot += 1; console.log('  CANNOT   ' + name + '  — no ContentDocumentId (pre-capture snapshot and the original link is gone). Find it manually via the file owner’s Files.'); continue; }
    if (existing.has(s.cdid + '|' + s.loser)) { already += 1; console.log('  OK       ' + name + '  already linked to loser ' + s.loser); continue; }
    if (!apply) { relinked += 1; console.log('  WOULD    ' + name + '  -> re-link to loser ' + s.loser); continue; }
    try {
      const res = await W.create_record(conn, 'ContentDocumentLink', { ContentDocumentId: s.cdid, LinkedEntityId: s.loser, ShareType: s.share_type, Visibility: s.visibility });
      if (res && res.success === false) {
        const m = (res.errors && res.errors[0] && (res.errors[0].message || res.errors[0].statusCode)) || '';
        if (/duplicate|already/i.test(m)) { already += 1; console.log('  OK       ' + name + '  (already linked)'); } else { failed += 1; console.log('  FAIL     ' + name + '  ' + m); }
      } else { relinked += 1; console.log('  RELINKED ' + name + '  -> loser ' + s.loser); }
    } catch (e) {
      const m = (e && e.message) || '';
      if (/duplicate|already/i.test(m)) { already += 1; console.log('  OK       ' + name + '  (already linked)'); } else { failed += 1; console.log('  FAIL     ' + name + '  ' + m); }
    }
  }
  console.log('\nSummary: ' + (apply ? 'relinked ' : 'would relink ') + relinked + ', already ' + already + ', cannot ' + cannot + ', failed ' + failed);
  console.log('Additive only — the survivor keeps every link; no file was moved or deleted.' + (apply ? '' : '  (re-run with --apply to make the changes)'));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });

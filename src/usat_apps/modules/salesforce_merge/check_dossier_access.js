'use strict';
// Diagnostic — does the Salesforce WRITE (integration) user have what the merge dossier needs?
// It connects with the SAME write creds the merge tool uses, prints who it is, and checks create
// access on the Salesforce Files objects (ContentVersion + ContentDocumentLink) plus the stamp
// fields on Account. With --live it actually creates and then deletes a tiny test file to prove
// the end-to-end path (safe: it cleans up after itself).
//
// Run (sandbox):     node modules/salesforce_merge/check_dossier_access.js
//      (production):  node modules/salesforce_merge/check_dossier_access.js --prod
//      (prove write): add --live   e.g.  node modules/salesforce_merge/check_dossier_access.js --prod --live
//
// It reads the same SF_* env vars as the tool, so run it where those are loaded (e.g. the same shell
// that starts the server). If you use a .env file:  node -r dotenv/config modules/salesforce_merge/check_dossier_access.js
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }
const W = require('./store/salesforce_write');

async function main() {
  const isProd = process.argv.includes('--prod');
  const live = process.argv.includes('--live');
  const env = isProd ? 'PRODUCTION' : 'sandbox';

  console.log('Using', W.using_dedicated_write_user(!isProd) ? 'the dedicated WRITE user' : 'the read-pipeline creds (no dedicated write user set)', 'for', env);
  const conn = await W.default_write_connect(!isProd);
  const who = await conn.identity();
  console.log('\nConnected as : ' + who.username + '  (userId ' + who.user_id + ')');
  console.log('Org          : ' + who.organization_id + '  [' + env + ']');

  console.log('\nSalesforce Files objects (needed to attach the dossier):');
  let filesOk = true;
  for (const obj of ['ContentVersion', 'ContentDocumentLink']) {
    try {
      const d = await conn.sobject(obj).describe();
      const ok = !!d.createable;
      filesOk = filesOk && ok;
      console.log('  ' + obj.padEnd(20) + ' createable: ' + (ok ? 'YES' : 'NO') + (d.updateable != null ? ' , updateable: ' + d.updateable : ''));
    } catch (e) { filesOk = false; console.log('  ' + obj.padEnd(20) + ' describe FAILED: ' + e.message); }
  }

  console.log('\nStamp fields on Account (needed for usat_was_* lifecycle marker):');
  const sf = await W.stamp_fields_status(conn);
  for (const k of ['usat_was_merged__c', 'usat_was_merged_date__c', 'usat_was_merged_by__c']) {
    console.log('  ' + k.padEnd(28) + (sf[k] ? 'present' : 'MISSING'));
  }

  if (live) {
    console.log('\n--live: creating a throwaway File to prove end-to-end write…');
    const cv = await conn.sobject('ContentVersion').create({ Title: 'dossier-perm-test', PathOnClient: 'dossier_perm_test.txt', VersionData: Buffer.from('ok').toString('base64') });
    if (!cv || !cv.success) throw new Error('ContentVersion create failed: ' + JSON.stringify(cv && cv.errors));
    const q = await conn.query("SELECT ContentDocumentId FROM ContentVersion WHERE Id = '" + cv.id + "'");
    const docId = q.records[0].ContentDocumentId;
    console.log('  created ContentVersion ' + cv.id + ' -> ContentDocument ' + docId);
    await conn.sobject('ContentDocument').destroy(docId);   // cleans up the file entirely
    console.log('  deleted the test document — Files write path: OK');
  }

  console.log('\nSummary: Files attach ' + (filesOk ? 'AVAILABLE' : 'NOT available (dossier will still be saved to MySQL, just not attached in SF)') + '.');
}
main().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });

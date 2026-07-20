'use strict';
// Diagnostic (read-only) for data issue #6 — for the donor/fundraising objects that hang off a Person
// Account or its Contact, is each a MASTER-DETAIL child (cascade-deleted by a merge → data-loss risk on
// restore) or a plain lookup (Salesforce re-parents it → low risk)? Also finds a concrete foundation/
// donor duplicate to test the merge/restore against.
//
// CONFIRMED so far (sandbox 2026-07): "Donor Gift Summary" (API DonorGiftSummary, a standard Nonprofit
// Cloud object) links to Account by Master-Detail(Account) (Unique) — a per-account rollup. It cascade-
// deletes on merge, but it's DERIVED giving-history summary data (the real records live in Gift
// Transaction). The blocker is that the integrated (run-as) user can't see it (needs Read + Delete);
// Salesforce normally cascade-restores master-detail children when the parent is undeleted.
//
// IMPORTANT: describeGlobal / describe only see objects the CONNECTED (integrated / run-as) user can
// access. If an object reports "NOT VISIBLE", that's a permissions gap — restore can't undelete what the
// user can't see, regardless of our code.
//
// Run from the repo root (loads the root .env for SF creds via the shared OAuth helper):
//   node src/usat_apps/modules/salesforce_merge/probe_donor_gift.js            # sandbox (default)
//   node src/usat_apps/modules/salesforce_merge/probe_donor_gift.js --prod     # production
//
// Read-only: DESCRIBE + SELECT only. Never writes.

const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');            // .../sql_programs
require('dotenv').config({ path: ROOT + '/.env' });
const { connect_salesforce } = require(ROOT + '/utilities/salesforce/salesforce_connect.js');

const IS_TEST = !process.argv.includes('--prod');
const SYS = /(__ChangeEvent|__History|__Share|__Feed|__mdt|__Tag|__b)$/i;
// Nonprofit-Cloud / Cirrus fundraising objects that hold or roll up donor data. Checked explicitly so
// the verdict is unambiguous even if the label search phrases them differently.
const KNOWN = ['DonorGiftSummary', 'GiftTransaction', 'GiftTransactionDesignation', 'GiftCommitment',
  'GiftCommitmentSchedule', 'GiftDefaultDesignation', 'GiftSoftCredit', 'cfg_GiftTransaction__c',
  'Gift_Commitment_Milestone__c'];

// Describe one object and return its Account/Contact relationship verdict, or a not-visible marker.
async function inspect(conn, name) {
  try {
    const d = await conn.sobject(name).describe();
    const refs = d.fields.filter((f) => f.type === 'reference' && (f.referenceTo || []).some((r) => r === 'Account' || r === 'Contact'));
    return { name, ok: true, queryable: d.queryable, refs: refs.map((f) => ({ field: f.name, to: (f.referenceTo || []).join('/'), md: !!f.cascadeDelete, toContact: (f.referenceTo || []).includes('Contact') && !(f.referenceTo || []).includes('Account') })) };
  } catch (e) { return { name, ok: false, err: e.message }; }
}

function verdict_line(r) {
  if (!r.ok) return `  ${r.name}: ⚠ NOT VISIBLE to the integrated user (${(r.err || '').slice(0, 60)}) — permissions gap`;
  if (!r.refs.length) return `  ${r.name}: no direct Account/Contact reference (rollup/standalone — safe like Queue Items)`;
  return r.refs.map((f) => `  ${r.name}.${f.field} -> ${f.to}  ${f.md ? '[MASTER-DETAIL / cascade-delete → DATA-LOSS RISK]' : '[lookup — SF re-parents on merge, low risk]'}`).join('\n');
}

async function main() {
  const { conn, mode, label, org_id, instance_url } = await connect_salesforce({ is_test: IS_TEST });
  console.log(`CONNECTED via ${mode} · ${label} · org ${org_id}\n`);

  // 1) Discovery — real objects matching donor/gift/summary the user CAN see.
  const g = await conn.describeGlobal();
  const rx = /donor|gift|summary/i;
  const hits = g.sobjects.filter((o) => !SYS.test(o.name) && (rx.test(o.name) || rx.test(o.label) || rx.test(o.labelPlural || '')));
  console.log('=== visible objects matching donor/gift/summary (system sub-objects hidden) ===');
  if (!hits.length) console.log('  (none — the integrated user may not see the fundraising objects at all)');
  hits.forEach((o) => console.log(`  ${o.name}  ·  "${o.label}"${o.queryable ? '' : '  (not queryable)'}`));

  // 2) Explicit verdict per key donor object (visible discovery + the known list, de-duped).
  const names = Array.from(new Set([...hits.filter((o) => !SYS.test(o.name)).map((o) => o.name), ...KNOWN]));
  console.log('\n=== Account/Contact relationship per object (cascadeDelete = master-detail = data-loss risk) ===');
  const reports = [];
  for (const n of names) { const r = await inspect(conn, n); reports.push(r); console.log(verdict_line(r)); }

  const risky = reports.filter((r) => r.ok && r.refs.some((f) => f.md));
  const invisible = reports.filter((r) => !r.ok);
  console.log('\n=== summary ===');
  console.log(`  master-detail (cascade-delete) objects: ${risky.length ? risky.map((r) => r.name).join(', ') : 'none visible'}`);
  console.log(`  not visible to integrated user (permissions gap): ${invisible.length ? invisible.map((r) => r.name).join(', ') : 'none'}`);

  // 3) Donor/foundation accounts to open in Salesforce. Account is visible to the integrated user even
  // when the gift objects aren't — open one in the UI and check its "Donor Gift Summary" related list
  // with your own eyes. If a gift object IS visible, we also print the attached count per account.
  console.log('\n=== donor/foundation accounts — open in Salesforce to SEE the Donor Gift Summary ===');
  const target = reports.find((r) => r.ok && r.refs.length && r.queryable);
  try {
    const accs = (await conn.query(
      "SELECT Id, Name, PersonContactId, usat_Foundation_Constituent__c FROM Account " +
      "WHERE usat_Foundation_Constituent__c != null LIMIT 200")).records || [];
    if (!accs.length) console.log('  (no accounts with usat_Foundation_Constituent__c set were returned)');
    let shown = 0;
    for (const a of accs) {
      let note = '';
      if (target) {
        const parentId = target.refs[0].toContact ? a.PersonContactId : a.Id;
        if (parentId) { try { const n = (await conn.query(`SELECT COUNT() FROM ${target.name} WHERE ${target.refs[0].field} = '${parentId}'`)).totalSize; note = `  — ${n} ${target.name}`; } catch (e) { /* ignore */ } }
      }
      console.log(`  ${a.Name}  ·  ${a.Id}${note}`);
      if (instance_url) console.log(`    ${instance_url}/lightning/r/Account/${a.Id}/view`);
      if (++shown >= 8) break;
    }
    if (!target) {
      console.log('\n  (The gift objects aren\'t visible to the integrated user, so this can\'t confirm the');
      console.log('   attachment programmatically — but opening a donor account above in Salesforce will show');
      console.log('   its "Donor Gift Summary" related list, which is what you want to see with your own eyes.)');
    }
  } catch (e) { console.log(`  query failed: ${e.message}`); }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

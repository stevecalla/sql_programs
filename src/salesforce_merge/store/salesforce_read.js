'use strict';
// Phase 2 — READ-ONLY Salesforce fetch of full current detail for specific Account (Person Account)
// IDs, for the cluster deep-fetch. SELECT only; never writes. Connection mirrors the duplicates
// project's salesforce.js (same env vars). `connect` is injectable for testing.
const jsforce = require('jsforce');

// Display fields (the id comes back as `account`). Person-Account fields; extend as needed.
const DETAIL_FIELDS = [
  'Name', 'FirstName', 'LastName', 'PersonEmail', 'Phone',
  'PersonMailingStreet', 'PersonMailingCity', 'PersonMailingState', 'PersonMailingPostalCode',
  'cfg_Member_Number__pc', 'cfg_Gender_Identity__pc', 'PersonBirthdate',
  'usat_Salesforce_Merge_Id__pc', 'usat_Foundation_Constituent__c',
  'CreatedDate', 'LastModifiedDate',
];

async function default_connect(is_test) {
  const conn = new jsforce.Connection({
    loginUrl: is_test ? process.env.SF_DEV_LOGIN_URL : process.env.SF_PROD_LOGIN_URL,
  });
  await conn.login(
    is_test ? process.env.SF_DEV_USERNAME : process.env.SF_PROD_USERNAME,
    is_test ? process.env.SF_DEV_PASSWORD + process.env.SF_DEV_SECURITY_TOKEN
      : process.env.SF_PROD_PASSWORD + process.env.SF_PROD_SECURITY_TOKEN,
  );
  return conn;
}

// Returns [{ account: Id, ...fields }] for the given ids, or [] if none. Read-only SELECT.
async function fetch_accounts_by_ids(ids, { is_test = true, fields = DETAIL_FIELDS, connect = default_connect } = {}) {
  const list = (ids || []).map((s) => String(s)).filter(Boolean);
  if (!list.length) return [];
  const conn = await connect(is_test);
  const inList = list.map((id) => "'" + id.replace(/'/g, '') + "'").join(', ');
  const soql = 'SELECT Id, PersonContactId, ' + fields.join(', ') + ' FROM Account WHERE Id IN (' + inList + ')';
  const res = await conn.query(soql);
  return (res.records || []).map((r) => {
    const o = { account: r.Id, contact: r.PersonContactId || '' };
    for (const f of fields) o[f] = r[f] == null ? '' : r[f];
    return o;
  });
}

// Child objects whose records re-parent to the survivor during a merge. Configurable; the default
// list covers the common Account-parented standard objects. Add custom objects (e.g. memberships)
// here with their parent lookup field.
const CHILD_OBJECTS = [
  { object: 'Opportunity', parent: 'AccountId', label: 'Opportunities' },
  { object: 'Case', parent: 'AccountId', label: 'Cases' },
];

// READ-ONLY counts of child records per account id, grouped by parent. Returns
// { [accountId]: { total, by: { label: count } } }. Missing objects/permission are skipped.
async function count_children_by_ids(ids, { is_test = true, connect = default_connect, objects = CHILD_OBJECTS } = {}) {
  const list = (ids || []).map((s) => String(s)).filter(Boolean);
  const out = {};
  for (const id of list) out[id] = { total: 0, by: {} };
  if (!list.length) return out;
  const conn = await connect(is_test);
  const inList = list.map((id) => "'" + id.replace(/'/g, '') + "'").join(', ');
  for (const oc of objects) {
    try {
      const soql = 'SELECT ' + oc.parent + ' pid, COUNT(Id) c FROM ' + oc.object +
        ' WHERE ' + oc.parent + ' IN (' + inList + ') GROUP BY ' + oc.parent;
      const res = await conn.query(soql);
      for (const r of (res.records || [])) {
        const pid = r.pid; const c = Number(r.c) || 0;
        if (out[pid]) { out[pid].by[oc.label] = c; out[pid].total += c; }
      }
    } catch (e) { /* object absent / no access -> skip */ }
  }
  return out;
}

// --- Auto-discovery of child relationships (merge reparents children to the survivor) ---
// Skip system/metadata relationships that aren't reviewable data (and often aren't groupable).
const SKIP_CHILD = /(History|Share|Feed|ChangeEvent|Tag|EventRelation|RecordAction)$/i;
const _childCache = {};   // sobject -> [{ object, field, label }] (describe runs once per process)

async function discover_child_objects(conn, sobject) {
  if (_childCache[sobject]) return _childCache[sobject];
  const meta = await conn.sobject(sobject).describe();
  const seen = new Set();
  const out = [];
  for (const cr of (meta.childRelationships || [])) {
    if (!cr.field || !cr.childSObject || SKIP_CHILD.test(cr.childSObject)) continue;
    const key = cr.childSObject + '.' + cr.field;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ object: cr.childSObject, field: cr.field, label: cr.relationshipName || cr.childSObject });
  }
  _childCache[sobject] = out;
  return out;
}

// Auto child counts: discover Account child relationships (+ Contact's, for Person-Account children),
// then COUNT each grouped by parent. `contactByAccount` maps accountId -> PersonContactId so
// Contact-side children roll up to the right account. Returns { [accountId]: { total, by } }.
async function count_children(ids, { is_test = true, connect = default_connect, contactByAccount = {} } = {}) {
  const list = (ids || []).map((s) => String(s)).filter(Boolean);
  const out = {};
  for (const id of list) out[id] = { total: 0, by: {} };
  if (!list.length) return out;
  const conn = await connect(is_test);
  const quote = (arr) => arr.map((id) => "'" + String(id).replace(/'/g, '') + "'").join(', ');

  const contactToAccount = {};
  for (const id of list) { const cid = contactByAccount[id]; if (cid) contactToAccount[cid] = id; }
  const contactIds = Object.keys(contactToAccount);

  const one = async (oc, inList, mapToAccount) => {
    try {
      const soql = 'SELECT ' + oc.field + ' pid, COUNT(Id) c FROM ' + oc.object +
        ' WHERE ' + oc.field + ' IN (' + inList + ') GROUP BY ' + oc.field;
      const res = await conn.query(soql);
      for (const r of (res.records || [])) {
        const acct = mapToAccount(r.pid);
        const c = Number(r.c) || 0;
        if (!acct || !out[acct] || !c) continue;
        out[acct].by[oc.label] = (out[acct].by[oc.label] || 0) + c;
        out[acct].total += c;
      }
    } catch (e) { /* relationship not groupable / no access -> skip */ }
  };
  const tally = async (rels, inList, mapToAccount) => {
    if (!inList) return;
    const CHUNK = 8;   // bounded concurrency to stay friendly with API limits
    for (let i = 0; i < rels.length; i += CHUNK) {
      await Promise.all(rels.slice(i, i + CHUNK).map((oc) => one(oc, inList, mapToAccount)));
    }
  };

  await tally(await discover_child_objects(conn, 'Account'), quote(list), (pid) => pid);
  if (contactIds.length) {
    await tally(await discover_child_objects(conn, 'Contact'), quote(contactIds), (pid) => contactToAccount[pid]);
  }
  return out;
}

module.exports = { fetch_accounts_by_ids, count_children_by_ids, count_children, discover_child_objects, DETAIL_FIELDS, CHILD_OBJECTS };

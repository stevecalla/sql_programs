'use strict';
// Phase 2 — READ-ONLY Salesforce fetch of full current detail for specific Account (Person Account)
// IDs, for the cluster deep-fetch. SELECT only; never writes. `connect` is injectable for testing.
const jsforce = require('jsforce');

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

const CHILD_OBJECTS = [
  { object: 'Opportunity', parent: 'AccountId', label: 'Opportunities' },
  { object: 'Case', parent: 'AccountId', label: 'Cases' },
];

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
    } catch (e) { /* skip */ }
  }
  return out;
}

const SKIP_CHILD = /(History|Share|Feed|ChangeEvent|Tag|EventRelation|RecordAction)$/i;
const _childCache = {};

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
    } catch (e) { /* skip */ }
  };
  const tally = async (rels, inList, mapToAccount) => {
    if (!inList) return;
    const CHUNK = 8;
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

async function get_org_identity({ is_test, connect = default_connect } = {}) {
  const conn = await connect(is_test);
  let org_id = null; let is_sandbox = null;
  try { const id = await conn.identity(); org_id = (id && id.organization_id) || null; } catch (e) { /* ignore */ }
  try {
    const r = await conn.query('SELECT Id, IsSandbox FROM Organization LIMIT 1');
    if (r && r.records && r.records[0]) { org_id = org_id || r.records[0].Id; is_sandbox = !!r.records[0].IsSandbox; }
  } catch (e) { /* ignore */ }
  return { org_id, is_sandbox };
}

async function fetch_children(ids, { is_test = true, connect = default_connect, contactByAccount = {}, limitPerObject = 0 } = {}) {
  const list = (ids || []).map((s) => String(s)).filter(Boolean);
  if (!list.length) return [];
  const conn = await connect(is_test);
  const quote = (arr) => arr.map((id) => "'" + String(id).replace(/'/g, '') + "'").join(', ');
  const out = [];
  const contactToAccount = {};
  for (const id of list) { const cid = contactByAccount[id]; if (cid) contactToAccount[cid] = id; }
  const contactIds = Object.keys(contactToAccount);
  const grab = async (rels, inList, mapToAccount) => {
    if (!inList) return;
    for (const oc of rels) {
      try {
        const lim = limitPerObject > 0 ? (' LIMIT ' + limitPerObject) : '';
        const soql = 'SELECT Id, ' + oc.field + ' FROM ' + oc.object + ' WHERE ' + oc.field + ' IN (' + inList + ')' + lim;
        const res = await conn.query(soql);
        for (const r of (res.records || [])) {
          const parentId = r[oc.field];
          const account = mapToAccount(parentId);
          if (!account) continue;
          out.push({ account, object: oc.object, id: r.Id, parent_field: oc.field, parent_id: parentId });
        }
      } catch (e) { /* skip */ }
    }
  };
  await grab(await discover_child_objects(conn, 'Account'), quote(list), (pid) => pid);
  if (contactIds.length) await grab(await discover_child_objects(conn, 'Contact'), quote(contactIds), (pid) => contactToAccount[pid]);
  return out;
}

// READ-ONLY browse of recently soft-deleted Person Accounts. scanAll:true makes jsforce hit the
// queryAll endpoint (includes soft-deleted rows; ~15-day window). MasterRecordId = merged-into id.
async function list_recycle_bin({ is_test = true, connect = default_connect, limit = 100 } = {}) {
  const conn = await connect(is_test);
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  if (typeof conn.query !== 'function') return { rows: [], error: 'query not available' };
  try {
    const res = await conn.query(
      'SELECT Id, Name, PersonEmail, cfg_Member_Number__pc, MasterRecordId, LastModifiedDate ' +
      'FROM Account WHERE IsDeleted = true ORDER BY LastModifiedDate DESC LIMIT ' + n, { scanAll: true });
    const rows = (res.records || []).map((r) => ({
      account: r.Id, name: r.Name || '', email: r.PersonEmail || '',
      member_number: r.cfg_Member_Number__pc || '', master_record_id: r.MasterRecordId || '',
      last_modified: r.LastModifiedDate || '',
    }));
    return { rows, error: null };
  } catch (e) { return { rows: [], error: e.message }; }
}

async function get_user_capabilities({ is_test, connect = default_connect, objects = ['Account', 'Contact'] } = {}) {
  const conn = await connect(is_test);
  const out = { is_test: !!is_test, user_id: null, username: null, display_name: null, org_id: null, objects: {}, can_merge: false };
  try {
    const id = await conn.identity();
    if (id) { out.user_id = id.user_id || null; out.username = id.username || null; out.display_name = id.display_name || null; out.org_id = id.organization_id || null; }
  } catch (e) { /* leave nulls */ }
  for (const obj of objects) {
    try {
      const d = await conn.sobject(obj).describe();
      out.objects[obj] = { createable: !!d.createable, updateable: !!d.updateable, deletable: !!d.deletable };
    } catch (e) { out.objects[obj] = { error: 'describe failed (no access?)' }; }
  }
  const acct = out.objects.Account || {};
  out.can_merge = !!(acct.updateable && acct.deletable);
  return out;
}

module.exports = { fetch_accounts_by_ids, count_children_by_ids, count_children, fetch_children, discover_child_objects, get_org_identity, get_user_capabilities, list_recycle_bin, DETAIL_FIELDS, CHILD_OBJECTS };

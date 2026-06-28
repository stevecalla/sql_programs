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
  const soql = 'SELECT Id, ' + fields.join(', ') + ' FROM Account WHERE Id IN (' + inList + ')';
  const res = await conn.query(soql);
  return (res.records || []).map((r) => {
    const o = { account: r.Id };
    for (const f of fields) o[f] = r[f] == null ? '' : r[f];
    return o;
  });
}

module.exports = { fetch_accounts_by_ids, DETAIL_FIELDS };

'use strict';
// Shared Salesforce connect helper — creds/mode resolution, OAuth token request, and the
// OAuth-primary → SOAP-login fallback. All fakes (injected env / fetch / jsforce / log); no org.
//   node --test src/usat_apps/modules/salesforce_merge/tests/salesforce_connect.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sf = require('../../../../../utilities/salesforce/salesforceConnect');

const DEV_ENV = {
  SF_DEV_LOGIN_URL: 'https://usatriathlon--01test.sandbox.my.salesforce.com',
  SF_DEV_CLIENT_ID: 'cid', SF_DEV_CLIENT_SECRET: 'secret',
  SF_DEV_USERNAME: 'steve.calla@usatriathlon.org.01test', SF_DEV_PASSWORD: 'pw', SF_DEV_SECURITY_TOKEN: 'tok',
};

// A fake jsforce whose Connection records the OAuth props and fakes a SOAP login().
function fakeJsforce() {
  return { Connection: class {
    constructor(o) { Object.assign(this, o); this.instanceUrl = o.instanceUrl || null; }
    async login(u, p) { this._login = { u, p }; this.instanceUrl = 'https://legacy.inst'; return { organizationId: '00Dlegacyorg' }; }
  } };
}
const okFetch = async () => ({ ok: true, status: 200, json: async () => ({
  access_token: 'AT', instance_url: 'https://inst.my.salesforce.com',
  id: 'https://login.salesforce.com/id/00Doauthorg000/005user000' }) });
const badFetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_client', error_description: 'bad secret' }) });

test('resolve_creds: is_test -> SF_DEV_*, derives token URL', () => {
  const c = sf.resolve_creds(true, DEV_ENV);
  assert.equal(c.label, 'sandbox');
  assert.equal(c.client_id, 'cid');
  assert.equal(c.token_url, 'https://usatriathlon--01test.sandbox.my.salesforce.com/services/oauth2/token');
  assert.equal(c.username, 'steve.calla@usatriathlon.org.01test');
});

test('resolve_creds: !is_test -> SF_PROD_* (empty here)', () => {
  const c = sf.resolve_creds(false, DEV_ENV);
  assert.equal(c.label, 'production');
  assert.equal(c.client_id, '');
});

test('resolve_mode: default auto; oauth; soap (+legacy alias); junk -> auto', () => {
  assert.equal(sf.resolve_mode({}), 'auto');
  assert.equal(sf.resolve_mode({ SF_AUTH_MODE: 'oauth' }), 'oauth');
  assert.equal(sf.resolve_mode({ SF_AUTH_MODE: 'SOAP' }), 'soap');
  assert.equal(sf.resolve_mode({ SF_AUTH_MODE: 'legacy' }), 'soap');   // legacy accepted as an alias
  assert.equal(sf.resolve_mode({ SF_AUTH_MODE: 'nonsense' }), 'auto');
});

test('org_id_from_identity_url parses the org id', () => {
  assert.equal(sf.org_id_from_identity_url('https://login.salesforce.com/id/00Dabc123/005xyz'), '00Dabc123');
  assert.equal(sf.org_id_from_identity_url(''), '');
});

test('request_client_credentials_token: posts grant_type + returns token json', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return okFetch(); };
  const json = await sf.request_client_credentials_token(sf.resolve_creds(true, DEV_ENV), fetchImpl);
  assert.equal(json.access_token, 'AT');
  assert.match(seen.url, /\/services\/oauth2\/token$/);
  assert.match(seen.opts.body, /grant_type=client_credentials/);
  assert.match(seen.opts.body, /client_id=cid/);
});

test('request_client_credentials_token: missing config throws; error json throws', async () => {
  await assert.rejects(() => sf.request_client_credentials_token({ token_url: '', client_id: '', client_secret: '' }, okFetch), /missing OAuth config/);
  await assert.rejects(() => sf.request_client_credentials_token(sf.resolve_creds(true, DEV_ENV), badFetch), /bad secret/);
});

test('connect_salesforce oauth: succeeds, mode=oauth, logs the OAuth line', async () => {
  const logs = [];
  const r = await sf.connect_salesforce({ is_test: true, env: { ...DEV_ENV, SF_AUTH_MODE: 'oauth' }, jsforce: fakeJsforce(), fetch_impl: okFetch, log: (m) => logs.push(m) });
  assert.equal(r.mode, 'oauth');
  assert.equal(r.org_id, '00Doauthorg000');
  assert.ok(logs.some((l) => /✔ \[SF AUTH\] OAuth ·/.test(l)));
});

test('connect_salesforce auto: OAuth fails -> falls back to SOAP (yellow warn + SOAP line)', async () => {
  const logs = [];
  const r = await sf.connect_salesforce({ is_test: true, env: { ...DEV_ENV, SF_AUTH_MODE: 'auto' }, jsforce: fakeJsforce(), fetch_impl: badFetch, log: (m) => logs.push(m) });
  assert.equal(r.mode, 'soap');
  assert.equal(r.org_id, '00Dlegacyorg');
  assert.ok(logs.some((l) => /falling back to SOAP/.test(l)), 'warned about fallback');
  assert.ok(logs.some((l) => /✔ \[SF AUTH\] SOAP ·/.test(l)), 'logged SOAP success');
});

test('connect_salesforce oauth-only: OAuth fails -> throws (no fallback)', async () => {
  await assert.rejects(() => sf.connect_salesforce({ is_test: true, env: { ...DEV_ENV, SF_AUTH_MODE: 'oauth' }, jsforce: fakeJsforce(), fetch_impl: badFetch, log: () => {} }), /token request failed/);
});

test('connect_salesforce soap: uses SOAP login directly, mode=soap', async () => {
  const logs = [];
  const r = await sf.connect_salesforce({ is_test: true, env: { ...DEV_ENV, SF_AUTH_MODE: 'soap' }, jsforce: fakeJsforce(), fetch_impl: okFetch, log: (m) => logs.push(m) });
  assert.equal(r.mode, 'soap');
  assert.equal(r.username, 'steve.calla@usatriathlon.org.01test');
  assert.ok(logs.every((l) => !/OAuth/.test(l)), 'never tried OAuth');
});

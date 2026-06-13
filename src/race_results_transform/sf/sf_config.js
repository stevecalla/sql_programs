'use strict';
// Salesforce credentials/config from environment (repo-root .env, loaded by the server/CLI).
// is_test=true -> sandbox/dev creds; false -> production. No secrets are ever sent to the browser.

function sf_config(opts) {
  const o = opts || {};
  const is_test = o.is_test != null ? !!o.is_test : false;
  const env = process.env;
  const cfg = {
    is_test: is_test,
    environment_name: is_test ? 'sandbox/dev' : 'production',
    api_version: env.SF_API_VERSION || '64.0',
    login_url: is_test
      ? (env.SF_DEV_LOGIN_URL || 'https://test.salesforce.com')
      : (env.SF_PROD_LOGIN_URL || 'https://usatriathlon.my.salesforce.com'),
    username: is_test ? env.SF_DEV_USERNAME : env.SF_PROD_USERNAME,
    password: is_test ? env.SF_DEV_PASSWORD : env.SF_PROD_PASSWORD,
    security_token: is_test ? env.SF_DEV_SECURITY_TOKEN : env.SF_PROD_SECURITY_TOKEN,
    // The Program (event) object + its Sanctioning ID formula field. Defaults match the standard
    // `Program` object (cfg_Id__c = BLANKVALUE(cfg_Legacy_Id__c, cfg_Autonumber_ID__c)); override
    // via env if the object is namespaced or the field differs in another org.
    program_object: env.SF_PROGRAM_OBJECT || 'Program',
    sanction_field: env.SF_SANCTION_FIELD || 'cfg_Id__c',
    // Email-Queue intake: the Salesforce Queue (a Group) that Email-to-Case routes race-results
    // submissions to. Default DeveloperName `cfg_Rankings` (display name "Rankings").
    rankings_queue: env.SF_RANKINGS_QUEUE || 'cfg_Rankings'
  };
  return cfg;
}

// Returns { ok, missing[] } so callers can 503 with a clear message instead of throwing on boot.
function check_sf_config(cfg) {
  const is_test = cfg.is_test;
  const missing = [];
  if (!cfg.login_url) missing.push(is_test ? 'SF_DEV_LOGIN_URL' : 'SF_PROD_LOGIN_URL');
  if (!cfg.username) missing.push(is_test ? 'SF_DEV_USERNAME' : 'SF_PROD_USERNAME');
  if (!cfg.password) missing.push(is_test ? 'SF_DEV_PASSWORD' : 'SF_PROD_PASSWORD');
  if (!cfg.security_token) missing.push(is_test ? 'SF_DEV_SECURITY_TOKEN' : 'SF_PROD_SECURITY_TOKEN');
  return { ok: missing.length === 0, missing: missing };
}

module.exports = { sf_config, check_sf_config };

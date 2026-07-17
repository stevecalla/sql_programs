'use strict';
// utilities/salesforce/salesforceConnect.js
// ---------------------------------------------------------------------------------------------
// ONE shared Salesforce connection helper for every USAT app (merge, duplicates, transform,
// email, ...). Build a jsforce Connection once, here, so every app authenticates the same way.
//
//   Primary auth : External Client App + OAuth 2.0 Client Credentials   (Summer '27-safe)
//   Fallback     : legacy SOAP login()  (username + password + security token)  [retiring '27]
//
// SF_AUTH_MODE controls the behavior:
//   auto   (default) -> try OAuth; if it fails for any reason, fall back to SOAP
//   oauth            -> OAuth only (no fallback — fail loudly)
//   soap             -> SOAP only (the retiring method; 'legacy' is accepted as an alias)
//
// Every connect prints ONE colored line saying which method was used, so it's obvious at a glance
// which door the app came through. The pure pieces (cred / mode resolution, token request) take
// injectable deps (env, fetch, jsforce, log) so they unit-test without a live org.
// ---------------------------------------------------------------------------------------------

// --- tiny ANSI colorizer (kept local so this shared module has no cross-app logger dependency) --
const COLORS = { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' };
const paint = (color, text) => `${COLORS[color] || ''}${text}${COLORS.reset}`;

// Resolve the env-var set for the chosen environment. is_test -> SF_DEV_*, else SF_PROD_*.
// The OAuth token URL is derived from the login URL (+ /services/oauth2/token).
function resolve_creds(is_test, env = process.env, role = 'read') {
  const p = is_test ? 'SF_DEV_' : 'SF_PROD_';
  const login_url = env[p + 'LOGIN_URL'] || '';
  // For the SOAP fallback only: the write path may run as a dedicated write user
  // (SF_DEV_WRITE_USERNAME etc.), falling back to the base user. OAuth always uses the
  // single External Client App (one run-as user), so this never affects the OAuth path.
  const prefixes = role === 'write' ? [p + 'WRITE_', p] : [p];
  const pick = (suffix) => { for (const pre of prefixes) if (env[pre + suffix]) return env[pre + suffix]; return ''; };
  return {
    label: is_test ? 'sandbox' : 'production',
    login_url,
    token_url: login_url ? login_url.replace(/\/+$/, '') + '/services/oauth2/token' : '',
    // OAuth (External Client App) credentials
    client_id: env[p + 'CLIENT_ID'] || '',
    client_secret: env[p + 'CLIENT_SECRET'] || '',
    // SOAP login credentials (fallback)
    username: pick('USERNAME'),
    password: pick('PASSWORD'),
    security_token: pick('SECURITY_TOKEN'),
  };
}

// SF_AUTH_MODE -> 'auto' | 'oauth' | 'soap'  (anything unrecognized -> 'auto').
function resolve_mode(env = process.env) {
  const m = String(env.SF_AUTH_MODE || 'auto').trim().toLowerCase();
  if (m === 'oauth') return 'oauth';
  if (m === 'soap' || m === 'legacy') return 'soap';   // 'legacy' accepted as an alias for 'soap'
  return 'auto';
}

// Perform the OAuth 2.0 client-credentials token request. Returns the parsed token JSON
// ({ access_token, instance_url, id, ... }). Throws with a clear message on any failure.
async function request_client_credentials_token(creds, fetch_impl = fetch) {
  if (!creds.token_url || !creds.client_id || !creds.client_secret) {
    throw new Error('missing OAuth config (need CLIENT_ID, CLIENT_SECRET, LOGIN_URL)');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.client_id,
    client_secret: creds.client_secret,
  }).toString();
  const res = await fetch_impl(creds.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error('token request failed: ' + (json.error_description || json.error || ('HTTP ' + (res.status || '?'))));
  }
  return json;
}

// Salesforce returns an identity URL like https://login.../id/<orgId>/<userId>; pull the org id.
function org_id_from_identity_url(id_url) {
  const m = String(id_url || '').match(/\/id\/(00D[^/]+)\//);
  return m ? m[1] : '';
}

// Build a jsforce Connection via OAuth (client credentials). Throws on failure so `auto` can fall back.
async function connect_oauth(creds, deps = {}) {
  const jf = deps.jsforce || require('jsforce');
  const token = await request_client_credentials_token(creds, deps.fetch_impl);
  const co = { accessToken: token.access_token, instanceUrl: token.instance_url };
  if (deps.version) co.version = deps.version;
  const conn = new jf.Connection(co);
  return { conn, org_id: org_id_from_identity_url(token.id), instance_url: token.instance_url || '', username: '' };
}

// Build a jsforce Connection via legacy SOAP login() (username + password + security token).
async function connect_soap(creds, deps = {}) {
  const jf = deps.jsforce || require('jsforce');
  if (!creds.username || !creds.password) throw new Error('missing SOAP login config (need USERNAME, PASSWORD)');
  const cc = { loginUrl: creds.login_url };
  if (deps.version) cc.version = deps.version;
  const conn = new jf.Connection(cc);
  const info = await conn.login(creds.username, creds.password + (creds.security_token || ''));
  return { conn, org_id: (info && info.organizationId) || '', instance_url: conn.instanceUrl || '', username: creds.username };
}

// MAIN ENTRY. Return an authenticated jsforce Connection, trying OAuth first (with fallback per
// SF_AUTH_MODE). Returns { conn, mode, label, org_id, instance_url, username }.
async function connect_salesforce(opts = {}) {
  const { is_test = false, env = process.env, jsforce: jf, fetch_impl, log = console.log, role = 'read', version } = opts;
  const creds = resolve_creds(is_test, env, role);
  const mode = resolve_mode(env);
  const deps = { jsforce: jf, fetch_impl, version };

  const try_oauth = mode === 'oauth' || mode === 'auto';
  const try_soap = mode === 'soap' || mode === 'auto';

  if (try_oauth) {
    try {
      const r = await connect_oauth(creds, deps);
      log(paint('green', `✔ [SF AUTH] OAuth · ${creds.label} · org ${r.org_id || '(unknown)'}`));
      return { ...r, mode: 'oauth', label: creds.label };
    } catch (e) {
      if (mode === 'oauth') {
        log(paint('red', `✖ [SF AUTH] OAuth failed and SF_AUTH_MODE=oauth (no fallback): ${e.message}`));
        throw e;
      }
      log(paint('yellow', `⚠ [SF AUTH] OAuth failed (${e.message}) — falling back to SOAP`));
    }
  }

  if (try_soap) {
    const r = await connect_soap(creds, deps);
    log(paint('cyan', `✔ [SF AUTH] SOAP · ${creds.label} · org ${r.org_id || '(unknown)'} · ${creds.username}`));
    return { ...r, mode: 'soap', label: creds.label };
  }

  throw new Error('no Salesforce auth method available for SF_AUTH_MODE=' + mode);
}

module.exports = {
  connect_salesforce,
  resolve_creds,
  resolve_mode,
  request_client_credentials_token,
  org_id_from_identity_url,
  connect_oauth,
  connect_soap,
  COLORS,
};

'use strict';
// pull_corrections.js — ONE-COMMAND ad-hoc sync of corrections from PROD into THIS (dev) database.
// It SSHes to the prod host, runs export_corrections.js THERE (which uses the app's local root@localhost
// connection — so no remote-MySQL login/grant is ever needed), streams the JSON back, and imports it here
// with import_corrections.js --commit (idempotent upsert by id — safe to run as often as you like).
//
// One-time setup: SSH key auth to prod over Tailscale, then set PROD_SSH (and optionally PROD_REPO) in .env:
//   PROD_SSH=usat-server@100.103.13.100
//   PROD_REPO=~/development/usat/sql_programs        # optional; this is the default
//
// Then, any time:
//   node src/usat_apps/modules/salesforce_email_queue/pull_corrections.js
//   (or: npm run usat_apps_pull_corrections)
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SSH = process.env.PROD_SSH;                                   // e.g. usat-server@100.103.13.100
const REPO = process.env.PROD_REPO || '~/development/usat/sql_programs';
const LOCAL = path.resolve(__dirname, '..', '..', '..', '..', 'corrections_export.json');
const REMOTE_EXPORT = 'src/usat_apps/modules/salesforce_email_queue/export_corrections.js';
const IMPORT = path.resolve(__dirname, 'import_corrections.js');

if (!SSH) {
  console.error('PROD_SSH is not set. Add it to .env (or the environment), e.g.:\n  PROD_SSH=usat-server@100.103.13.100');
  process.exit(1);
}

// 1) Run the exporter on prod and stream the JSON back over SSH.
const remoteCmd = 'cd ' + REPO + ' && node ' + REMOTE_EXPORT + ' /tmp/corr_export.json >/dev/null 2>&1 && cat /tmp/corr_export.json';
console.log('Pulling corrections from ' + SSH + ' …');
const r = spawnSync('ssh', [SSH, remoteCmd], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.error) { console.error('Could not run ssh: ' + r.error.message + '\n(Is ssh on your PATH and key auth set up to ' + SSH + '?)'); process.exit(1); }
if (r.status !== 0) { console.error('Remote export failed (exit ' + r.status + '):\n' + (r.stderr || '').trim()); process.exit(1); }
const json = String(r.stdout || '').trim();
try { const arr = JSON.parse(json); if (!Array.isArray(arr)) throw new Error('not an array'); console.log('Received ' + arr.length + ' correction(s).'); }
catch (e) { console.error('Remote output was not valid JSON — aborting before import.\nFirst 200 chars:\n' + json.slice(0, 200)); process.exit(1); }
fs.writeFileSync(LOCAL, json + '\n');
console.log('Saved ' + LOCAL);

// 2) Import into THIS database (idempotent).
console.log('\nImporting into the local database …');
const imp = spawnSync('node', [IMPORT, LOCAL, '--commit'], { stdio: 'inherit' });
process.exit(imp.status || 0);

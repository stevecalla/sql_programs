'use strict';
// pull_urls.js — ONE-COMMAND EXACT-parity sync of knowledge URLs (knowledge_sources + knowledge_chunks) from
// PROD into THIS (dev) database, driven from dev: (1) SSH to prod, run export_urls.js there, (2) scp the JSON
// back, (3) import here (upsert sources, replace each source's chunks). ssh/scp keep the terminal attached so
// a password prompt works (or use SSH key auth for no prompt).
//
// One-time in .env:
//   PROD_SSH=usat-server@100.103.13.100
//   PROD_REPO=/home/usat-server/development/usat/sql_programs     # optional; default shown (ABSOLUTE - no ~)
// Then any time:
//   node src/usat_apps/knowledge_sync/pull_urls.js
//   (or the module menu -> Pull from prod -> dev -> Pull knowledge URLs from prod)
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const path = require('path');
const { spawnSync } = require('child_process');

const SSH = process.env.PROD_SSH;
const REPO = process.env.PROD_REPO || '/home/usat-server/development/usat/sql_programs';   // ABSOLUTE, no ~
const REMOTE_TMP = '/tmp/knowledge_urls_export.json';
const LOCAL = 'knowledge_urls_export.json';                     // relative to cwd (repo root)
const REMOTE_EXPORT = 'src/usat_apps/knowledge_sync/export_urls.js';
const IMPORT = path.resolve(__dirname, 'import_urls.js');

if (!SSH) { console.error('PROD_SSH is not set. Add it to .env, e.g.:\n  PROD_SSH=usat-server@100.103.13.100'); process.exit(1); }

const ENV = Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' });
function run(bin, args) { return spawnSync(bin, args, { stdio: 'inherit', shell: false, env: ENV }); }

console.log('[1/3] Export on prod (' + SSH + ') ...');
let r = run('ssh', [SSH, 'cd ' + REPO + ' && node ' + REMOTE_EXPORT + ' ' + REMOTE_TMP]);
if (r.status !== 0) { console.error('\nRemote export failed. Check PROD_SSH, PROD_REPO (absolute path), and SSH access.'); process.exit(1); }

console.log('\n[2/3] Copy the file back ...');
r = run('scp', [SSH + ':' + REMOTE_TMP, LOCAL]);
if (r.status !== 0) { console.error('\nscp failed.'); process.exit(1); }

console.log('\n[3/3] Import into this database ...');
r = run('node', [IMPORT, LOCAL, '--commit']);
process.exit(r.status || 0);

'use strict';
// pull_corrections.js — ONE-COMMAND ad-hoc sync of corrections from PROD into THIS (dev) database, driven
// from dev: (1) SSH to prod, run export_corrections.js there (prod's local root@localhost DB), (2) scp the
// JSON back, (3) import here (idempotent upsert by id). ssh/scp keep the terminal attached so a password
// prompt works (or use SSH key auth for no prompt).
//
// One-time in .env:
//   PROD_SSH=usat-server@100.103.13.100
//   PROD_REPO=/home/usat-server/development/usat/sql_programs     # optional; default shown (ABSOLUTE — no ~)
// Then any time:
//   node src/usat_apps/modules/salesforce_email_queue/pull_corrections.js
//   (or the module menu -> Corrections sync -> Pull corrections from prod)
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const path = require('path');
const { spawnSync } = require('child_process');

const SSH = process.env.PROD_SSH;
const REPO = process.env.PROD_REPO || '/home/usat-server/development/usat/sql_programs';   // ABSOLUTE, no ~
const REMOTE_TMP = '/tmp/corrections_export.json';
const LOCAL = 'corrections_export.json';                        // relative to cwd (repo root)
const REMOTE_EXPORT = 'src/usat_apps/modules/salesforce_email_queue/export_corrections.js';
const IMPORT = path.resolve(__dirname, 'import_corrections.js');

if (!SSH) { console.error('PROD_SSH is not set. Add it to .env, e.g.:\n  PROD_SSH=usat-server@100.103.13.100'); process.exit(1); }

// shell:false so the LOCAL shell never expands ~/paths/&&; MSYS_* stop Git-Bash from rewriting POSIX paths
// (e.g. /home, /tmp) into Windows paths before they reach prod. The remote command runs in prod's own bash.
const ENV = Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' });
function run(bin, args) { return spawnSync(bin, args, { stdio: 'inherit', shell: false, env: ENV }); }

console.log('[1/3] Export on prod (' + SSH + ') …');
let r = run('ssh', [SSH, 'cd ' + REPO + ' && node ' + REMOTE_EXPORT + ' ' + REMOTE_TMP]);
if (r.status !== 0) { console.error('\nRemote export failed. Check PROD_SSH, PROD_REPO (absolute path), and SSH access.'); process.exit(1); }

console.log('\n[2/3] Copy the file back …');
r = run('scp', [SSH + ':' + REMOTE_TMP, LOCAL]);
if (r.status !== 0) { console.error('\nscp failed.'); process.exit(1); }

console.log('\n[3/3] Import into this database …');
r = run('node', [IMPORT, LOCAL, '--commit']);
process.exit(r.status || 0);

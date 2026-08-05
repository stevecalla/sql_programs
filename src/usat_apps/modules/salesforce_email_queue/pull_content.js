'use strict';
// pull_content.js — ad-hoc sync of the CONTENT / knowledge files (the context tree the AI reads) from PROD
// into THIS (dev) machine's data dir, driven from dev. scp -r the remote context folder into a temp, then
// merge it into this machine's real context dir (resolved via services/knowledge/data_dir, so it honors any
// EQ_DATA_DIR / config override). Additive + overwrite by name; never deletes dev-only files.
//
// One-time in .env:
//   PROD_SSH=usat-server@100.103.13.100
//   PROD_CONTEXT=/home/usat-server/development/usat/data/usat_email_queue/context   # optional; default shown
// Then any time:
//   node src/usat_apps/modules/salesforce_email_queue/pull_content.js
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const data_dir = require('../../services/knowledge/data_dir');

const SSH = process.env.PROD_SSH;
const PROD_CONTEXT = process.env.PROD_CONTEXT || '/home/usat-server/development/usat/data/usat_email_queue/context';
if (!SSH) { console.error('PROD_SSH is not set. Add it to .env, e.g.:\n  PROD_SSH=usat-server@100.103.13.100'); process.exit(1); }

const ENV = Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' });
function run(bin, args) { return spawnSync(bin, args, { stdio: 'inherit', shell: false, env: ENV }); }
function countFiles(d) { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) n += countFiles(path.join(d, e.name)); else n++; } } catch (e) { /* ignore */ } return n; }

(async () => {
  const localContext = await data_dir.context();     // this machine's context dir (honors overrides)
  const tmp = '_eq_context_pull';                     // relative (no drive letter — avoids scp's "C:=host" trap)
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log('[1/2] Copy context from prod (' + SSH + ':' + PROD_CONTEXT + ') …');
  const r = run('scp', ['-r', SSH + ':' + PROD_CONTEXT, tmp]);
  if (r.status !== 0) { console.error('\nscp failed. Check PROD_SSH / PROD_CONTEXT.'); process.exit(1); }

  // scp may land the tree as <tmp> (contents) or <tmp>/context depending on version — handle both.
  const src = fs.existsSync(path.join(tmp, 'context')) ? path.join(tmp, 'context') : tmp;
  console.log('[2/2] Merge into local context: ' + localContext);
  fs.mkdirSync(localContext, { recursive: true });
  fs.cpSync(src, localContext, { recursive: true, force: true });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log('\nDone. Local context now has ' + countFiles(localContext) + ' file(s) at:\n  ' + localContext);
})().catch(function (e) { console.error('ERROR:', (e && e.message) || e); process.exit(1); });

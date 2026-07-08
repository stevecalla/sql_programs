'use strict';
/**
 * data_dir.js — cross-platform home for the usat_apps platform runtime data (auth + panel access).
 *
 * Mirrors src/reporting/data_dir.js: resolve the platform/user base with determineOSPath() and create
 * a project subfolder under it:
 *   <determineOSPath()>/usat_apps/
 *     auth.json           local user store (scrypt-hashed passwords + session secret)
 *     panel_access.json   per-user panel allow-list (default + per-user overrides)
 *
 * That base is usat/data/ on linux/mac, so auth data lives OUTSIDE the sql_programs repo and is never
 * committed. Created automatically (mkdir recursive) on first write. Override: USATAPPS_DATA_DIR.
 */
const path = require('path');
const fs = require('fs');
const { determineOSPath, determineOSPathSync } = require('../../utilities/determineOSPath');

async function base() {
  if (process.env.USATAPPS_DATA_DIR) return process.env.USATAPPS_DATA_DIR;
  const root = await determineOSPath();            // e.g. .../usat/data/
  return path.join(root, 'usat_apps');
}
async function ensure(sub) {
  const d = sub ? path.join(await base(), sub) : await base();
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// Sync resolver (no mkdir) for modules that compute a file path at load time (auth/panel_access).
function base_sync() {
  if (process.env.USATAPPS_DATA_DIR) return process.env.USATAPPS_DATA_DIR;
  return path.join(determineOSPathSync(), 'usat_apps');
}
function file_sync(name) { return path.join(base_sync(), name); }

module.exports = { base, ensure, base_sync, file_sync };

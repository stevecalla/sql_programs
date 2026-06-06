/**
 * data_dir.js — cross-platform home for race data + generated files.
 *
 * Follows the same convention as src/event_analysis (menu.js): resolve the
 * platform/user base with utilities/determineOSPath() and create a project
 * subfolder under it. That base is  usat/data/  on linux/mac, so the data
 * lives at  usat/data/race_results_transform/  — OUTSIDE the sql_programs repo,
 * so athlete PII (names, DOB, email) is never committed / never reaches GitHub.
 *
 *   <determineOSPath()>/race_results_transform/
 *     inputs/    source race files to convert
 *     outputs/   reformatted .xlsx the CLI writes
 *     expected/  golden snapshots for the fixture tests
 *
 * The directory is created automatically (mkdir recursive) on first use, so it
 * just works on a fresh linux/mac/windows machine. Async, because
 * determineOSPath() is async. Node-only; the browser app writes no files.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { determineOSPath } = require('../../utilities/determineOSPath');

async function base() {
  const root = await determineOSPath();          // e.g. .../usat/data/
  return path.join(root, 'race_results_transform');
}
async function ensure(sub) {
  const d = sub ? path.join(await base(), sub) : await base();
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = {
  base: base,
  inputs: function () { return ensure('inputs'); },
  outputs: function () { return ensure('outputs'); },
  expected: function () { return ensure('expected'); }
};

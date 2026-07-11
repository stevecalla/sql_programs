"use strict";
// Cross-platform test runner for the usat_apps platform. Recursively discovers *.test.js (skipping
// node_modules/.git) and runs EACH file under Node's built-in test runner behind a labeled section
// header, then prints a roll-up: per-suite PASS/FAIL with its test count, plus the grand total of
// individual tests.
//
// Output: the child inherits the terminal and uses the *spec* reporter (so you keep Node's normal
// coloured/checkmark formatting per section). To also total the tests without capturing/altering that
// output, a second *tap* reporter is written to a temp file which we parse only for the counters.
// Per-file invocation (not `node --test <dir>` or a glob) because directory discovery and glob
// expansion are unreliable across Node versions and on Windows.
//
//   node src/usat_apps/run_tests.js                              # whole platform (auth + every module)
//   node src/usat_apps/run_tests.js modules/participation_maps   # just one module/subtree
//   (or: npm run usat_apps_test)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = __dirname; // src/usat_apps
const sub = process.argv[2]; // optional subtree filter, relative to ROOT
const SEARCH = sub ? path.resolve(ROOT, sub) : ROOT;
if (!fs.existsSync(SEARCH)) { console.error("Path not found: " + SEARCH); process.exit(1); }

function findTests(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findTests(p, out);
    else if (e.isFile() && /\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
function countOf(out, field) {
  const m = out.match(new RegExp("^# " + field + " (\\d+)", "m"));
  return m ? Number(m[1]) : 0;
}

const BAR = "=".repeat(64);
const files = findTests(SEARCH, []).sort();
if (files.length === 0) { console.error("No *.test.js files found under " + SEARCH); process.exit(1); }

const results = [];
const tot = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  console.log("\n" + BAR);
  console.log("  " + rel);
  console.log(BAR);
  const tapFile = path.join(os.tmpdir(), "usat_apps_tap_" + process.pid + "_" + i + ".tap");
  const args = ["--test",
    "--test-reporter", "spec", "--test-reporter-destination", "stdout",
    "--test-reporter", "tap", "--test-reporter-destination", tapFile,
    f];
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  let tap = "";
  try { tap = fs.readFileSync(tapFile, "utf8"); } catch (e) { /* reporter flags unsupported? counts stay 0 */ }
  try { fs.unlinkSync(tapFile); } catch (e) { /* ignore */ }
  const c = { tests: countOf(tap, "tests"), pass: countOf(tap, "pass"), fail: countOf(tap, "fail"), skipped: countOf(tap, "skipped"), todo: countOf(tap, "todo") };
  for (const k of Object.keys(tot)) tot[k] += c[k];
  results.push({ rel: rel, ok: r.status === 0, tests: c.tests, fail: c.fail });
}

const suitesFailed = results.filter(function (r) { return !r.ok; }).length;
console.log("\n" + BAR);
console.log("  SUMMARY" + (sub ? "  (" + sub + ")" : ""));
console.log(BAR);
results.forEach(function (r) {
  console.log("  " + (r.ok ? "PASS" : "FAIL") + "  " + r.rel + "  (" + r.tests + " test" + (r.tests === 1 ? "" : "s") + (r.fail ? ", " + r.fail + " failed" : "") + ")");
});
console.log("");
console.log("  " + files.length + " suite(s): " + (files.length - suitesFailed) + " passed, " + suitesFailed + " failed");
console.log("  " + tot.tests + " test(s):  " + tot.pass + " passed, " + tot.fail + " failed"
  + (tot.skipped ? ", " + tot.skipped + " skipped" : "")
  + (tot.todo ? ", " + tot.todo + " todo" : ""));
console.log("");
process.exit(suitesFailed || tot.fail ? 1 : 0);

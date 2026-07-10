#!/usr/bin/env node
'use strict';
/**
 * make_fixture.js — helper to seed the participation bootstrap fixture from a standalone dashboard
 * build. `build_from_mysql()` is now live, so this fixture is only an OFFLINE FALLBACK used when the
 * DB is unreachable — keep it (optional), no longer required for the app to run.
 *
 * Usage:
 *   node src/reporting/store/make_fixture.js "<path-to>/usat_participation_dashboard_LATEST.html"
 *
 * It extracts the baked `window.DASH = { ... };` object from the HTML and writes it to
 * store/fixtures/participation_bootstrap.json.
 */
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('usage: node make_fixture.js <path-to-standalone-dashboard.html>'); process.exit(1); }

const html = fs.readFileSync(src, 'utf8');
const start = html.indexOf('window.DASH=');
if (start < 0) { console.error('could not find "window.DASH=" in ' + src); process.exit(1); }

// Brace-match from the first '{' after window.DASH= to its matching close.
const open = html.indexOf('{', start);
let depth = 0, end = -1, inStr = false, q = '', esc = false;
for (let i = open; i < html.length; i++) {
  const c = html[i];
  if (inStr) {
    if (esc) { esc = false; }
    else if (c === '\\') { esc = true; }
    else if (c === q) { inStr = false; }
    continue;
  }
  if (c === '"' || c === "'") { inStr = true; q = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) { console.error('could not brace-match the DASH object'); process.exit(1); }

const json = html.slice(open, end);
const obj = JSON.parse(json); // validate it parses
const out = path.join(__dirname, 'fixtures', 'participation_bootstrap.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(obj));
console.log('wrote ' + out + ' (' + (json.length / 1024).toFixed(0) + ' KB)');

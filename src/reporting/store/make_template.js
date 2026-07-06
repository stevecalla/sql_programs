#!/usr/bin/env node
'use strict';
/**
 * make_template.js — turn the standalone participation dashboard into a server-injected template.
 *
 * The standalone build bakes `window.DASH = { ...big object... };` into the HTML. This copies that
 * HTML but replaces the baked object with the token `__DASH_JSON__`, producing
 * store/participation_dashboard.tmpl.html. At request time the server replaces the token with the
 * LIVE bootstrap payload (MySQL, or the fixture), so the exact POC dashboard renders with live data.
 *
 * Re-run this whenever the standalone dashboard changes.
 *   node src/reporting/store/make_template.js "<path-to>/usat_participation_dashboard_LATEST.html"
 */
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('usage: node make_template.js <path-to-standalone-dashboard.html>'); process.exit(1); }

const html = fs.readFileSync(src, 'utf8');
const start = html.indexOf('window.DASH=');
if (start < 0) { console.error('could not find "window.DASH=" in ' + src); process.exit(1); }
const open = html.indexOf('{', start);

// brace-match, ignoring braces inside strings
let depth = 0, end = -1, inStr = false, q = '', esc = false;
for (let i = open; i < html.length; i++) {
  const ch = html[i];
  if (inStr) {
    if (esc) esc = false;
    else if (ch === '\\') esc = true;
    else if (ch === q) inStr = false;
    continue;
  }
  if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) { console.error('could not brace-match the DASH object'); process.exit(1); }

const tmpl = html.slice(0, open) + '__DASH_JSON__' + html.slice(end);
const out = path.join(__dirname, 'participation_dashboard.tmpl.html');
fs.writeFileSync(out, tmpl);
console.log('wrote ' + out + ' (' + (tmpl.length / 1024).toFixed(0) + ' KB) — token __DASH_JSON__ replaces the baked DASH');

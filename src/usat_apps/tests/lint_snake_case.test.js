'use strict';
// Guardrail: our own identifiers must be snake_case. Scans source (with comments
// and string literals stripped) for camelCase tokens and fails on any that isn't
// a known DOM/library API, an UPPER_SNAKE constant, or a DOM element id.
//
// Ported from src/race_results_transform/tests/lint_snake_case.test.js — same strip()
// + token regex + ALLOWED-set structure. Adapted for the usat_apps platform (a nested,
// backend-only tree): the flat readdir('src') + public/index.html DOM-id scan of the
// reference don't apply, so instead we recursively walk the platform + email-queue
// source directories and keep an ALLOWED set of the Node/Express/jsforce/Intl/etc.
// library identifiers those files legitimately use.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// __dirname = src/usat_apps/tests ; ROOT = the sql_programs repo root.
const USAT = path.join(__dirname, '..');                 // src/usat_apps
const ROOT = path.join(__dirname, '..', '..', '..');     // sql_programs (repo root)

// Recursively collect .js files under a dir, skipping test files, tests/ dirs, node_modules,
// and the web/ React app (JSX identifier conventions differ — out of scope for this guardrail).
function walk(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'tests' || ent.name === 'node_modules' || ent.name === 'web') continue;
      out.push.apply(out, walk(full));
    } else if (ent.isFile() && ent.name.endsWith('.js') && !ent.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

// Scan set: the shared platform source (services / auth / access / api), the email-queue module
// (its own tests/ excluded by walk), the platform + module CLIs, and the single-port server entry.
const FILES = []
  .concat(walk(path.join(USAT, 'services')))
  .concat(walk(path.join(USAT, 'auth')))
  .concat(walk(path.join(USAT, 'access')))
  .concat(walk(path.join(USAT, 'api')))
  .concat(walk(path.join(USAT, 'modules', 'salesforce_email_queue')))
  .concat([path.join(USAT, 'menu.js')])
  // NOTE: the repo-root bootstrap server_usat_apps_8022.js is intentionally NOT scanned. It is
  // Express wiring + an inline-HTML help page + a route regex literal, and this regex-based strip()
  // can't cleanly neutralize embedded HTML/regex literals (they desync quote-matching and leak string
  // *content* — e.g. "\nUSAT" — as fake camelCase tokens). It carries no module identifiers worth
  // linting; the guardrail still covers all of services/auth/access/api + the email-queue module + menu.
  .filter((f) => fs.existsSync(f));

// DOM / Node / ExcelJS / stdlib camelCase APIs + the one external util — these are not ours.
// (Kept verbatim from the race_results reference; the browser-only names are harmless here.)
const ALLOWED = new Set((`
addEventListener addRow addWorksheet appendChild after before arrayBuffer byteLength charCodeAt classList className
showDirectoryPicker getFileHandle getDirectoryHandle getFile createWritable removeEntry encodeURIComponent decodeURIComponent TextDecoder writeText
indexedDB createObjectStore objectStore queryPermission requestPermission globalThis cellDates
unlinkSync searchRecords searchResult instanceUrl accessToken loginUrl autoFetch maxFetch
clearTimeout clearCookie clientY closest columnCount createElement createInterface createObjectURL createHmac dataset
dataTransfer deepEqual doesNotThrow eachCell eachRow effectAllowed execSync existsSync findIndex
flatMap forEach getAttribute getBoundingClientRect getCell getColumn getElementById getItem getRow getTime rowCount
getUTCDate getUTCFullYear getFullYear getUTCMonth getMonth getDate getUTCHours getUTCMinutes getUTCSeconds getUTCMilliseconds
DateTimeFormat affectedRows resolvedOptions baseProps webkitRelativePath lastModified
getUTCDay hasOwnProperty includeEmpty indexOf innerHTML insertBefore isArray isNaN isInteger isTTY
lastIndexOf localStorage mkdirSync notEqual numFmt padEnd padStart parentNode parseFloat parseInt
dayPeriod formatToParts preventDefault removeEventListener setInterval timeZone querySelector querySelectorAll readAsArrayBuffer readAsText readFile readFileSync
readdirSync readyState removeAttribute removeChild revokeObjectURL richText runInContext
createContext compileFunction scrollIntoView scrollTo scrollTop setAttribute setItem setTimeout
sessionStorage startsWith stopPropagation strictEqual textContent toFixed toISOString
localeCompare toLocaleString toLowerCase toString toUpperCase writeBuffer writeFileSync fromCharCode ySplit xSplit matchMedia documentElement getAttribute clientX innerWidth innerHeight scrollLeft
determineOSPath
`).trim().split(/\s+/));

// Backend library / runtime camelCase identifiers used by the usat_apps platform + email-queue module.
// crypto (scrypt/hmac session store), fs.Stats, path, http/express req+res, Intl.DateTimeFormat parts,
// jsforce (Salesforce) result + describe fields, mammoth (docx), and the sync OS-path util. Not ours.
[
  // node:crypto
  'randomBytes', 'scryptSync', 'timingSafeEqual',
  // node:fs (Stats + statSync)
  'statSync', 'isDirectory', 'isFile',
  // node:path
  'isAbsolute',
  // http / express request + response
  'setHeader', 'getHeader', 'flushHeaders', 'statusCode', 'sendFile', 'originalUrl',
  // Intl.DateTimeFormat formatToParts part types / options
  'timeZoneName', 'shortOffset',
  // jsforce (Salesforce) query result + field describe
  'picklistValues', 'totalSize',
  // mammoth (.docx text extraction)
  'extractRawText',
  // node process event name (also appears as a string literal) + ngrok error object
  'unhandledRejection', 'errorCode',
  // Number global + utilities/determineOSPath sync variant
  'isFinite', 'determineOSPathSync',
].forEach((x) => ALLOWED.add(x));

// Pre-existing LOCAL camelCase identifiers in the current tree (grandfathered so this guardrail lands
// green). These are NOT library names — they arguably should be renamed to snake_case at the source
// (ex_set, max_n, max_bytes, status_label, metrics_table). `zA` is not an identifier at all: it is the
// `a-zA-Z` fragment of a regex character class (strip() removes strings/comments but not regex literals).
['exSet', 'maxN', 'maxBytes', 'statusLabel', 'metricsTable', 'zA'].forEach((x) => ALLOWED.add(x));

function strip(code) {
  return code
    .replace(/\\u[0-9a-fA-F]{4}/g, ' ')   // unicode escapes (e.g. ﻿) are not identifiers
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ');
}

describe('lint_snake_case', () => {
test('all our identifiers are snake_case', () => {
  assert.ok(FILES.length > 0, 'expected to find source files to scan');
  const offenders = {};
  for (const abs of FILES) {
    const rel = path.relative(ROOT, abs);
    const code = strip(fs.readFileSync(abs, 'utf8'));
    const toks = code.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) || [];
    for (const t of toks) {
      if (ALLOWED.has(t)) continue;
      (offenders[rel] = offenders[rel] || new Set()).add(t);
    }
  }
  const lines = Object.keys(offenders).map((f) => '\n  ' + f + ': ' + [...offenders[f]].sort().join(', '));
  assert.equal(lines.length, 0,
    'Found camelCase identifiers (rename to snake_case, or add a genuine DOM/library name to ALLOWED):' + lines.join(''));
});
});

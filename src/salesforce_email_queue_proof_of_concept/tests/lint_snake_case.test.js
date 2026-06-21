'use strict';
// Guardrail (mirrors race_results_transform/tests/lint_snake_case.test.js): every identifier WE define
// must be snake_case. Scans our source (comments + string literals + <style>/<!--> stripped) for
// camelCase tokens and fails on any that isn't a known DOM/Node/library API or a DOM element id.
//
// Workflow when it fails: if the token is a genuine camelCase library/DOM/Node/jsforce/Express/mysql2
// name (e.g. `randomBytes`, `sendFile`, `instanceUrl`), add it to ALLOWED below. Otherwise rename the
// identifier to snake_case. (DOM element ids referenced as strings are auto-allowed.)
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
function walk(rel) {
  const abs = path.join(ROOT, rel); if (!fs.existsSync(abs)) return [];
  let out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const r = rel + '/' + e.name;
    if (e.isDirectory()) out = out.concat(walk(r));
    else if (e.name.endsWith('.js')) out.push(r);
  }
  return out;
}
const FILES = []
  .concat(walk('ai'), walk('sf'), walk('store'), walk('auth'), walk('metrics'))
  .concat(['web/routes.js', 'data_dir.js', 'menu.js', 'web/public/index.html', '../../server_salesforce_email_queue_8019.js'])
  .concat(fs.readdirSync(__dirname).filter((f) => /\.test\.js$/.test(f) && f !== 'lint_snake_case.test.js').map((f) => 'tests/' + f))
  .filter((rel) => fs.existsSync(path.join(ROOT, rel)));

// Genuine camelCase names from DOM / Node / Intl / jsforce / Express / mysql2 / crypto / mammoth /
// the shared analytics client — these are NOT ours, so they're allowed.
const ALLOWED = new Set((`
addEventListener removeEventListener appendChild insertBefore removeChild createElement createTextNode createDocumentFragment
getElementById querySelector querySelectorAll getAttribute setAttribute removeAttribute classList className dataset textContent innerHTML
innerWidth innerHeight clientX clientY getBoundingClientRect scrollIntoView scrollTop scrollLeft scrollHeight offsetWidth offsetHeight
parentNode nextSibling preventDefault stopPropagation matchMedia documentElement createObjectURL revokeObjectURL execCommand selectedIndex maxLength
overflowY translateY readyState contentWindow cloneNode
getItem setItem removeItem localStorage sessionStorage setTimeout clearTimeout setInterval clearInterval encodeURIComponent decodeURIComponent writeText lastIndex requestAnimationFrame
toISOString toUTCString toLocaleString toLocaleDateString toLocaleTimeString toLowerCase toUpperCase toFixed toString charCodeAt fromCharCode
padStart padEnd startsWith endsWith indexOf lastIndexOf findIndex flatMap forEach localeCompare splitN
getTime getFullYear getMonth getDate getDay getHours getMinutes getSeconds getMilliseconds
getUTCFullYear getUTCMonth getUTCDate getUTCDay getUTCHours getUTCMinutes getUTCSeconds getUTCMilliseconds
isInteger isFinite isNaN isArray hasOwnProperty parseInt parseFloat
DateTimeFormat resolvedOptions timeZone formatToParts dayPeriod
sendBeacon arrayBuffer randomUUID byteLength
readFileSync writeFileSync readdirSync mkdirSync existsSync unlinkSync statSync isFile mkdtempSync readFile
randomBytes scryptSync timingSafeEqual createHmac
createInterface isTTY setEncoding removeListener unhandledRejection statusCode setHeader sendFile headersSent originalUrl
instanceUrl accessToken loginUrl searchRecords searchResult totalSize picklistValues maxFetch autoFetch
createPool connectionLimit affectedRows insertId
extractRawText
allowList autoPageView baseProps newSession newUpload
strictEqual deepStrictEqual notEqual doesNotThrow deepEqual
determineOSPath determineOSPathSync
`).trim().split(/\s+/));

// DOM element ids (camelCase) referenced as $('id') / getElementById('id') / id="id" / id:'id' — allow them.
const idx = fs.readFileSync(path.join(ROOT, 'web', 'public', 'index.html'), 'utf8');
(idx.match(/id="([A-Za-z][A-Za-z0-9]*)"/g) || []).forEach((m) => ALLOWED.add(m.slice(4, -1)));
(idx.match(/id:\s*'([A-Za-z][A-Za-z0-9]*)'/g) || []).forEach((m) => ALLOWED.add(m.replace(/.*'([^']*)'.*/, '$1')));
(idx.match(/getElementById\('([A-Za-z][A-Za-z0-9]*)'\)/g) || []).forEach((m) => ALLOWED.add(m.replace(/.*'([^']*)'.*/, '$1')));

function strip(code) {
  return code
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\\u[0-9a-fA-F]{4}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ');
}

describe('lint_snake_case', () => {
  test('all our identifiers are snake_case', () => {
    const offenders = {};
    for (const rel of FILES) {
      const code = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
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

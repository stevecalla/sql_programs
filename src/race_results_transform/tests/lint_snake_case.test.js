'use strict';
// Guardrail: our own identifiers must be snake_case. Scans source (with comments
// and string literals stripped) for camelCase tokens and fails on any that isn't
// a known DOM/library API, an UPPER_SNAKE constant, or a DOM element id.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = []
  .concat(fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f))
  .concat(['public/js/app.js', 'menu.js', 'data_dir.js'])
  .concat(fs.readdirSync(__dirname).filter((f) => /\.test\.js$/.test(f) && f !== 'lint_snake_case.test.js').map((f) => 'tests/' + f));

// DOM / Node / ExcelJS / stdlib camelCase APIs + the one external util — these are not ours.
const ALLOWED = new Set((`
addEventListener addRow addWorksheet appendChild after before charCodeAt classList className
clearTimeout clientY closest columnCount createElement createInterface createObjectURL dataset
dataTransfer deepEqual doesNotThrow eachCell eachRow effectAllowed execSync existsSync findIndex
flatMap forEach getAttribute getBoundingClientRect getCell getElementById getItem getRow getTime
getUTCDate getUTCFullYear getUTCMonth getUTCHours getUTCMinutes getUTCSeconds getUTCMilliseconds
getUTCDay hasOwnProperty includeEmpty indexOf innerHTML insertBefore isArray isNaN isInteger isTTY
lastIndexOf localStorage mkdirSync notEqual numFmt padEnd padStart parentNode parseFloat parseInt
preventDefault removeEventListener querySelector querySelectorAll readAsArrayBuffer readAsText readFile readFileSync
readdirSync readyState removeAttribute removeChild revokeObjectURL richText runInContext
createContext compileFunction scrollIntoView scrollTo scrollTop setAttribute setItem setTimeout
sessionStorage startsWith stopPropagation strictEqual textContent toFixed toISOString
localeCompare toLocaleString toLowerCase toString toUpperCase writeBuffer writeFileSync fromCharCode ySplit xSplit matchMedia documentElement getAttribute clientX innerWidth scrollLeft
determineOSPath
`).trim().split(/\s+/));

// DOM element ids (camelCase) are referenced as $('id') strings; allow them.
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
(html.match(/id="([A-Za-z][A-Za-z0-9]*)"/g) || []).forEach((m) => ALLOWED.add(m.slice(4, -1)));
// dynamic ids created in JS (DOM ids by nature)
['skipChip', 'approveAll', 'approveToggle', 'forgetProfile'].forEach((x) => ALLOWED.add(x));

function strip(code) {
  return code
    .replace(/\\u[0-9a-fA-F]{4}/g, ' ')   // unicode escapes (e.g. \uFEFF) are not identifiers
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ');
}

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

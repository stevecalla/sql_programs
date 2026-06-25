'use strict';
// Integrity guard for the static web assets. Twice, a host-side write truncated
// public/index.html (dropping the closing <script>/app.js + </body>) and app.css
// (cut mid-rule), which silently broke the whole UI. These checks fail loudly if
// a file is truncated, a script is unclosed, or a referenced file goes missing.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');

// index.html src="..." resolves: src/* from the engine dir (served at /src),
// js/* and vendor/* from public/.
function resolve_src(s) {
  if (s.indexOf('src/') === 0) return path.join(ROOT, s);
  if (s.indexOf('/analytics/') === 0) return path.join(ROOT, '..', '..', 'utilities', s); // shared analytics client, served by the server
  return path.join(PUB, s);
}

const REQUIRED = ['vendor/exceljs.min.js', 'src/schema.js', 'src/normalize.js', 'src/display.js',
  'src/sort.js', 'src/view_logic.js', 'src/duplicates.js', 'src/split.js', 'src/parse.js', 'src/match.js', 'src/transform.js',
  'src/reconcile.js', 'src/mapping.js', 'src/pipeline.js', 'src/io.js', 'js/app.js',
  'js/metrics.js', '/analytics/metrics_client.js'];

describe('web_assets', () => {
test('index.html is not truncated (ends with </body></html>)', () => {
  assert.match(html, /<\/body>\s*<\/html>\s*$/,
    'index.html is truncated — missing closing </body></html>');
});

test('every <script> tag is closed', () => {
  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  assert.equal(open, close, 'unbalanced <script> tags — an unclosed/truncated <script> tag');
});

test('all required scripts are loaded and exist on disk', () => {
  for (const rel of REQUIRED) {
    assert.ok(html.indexOf('src="' + rel + '"') >= 0, 'index.html no longer loads ' + rel);
    assert.ok(fs.existsSync(resolve_src(rel)), 'referenced file is missing: ' + rel);
  }
});

test('every script index.html references actually exists', () => {
  const tags = html.match(/<script\b[^>]*src="[^"]+"/g) || [];
  const srcs = tags.map(function (t) { return t.match(/src="([^"]+)"/)[1]; });
  assert.ok(srcs.length >= REQUIRED.length, 'fewer <script src> tags than expected — truncated?');
  for (const s of srcs) assert.ok(fs.existsSync(resolve_src(s)), 'index.html references a missing file: ' + s);
});

test('browser scripts parse (no mid-file truncation / syntax error)', () => {
  const files = REQUIRED.filter(function (s) { return s.indexOf('src/') === 0; })
    .map(function (s) { return path.join(ROOT, s); })
    .concat([path.join(PUB, 'js', 'app.js')]);   // vendored exceljs is third-party + huge; existence-checked above, not parsed here
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    // new Function compiles (throws on syntax error) without executing the code.
    assert.doesNotThrow(function () { return new Function(code); }, 'syntax error / truncation in ' + path.basename(f));
  }
});

test('app.css has balanced braces and ends on a complete rule', () => {
  const css = fs.readFileSync(path.join(PUB, 'css', 'app.css'), 'utf8');
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  assert.equal(open, close, 'app.css has unbalanced { } — truncated mid-rule');
  assert.match(css, /}\s*$/, 'app.css does not end on a closing } — truncated');
});
});

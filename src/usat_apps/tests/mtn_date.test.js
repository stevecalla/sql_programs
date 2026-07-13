'use strict';
// Shared MTN timestamp formatter (web/src/lib/mtnDate.js). Loaded via a data: URL (ESM) like the
// track.js test. Verifies weekday derivation (tz-safe), 12-hour AM/PM incl. midnight/noon, and the
// empty / passthrough cases.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const p = path.join(__dirname, '..', 'web', 'src', 'lib', 'mtnDate.js');
  const src = fs.readFileSync(p, 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

test('formats weekday, month/day, year, 12-hour AM/PM', async () => {
  const { formatMtn } = await load();
  // Jan 1, 2000 was a Saturday.
  assert.strictEqual(formatMtn('2000-01-01 13:05:00'), 'Sat, Jan 1, 2000 · 1:05 PM');
  assert.strictEqual(formatMtn('2000-01-01 00:00:00'), 'Sat, Jan 1, 2000 · 12:00 AM');
  assert.strictEqual(formatMtn('2000-01-01 12:00:00'), 'Sat, Jan 1, 2000 · 12:00 PM');
});

test('accepts a T separator and always shows the year + weekday', async () => {
  const { formatMtn } = await load();
  const out = formatMtn('2026-07-13T09:05:30');
  assert.match(out, /^Mon, Jul 13, 2026 · 9:05 AM$/);   // Jul 13, 2026 is a Monday
});

test('empty -> em dash; unparseable -> passthrough', async () => {
  const { formatMtn } = await load();
  assert.strictEqual(formatMtn(null), '—');
  assert.strictEqual(formatMtn(''), '—');
  assert.strictEqual(formatMtn('n/a'), 'n/a');
});

test('normalizes the legacy report formats to the same string', async () => {
  const { formatMtn } = await load();
  assert.strictEqual(formatMtn('2026-07-13 4:52 PM'), 'Mon, Jul 13, 2026 · 4:52 PM');   // %Y-%m-%d %l:%i %p
  assert.strictEqual(formatMtn('Jul 13, 2026 4:52 PM'), 'Mon, Jul 13, 2026 · 4:52 PM'); // %b %e, %Y %l:%i %p
  assert.strictEqual(formatMtn('2026-07-13 16:52:07'), 'Mon, Jul 13, 2026 · 4:52 PM');  // raw sortable
  assert.strictEqual(formatMtn('2026-07-13 12:00 AM'), 'Mon, Jul 13, 2026 · 12:00 AM'); // midnight
});

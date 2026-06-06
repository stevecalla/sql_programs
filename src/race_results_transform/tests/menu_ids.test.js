'use strict';
// Guard: menu.js item numbers must stay sequential (1..N) in display order, with
// no gaps or duplicates. Inserting/removing items has repeatedly left the numbers
// out of order; this catches it. Text-scan (menu.js isn't require-able — it launches
// the interactive menu on load).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('menu_ids', () => {
test('menu item ids are sequential 1..N (no gaps or duplicates)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'menu.js'), 'utf8');
  const ids = (src.match(/id:\s*\d+\s*,\s*label:/g) || []).map(function (m) { return Number(m.match(/\d+/)[0]); });
  assert.ok(ids.length > 0, 'no menu items found in menu.js');
  const expected = ids.map(function (_unused, i) { return i + 1; });
  assert.deepEqual(ids, expected,
    'menu ids must be sequential in display order (1..N) — renumber after inserting/removing items');
});
});

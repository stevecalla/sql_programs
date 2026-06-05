'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const io = require('../src/io');

test('grid_to_buffer -> read_to_ir round-trips text cells', async () => {
  const headers = ['Member Number', 'Recorded Time'];
  const rows = [['1-day', '01:04:28.000'], ['2100013891', '01:12:57.000']];
  const buf = await io.grid_to_buffer(headers, rows);
  const ir = await io.read_to_ir(Buffer.from(buf));
  assert.deepEqual(ir.rows[0], headers);
  assert.deepEqual(ir.rows[1], rows[0]);
  assert.deepEqual(ir.rows[2], rows[1]);
  // member number preserved as text (no scientific notation / number coercion)
  assert.equal(ir.rows[2][0], '2100013891');
});

'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const io = require('../src/io');
const pipe = require('../src/pipeline');
const schema = require('../src/schema');

const data_dir = require('../src/data_dir');

// Resolve the data dir lazily; skip gracefully where it can't be created
// (e.g. CI without the usat/data tree). PII never lives in the repo.
async function dirs() {
  try { return { INPUTS: await data_dir.inputs(), EXPECTED: await data_dir.expected() }; }
  catch (e) { return null; }
}
function list_inputs(INPUTS) {
  return fs.readdirSync(INPUTS).filter((f) => /\.(xlsx|csv)$/i.test(f));
}

const TIME_RE = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;
const DOB_RE = /^\d{2}\/\d{2}\/\d{4}$/;

describe('fixtures', () => {
test('data dir reachable', async () => {
  const d = await dirs();
  if (!d) { console.log('  (data dir not creatable here — skipping fixtures)'); return; }
  console.log('  inputs: ' + d.INPUTS + ' (' + list_inputs(d.INPUTS).length + ' files)');
});

test('convert + invariants + golden snapshots', async () => {
  const d = await dirs();
  if (!d) return;
  const { INPUTS, EXPECTED } = d;
  const file_list = list_inputs(INPUTS);
  if (file_list.length === 0) { console.log('  (no inputs — skipped)'); return; }
  for (const f of file_list) {
    const ir = await io.read_file_to_ir(path.join(INPUTS, f));
    const { result, report } = pipe.convert(ir, {});

    assert.deepEqual(result.headers, schema.TARGET_HEADERS, f);
    assert.ok(result.row_count > 0, f);
    result.rows.forEach((r) => assert.equal(r.length, 12));
    assert.equal(report.rows.in, report.rows.out, f);

    const idx = (name) => result.headers.indexOf(name);
    const gi = idx('Gender'), di = idx('DOB'), ti = idx('Recorded Time'), mi = idx('Member Number'), ci = idx('Category');
    result.rows.forEach((r) => {
      if (r[gi] !== '') assert.ok(['M', 'F', 'NB', 'Open'].includes(r[gi]) || /^[A-Z]+$/.test(r[gi]), 'gender ' + r[gi]);
      if (r[di] !== '') assert.ok(DOB_RE.test(r[di]), 'dob ' + r[di]);
      if (r[ti] !== '') assert.ok(TIME_RE.test(r[ti]) || /^(DNS|DNF|DQ|DSQ|DNC|NT|W\/D|WD)$/.test(r[ti]), 'time ' + r[ti]);
      assert.ok(r[mi] === '1-day' || /^\d+$/.test(r[mi]), 'member ' + r[mi]);
      assert.ok(['Age Group', 'Elite', 'Para', 'Relay', 'Open', ''].includes(r[ci]), 'category ' + r[ci]);
    });

    const snap = { headers: result.headers, row_count: result.row_count, rows_in: report.rows.in,
      band: report.scorecard.band, pct: report.scorecard.pct, first3: result.rows.slice(0, 3) };
    const gp = path.join(EXPECTED, f.replace(/\.(xlsx|csv)$/i, '') + '.json');
    if (!fs.existsSync(gp)) { fs.writeFileSync(gp, JSON.stringify(snap, null, 2)); console.log('  (created golden ' + path.basename(gp) + ')'); }
    else assert.deepEqual(snap, JSON.parse(fs.readFileSync(gp, 'utf8')), 'drift: ' + f);
  }
});
});

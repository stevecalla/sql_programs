'use strict';
// Regression fixtures using SYNTHETIC, committed data (examples/sample) so the suite runs on any
// clone / CI without the machine-local usat/data directory. See examples/sample/README.md.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const io = require('../src/io');
const pipe = require('../src/pipeline');
const schema = require('../src/schema');

const DIR = path.join(__dirname, '..', 'examples', 'sample');
const EXP = path.join(DIR, 'expected');
const TIME = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;
const DOB = /^\d{2}\/\d{2}\/\d{4}$/;
const files = fs.readdirSync(DIR).filter(function (f) { return /\.(xlsx|csv)$/i.test(f); }).sort();

describe('sample', () => {
test('synthetic sample fixtures are present', function () { assert.ok(files.length >= 2, 'expected a .csv and a .xlsx sample'); });

files.forEach(function (f) {
  test('sample convert + invariants + golden: ' + f, async function () {
    const ir = await io.read_file_to_ir(path.join(DIR, f));
    const out = pipe.convert(ir, {});
    const result = out.result, report = out.report;

    assert.deepEqual(result.headers, schema.TARGET_HEADERS);
    assert.ok(result.row_count > 0);
    result.rows.forEach(function (r) { assert.equal(r.length, 12); });
    assert.equal(report.rows.in, report.rows.out);

    const ix = function (n) { return result.headers.indexOf(n); };
    const gi = ix('Gender'), di = ix('DOB'), ti = ix('Recorded Time'), mi = ix('Member Number'), ci = ix('Category');
    result.rows.forEach(function (r) {
      if (r[gi] !== '') assert.ok(['M', 'F', 'NB', 'Open'].includes(r[gi]) || /^[A-Z]+$/.test(r[gi]), 'gender ' + r[gi]);
      if (r[di] !== '') assert.ok(DOB.test(r[di]), 'dob ' + r[di]);
      if (r[ti] !== '') assert.ok(TIME.test(r[ti]) || /^(DNS|DNF|DQ|DSQ|DNC|NT)$/.test(r[ti]), 'time ' + r[ti]);
      assert.ok(r[mi] === '1-day' || /^\d+$/.test(r[mi]), 'member ' + r[mi]);
      assert.ok(['Age Group', 'Elite', 'Para', 'Relay', 'Open', ''].includes(r[ci]), 'category ' + r[ci]);
    });

    const snap = { headers: result.headers, row_count: result.row_count, rows_in: report.rows.in,
      band: report.scorecard.band, pct: report.scorecard.pct, first3: result.rows.slice(0, 3) };
    if (!fs.existsSync(EXP)) fs.mkdirSync(EXP, { recursive: true });
    const gp = path.join(EXP, f + '.json');
    if (!fs.existsSync(gp)) { fs.writeFileSync(gp, JSON.stringify(snap, null, 2)); console.log('  created golden ' + path.basename(gp)); }
    else assert.deepEqual(snap, JSON.parse(fs.readFileSync(gp, 'utf8')), 'output drifted from golden for ' + f);
  });
});
});

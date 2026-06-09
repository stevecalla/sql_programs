'use strict';
// Header-row detection (parse.detect_table). The key regression: real coworker workbooks put a
// one-cell TITLE/banner in row 1 and the actual column headers in row 2 (sometimes with a blank
// leading column). With match.score_headers supplied, detection must score rows by template-alias
// hits and land on the real header row — not the title, not a data row.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../src/parse');
const match = require('../src/match');

const SCORE = { score_header: match.score_headers };

// Mirrors the shape of the uploaded sample (title in row 1, headers in row 2). Synthetic data —
// no PII — but the same structure that used to mis-map.
function sample_ir(opts) {
  opts = opts || {};
  const lead = opts.blank_lead ? [''] : [];
  return {
    sheet_name: opts.name || 'Triathlon',
    rows: [
      lead.concat(['20260602-SpringSprintUvas-participants']),                                  // row1: one-cell title
      lead.concat(['First Name', 'Last Name', 'Bib', 'Email Address', 'Street Address', 'City',
                   'State', 'Country', 'Zip Code', 'Gender', 'Date of Birth', 'Event',
                   'Checked In', 'USAT Membership Number']),                                     // row2: real headers
      lead.concat(['Arnold', 'Queral', 194, 'arnoldqueral@example.com', '261 Banana Grove', 'San Jose',
                   'CA', 'US', '95123', 'M', '11/30/1974', 'Clydesdale', 'Yes', '2100213562']),
      lead.concat(['Mark', 'Roost', 129, 'markroost@example.com', '24750 Santa Cruz', 'Los Gatos',
                   'CA', 'US', '95033', 'M', '1/29/1981', 'Clydesdale', 'Yes', ''])
    ]
  };
}

describe('parse.detect_table — header scoring', () => {
  test('skips a one-cell title row and lands on the real header (row 2)', () => {
    const t = parse.detect_table(sample_ir(), SCORE);
    assert.equal(t.header_row_index, 1, 'header is row 2 (index 1), not the title row');
    assert.equal(t.headers[0], 'First Name');
    assert.ok(t.headers.includes('USAT Membership Number'));
    assert.equal(t.data_rows.length, 2, 'the two athlete rows survive');
    assert.equal(t.data_rows[0].cells[0], 'Arnold');
  });

  test('handles a blank leading column (headers/data shifted to column B)', () => {
    const t = parse.detect_table(sample_ir({ blank_lead: true, name: 'Relay' }), SCORE);
    assert.equal(t.header_row_index, 1);
    assert.equal(t.headers[0], 'Column 1', 'empty leading header becomes a placeholder, not dropped');
    assert.equal(t.headers[1], 'First Name');
    assert.equal(t.data_rows.length, 2);
  });

  test('does NOT pick a data row even when it has as many cells as the header', () => {
    const t = parse.detect_table(sample_ir(), SCORE);
    // the chosen header row matches many template columns; a data row (values like "CA"/"M") barely any
    assert.ok(match.score_headers(t.headers) >= 6, 'the chosen header row matches several template columns');
    assert.ok(match.score_headers(['Arnold', 'Queral', 'San Jose', 'CA', 'M']) <= 1, 'data values are not column names');
  });

  test('falls back to the string heuristic when no scorer is supplied (back-compat)', () => {
    const t = parse.detect_table(sample_ir());   // no opts
    assert.equal(t.header_row_index, 1, 'one-cell title still skipped by the >=2-cell heuristic');
    assert.equal(t.headers[0], 'First Name');
  });
});

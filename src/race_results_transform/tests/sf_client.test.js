'use strict';
// list_race_results_files against a MOCK jsforce connection (no network): filters non-spreadsheet
// files, sorts newest-first, enriches Program + Owner, and builds the snake_case target name.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { list_race_results_files } = require('../sf/sf_client');

function make_mock_conn() {
  const search_records = [
    { Id: 'cv1', ContentDocumentId: 'cd1', Title: 'Spring Tri Results.xlsx', FileExtension: 'xlsx', FileType: 'EXCEL_X', CreatedDate: '2026-06-01T10:00:00Z', LastModifiedDate: '2026-06-02T18:00:00Z', CreatedById: 'u1' },
    { Id: 'cv2', ContentDocumentId: 'cd2', Title: 'Sprint.csv', FileExtension: 'csv', FileType: 'CSV', CreatedDate: '2026-06-01T09:00:00Z', LastModifiedDate: '2026-06-03T12:00:00Z', CreatedById: 'u2' },
    { Id: 'cv3', ContentDocumentId: 'cd3', Title: 'flyer.pdf', FileExtension: 'pdf', FileType: 'PDF', LastModifiedDate: '2026-06-04T12:00:00Z', CreatedById: 'u1' }
  ];
  return {
    async search() { return { searchRecords: search_records }; },
    query(soql) {
      return {
        async execute() {
          if (/ContentDocumentLink/.test(soql)) {
            return { records: [
              { ContentDocumentId: 'cd1', LinkedEntityId: 'p1', LinkedEntity: { Type: 'Program', Name: 'Spring Triathlon' } },
              { ContentDocumentId: 'cd2', LinkedEntityId: 'p2', LinkedEntity: { Type: 'Program', Name: 'Summer Sprint' } }
            ] };
          }
          if (/FROM User/.test(soql)) {
            return { records: [
              { Id: 'u1', Name: 'Jane Coordinator', Email: 'jane@example.org' },
              { Id: 'u2', Name: 'Bob Owner', Email: 'bob@example.org' }
            ] };
          }
          return { records: [] };
        }
      };
    }
  };
}

describe('sf_client.list_race_results_files', () => {
  test('filters to spreadsheets, sorts newest-first, enriches program + owner + target_name', async () => {
    const out = await list_race_results_files(make_mock_conn(), { filter: { mode: 'all' } });

    assert.equal(out.length, 2, 'the .pdf is dropped');
    assert.equal(out[0].content_version_id, 'cv2', 'newest LastModifiedDate first');
    assert.equal(out[0].program_name, 'Summer Sprint');
    assert.equal(out[0].owner_name, 'Bob Owner');
    assert.equal(out[0].target_name, 'summer_sprint_bob_owner_sprint_cv2.csv');   // program_owner_title_id

    assert.equal(out[1].content_version_id, 'cv1');
    assert.equal(out[1].target_name, 'spring_triathlon_jane_coordinator_spring_tri_results_cv1.xlsx');
  });

  test('applies the MT date filter', async () => {
    // Only cv1 (modified 2026-06-02 18:00Z -> 2026-06-02 MT) matches this specific day.
    const out = await list_race_results_files(make_mock_conn(), {
      filter: { mode: 'specific', field: 'LastModifiedDate', date: '2026-06-02', tz: 'America/Denver' }
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].content_version_id, 'cv1');
  });
});

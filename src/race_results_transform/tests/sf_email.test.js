'use strict';
// list_email_queue_files against a MOCK jsforce connection (no network). Exercises the full chain
// (queue -> cases -> emails -> links -> versions), the open-only vs all status filter, sender, the
// subject-parsed sanction/program with placeholder fallback + optional Program enrichment, and dedupe.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { list_email_queue_files, parse_subject } = require('../sf/sf_email');

const QUEUE = { Id: '00GQ000000QUEUE', Name: 'Rankings', DeveloperName: 'cfg_Rankings' };
const CASES = [
  { Id: 'c1', CaseNumber: '0001', Subject: 'Bare Hill', Status: 'New', IsClosed: false, CreatedDate: '2026-06-01T10:00:00Z', LastModifiedDate: '2026-06-12T02:00:00Z' },
  { Id: 'c2', CaseNumber: '0002', Subject: 'Old race', Status: 'Closed', IsClosed: true, CreatedDate: '2026-06-02T10:00:00Z', LastModifiedDate: '2026-06-05T02:00:00Z' },
  { Id: 'c3', CaseNumber: '0003', Subject: 'Meek', Status: 'Waiting For USAT', IsClosed: false, CreatedDate: '2026-06-03T10:00:00Z', LastModifiedDate: '2026-06-10T02:00:00Z' }
];
const EMAILS = [
  { Id: 'e1', ParentId: 'c1', Subject: '[EXTERNAL] - Bare Hill TRI, AB, & DU (38730) - USAT Results Submission - 6/7/26', FromAddress: 'newenglandtiming@gmail.com', FromName: 'New England Timing', MessageDate: '2026-06-12T02:07:23Z', HasAttachment: true },
  { Id: 'e2', ParentId: 'c2', Subject: '[EXTERNAL] - Old race results', FromAddress: 'old@example.org', FromName: 'Old Timer', MessageDate: '2026-06-05T01:00:00Z', HasAttachment: true },
  { Id: 'e3', ParentId: 'c3', Subject: '[EXTERNAL] - Meek and Mighty Triathlon Results', FromAddress: 'race@example.org', FromName: '', MessageDate: '2026-06-10T01:00:00Z', HasAttachment: true }
];
const LINKS = [
  { ContentDocumentId: 'd1', LinkedEntityId: 'e1' },
  { ContentDocumentId: 'd2', LinkedEntityId: 'e2' },
  { ContentDocumentId: 'd3', LinkedEntityId: 'e3' }
];
const VERSIONS = [
  { Id: 'v1', ContentDocumentId: 'd1', Title: 'USAT Results - Bare Hill', FileExtension: 'xlsx', FileType: 'EXCEL_X', CreatedDate: '2026-06-12T02:07:00Z', LastModifiedDate: '2026-06-12T02:07:00Z' },
  { Id: 'v2', ContentDocumentId: 'd2', Title: 'old results', FileExtension: 'xls', FileType: 'EXCEL', CreatedDate: '2026-06-05T01:00:00Z', LastModifiedDate: '2026-06-05T01:00:00Z' },
  { Id: 'v3', ContentDocumentId: 'd3', Title: 'meek_mighty', FileExtension: 'csv', FileType: 'CSV', CreatedDate: '2026-06-10T01:00:00Z', LastModifiedDate: '2026-06-10T01:00:00Z' }
];
const PROGRAMS = [{ Id: 'p1', Name: 'Bare Hill Triathlon', cfg_Id__c: '38730' }];

// Realistic mock: honors the IsClosed clause and the inlined `IN ('id', ...)` lists.
function make_mock_conn(over) {
  over = over || {};
  function in_soql(soql, id) { return soql.indexOf("'" + id + "'") >= 0; }
  function result(soql) {
    if (/FROM Group/.test(soql)) return { records: [QUEUE] };
    if (/FROM Case/.test(soql)) {
      if (/IsClosed = false/.test(soql)) return { records: CASES.filter(function (c) { return !c.IsClosed; }) };
      if (/IsClosed = true/.test(soql)) return { records: CASES.filter(function (c) { return c.IsClosed; }) };
      return { records: CASES };
    }
    if (/FROM EmailMessage/.test(soql)) return { records: EMAILS.filter(function (e) { return in_soql(soql, e.ParentId); }) };
    if (/FROM ContentDocumentLink/.test(soql)) return { records: LINKS.filter(function (l) { return in_soql(soql, l.LinkedEntityId); }) };
    if (/FROM ContentVersion/.test(soql)) return { records: VERSIONS.filter(function (v) { return in_soql(soql, v.ContentDocumentId); }) };
    if (/FROM Program/.test(soql)) {
      if (over.program_throws) throw new Error('Program not queryable');
      return { records: PROGRAMS.filter(function (p) { return in_soql(soql, p.cfg_Id__c); }) };
    }
    return { records: [] };
  }
  return { query: function (soql) { return { async execute() { return result(soql); } }; } };
}

describe('sf_email.list_email_queue_files', () => {
  test('open-only: lists spreadsheet attachments newest-modified first, with sender + dates + enrichment', async () => {
    const out = await list_email_queue_files(make_mock_conn(), { filter: { mode: 'all' } });
    assert.equal(out.length, 2, 'two open cases with spreadsheet attachments (closed case excluded)');

    assert.equal(out[0].content_version_id, 'v1', 'newest LastModifiedDate first');
    assert.equal(out[0].status, 'New');
    assert.equal(out[0].is_closed, false);
    assert.equal(out[0].sender, 'New England Timing', 'FromName preferred');
    assert.equal(out[0].sanction_id, '38730', 'parsed from subject');
    assert.equal(out[0].program_name, 'Bare Hill Triathlon', 'upgraded to canonical Program name via lookup');
    assert.match(out[0].target_name, /^38730_bare_hill_triathlon_new_england_timing_/, 'filename leads with sanction');

    assert.equal(out[1].content_version_id, 'v3');
    assert.equal(out[1].sender, 'race@example.org', 'falls back to FromAddress when FromName is blank');
    assert.equal(out[1].sanction_id, '', 'no parens in subject -> placeholder');
    assert.equal(out[1].program_name, '', 'no program parsed -> placeholder');
  });

  test('status=all includes closed-case attachments', async () => {
    const out = await list_email_queue_files(make_mock_conn(), { filter: { mode: 'all' }, status: 'all' });
    assert.equal(out.length, 3, 'now includes the closed case file');
    assert.ok(out.some(function (r) { return r.is_closed === true && r.content_version_id === 'v2'; }), 'closed file present');
  });

  test('status=closed returns only IsClosed=true attachments; not_closed only IsClosed=false', async () => {
    const closed = await list_email_queue_files(make_mock_conn(), { filter: { mode: 'all' }, status: 'closed' });
    assert.equal(closed.length, 1, 'only the closed case file');
    assert.equal(closed[0].content_version_id, 'v2');
    assert.equal(closed[0].is_closed, true);
    const not_closed = await list_email_queue_files(make_mock_conn(), { filter: { mode: 'all' }, status: 'not_closed' });
    assert.equal(not_closed.length, 2, 'the two not-closed files');
    assert.ok(not_closed.every(function (r) { return r.is_closed === false; }));
  });

  test('program enrichment degrades to the parsed values when Program is not queryable', async () => {
    const out = await list_email_queue_files(make_mock_conn({ program_throws: true }), { filter: { mode: 'all' }, quiet: true });
    assert.equal(out[0].sanction_id, '38730', 'keeps the parsed sanction');
    assert.equal(out[0].program_name, 'Bare Hill TRI, AB, & DU', 'falls back to the subject-parsed program guess');
  });

  test('dedupes to one row per document', async () => {
    const conn = make_mock_conn();
    const base = conn.query;
    conn.query = function (soql) {
      if (/FROM ContentVersion/.test(soql)) {
        return { async execute() { return { records: [
          { Id: 'v1', ContentDocumentId: 'd1', Title: 'a', FileExtension: 'xlsx', LastModifiedDate: '2026-06-12T02:07:00Z' },
          { Id: 'v1b', ContentDocumentId: 'd1', Title: 'a', FileExtension: 'xlsx', LastModifiedDate: '2026-06-12T02:07:00Z' }
        ] }; } };
      }
      return base(soql);
    };
    const out = await list_email_queue_files(conn, { filter: { mode: 'all' } });
    assert.equal(out.filter(function (r) { return r.content_document_id === 'd1'; }).length, 1, 'one row for d1');
  });
});

describe('sf_email.parse_subject', () => {
  test('extracts a parenthesized sanction + the program text before it', () => {
    const p = parse_subject('[EXTERNAL] - Bare Hill TRI, AB, & DU (38730) - USAT Results Submission - 6/7/26');
    assert.equal(p.sanction, '38730');
    assert.equal(p.program, 'Bare Hill TRI, AB, & DU');
  });
  test('returns blanks when there is no parenthesized id (the common case)', () => {
    assert.deepEqual(parse_subject('[EXTERNAL] - Race Question'), { sanction: '', program: '' });
    assert.deepEqual(parse_subject(''), { sanction: '', program: '' });
  });
});

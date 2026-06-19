'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { get_thread, list_queue_cases, is_automated_sender } = require('../sf/sf_threads');

// Minimal mock matching jsforce's conn.query(soql).execute({...}) -> { records } shape that
// race_results_transform's run_soql consumes. Routes pick records by matching the SOQL text.
function mock_conn(routes) {
  return {
    query: function (soql) {
      return {
        execute: function () {
          for (let i = 0; i < routes.length; i++) {
            if (routes[i].match.test(soql)) return Promise.resolve({ records: routes[i].records });
          }
          return Promise.resolve({ records: [] });
        }
      };
    }
  };
}

test('is_automated_sender flags Automated Process / System only', function () {
  assert.ok(is_automated_sender('Automated Process'));
  assert.ok(is_automated_sender('System'));
  assert.ok(!is_automated_sender('Carlie Coach'));
  assert.ok(!is_automated_sender(''));
});

test('list_queue_cases maps rows and requires queue_id', async function () {
  await assert.rejects(function () { return list_queue_cases(mock_conn([]), {}); });
  const conn = mock_conn([{ match: /FROM Case WHERE OwnerId/, records: [
    { Id: '500A', CaseNumber: '0001', Subject: 'Hi', Status: 'New', IsClosed: false, SuppliedEmail: 'a@b.com' }
  ] }]);
  const cases = await list_queue_cases(conn, { queue_id: '00GX' });
  assert.strictEqual(cases.length, 1);
  assert.strictEqual(cases[0].case_id, '500A');
  assert.strictEqual(cases[0].supplied_email, 'a@b.com');
});

test('get_thread orders, strips quotes, flags automated, and attaches files', async function () {
  const routes = [
    { match: /FROM EmailMessage WHERE ParentId/, records: [
      { Id: '02s1', ParentId: '500', Incoming: true,  MessageDate: '2026-06-01T10:00:00.000+0000', FromAddress: 'jo@x.com', CreatedBy: { Name: 'Automated Process' }, HasAttachment: false, TextBody: 'Hi, my question.\nOn Tue John wrote:\n> old' },
      { Id: '02s2', ParentId: '500', Incoming: false, MessageDate: '2026-06-02T10:00:00.000+0000', FromAddress: 'no@u.org', CreatedBy: { Name: 'Automated Process' }, HasAttachment: false, TextBody: 'Auto ack' },
      { Id: '02s3', ParentId: '500', Incoming: false, MessageDate: '2026-06-03T10:00:00.000+0000', FromAddress: 'ca@u.org', CreatedBy: { Name: 'Carlie Coach' }, HasAttachment: true, TextBody: 'Here is your answer.' }
    ] },
    { match: /FROM ContentDocumentLink/, records: [ { ContentDocumentId: '069A', LinkedEntityId: '02s3' } ] },
    { match: /FROM ContentVersion/, records: [ { Id: '068A', ContentDocumentId: '069A', Title: 'waiver', FileExtension: 'PDF', ContentSize: 1234 } ] }
  ];
  const thread = await get_thread(mock_conn(routes), '500');
  assert.strictEqual(thread.length, 3);
  assert.strictEqual(thread[0].text_new, 'Hi, my question.');          // quoted history stripped
  assert.strictEqual(thread[1].automated, true);                        // outbound + Automated Process
  assert.strictEqual(thread[2].automated, false);                       // outbound human
  assert.strictEqual(thread[2].attachments.length, 1);
  assert.strictEqual(thread[2].attachments[0].content_version_id, '068A');
  assert.strictEqual(thread[2].attachments[0].file_extension, 'pdf');
});

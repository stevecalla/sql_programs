'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const dossier = require('../store/merge_dossier');

// Fake DB stores so build() runs with no MySQL.
function fakeDeps() {
  return {
    queue: { get: async () => ({ id: 5, source_type: 'merge_id', source_key: 'M1', survivor_account: 'M', survivor_name: 'Adam Keep',
      loser_accounts: 'L1;L2', loser_count: 2, environment: 'Sandbox', org_id: '00Dxx', field_overrides: { PersonEmail: 'L1' } }) },
    snapshot: { list_for_entry: async () => [
      { role: 'survivor', account: 'M', contact: 'cM', fields: { Name: 'Adam Keep', PersonEmail: '', Phone: '111', attributes: { type: 'Account' } } },
      { role: 'loser', account: 'L1', contact: 'cL1', fields: { Name: 'Adam Lose', PersonEmail: 'l1@x.com', Phone: '222' } },
      { role: 'child', account: 'L1', child_object: 'Opportunity', child_type: 'child', fields: { object: 'Opportunity', id: '006A', parent_field: 'AccountId', parent_id: 'L1' } },
      { role: 'child', account: 'L1', child_object: 'ContentDocumentLink', child_type: 'child', fields: { object: 'ContentDocumentLink', id: '06Ac1', parent_field: 'LinkedEntityId', parent_id: 'L1', content_document_id: '069DOC1', share_type: 'V', visibility: 'AllUsers' } },
    ] },
    history: { list_for_entry: async () => [
      { result: 'simulated', mode: 'simulate', created_by: 'skip', reason: 'preview', created_at_mtn: '2026-07-15 09:00:00', diff: null },
      { result: 'done', mode: 'execute', created_by: 'skip', reason: 'merged 2', created_at_mtn: '2026-07-15 09:05:00', diff: { kind: 'drift', fields: [{ field: 'email', before: 'a', after: 'b' }] } },
      { result: 'restored', mode: 'execute', created_by: 'skip', reason: 'restored', created_at_mtn: '2026-07-15 10:00:00', diff: { kind: 'restore', reset: [{ field: 'PersonEmail', value: '' }], kept: ['Phone'] } },
    ] },
    post_snapshot: { get: async () => ({ survivor_account: 'M', fields: { Name: 'Adam Keep', PersonEmail: 'new@x.com', attributes: { type: 'Account' } }, sf_last_modified: '2026-07-15T15:05:00.000Z', created_at_mtn: '2026-07-15 09:05:30', created_at_utc: '2026-07-15 15:05:30' }) },
    baseline: { get: async () => ({ M: { Name: 'Adam Keep', PersonEmail: '' }, L1: { Name: 'Adam Lose', PersonEmail: 'l1@x.com' } }) },
    query: async () => [],
    when: new Date('2026-07-15T15:07:00Z'),
  };
}

test('build filename follows "YYYY-MM-DD HHMM — <survivor> — <ACTION>.xlsx" and is path-safe', () => {
  const f = dossier.build_filename('MERGE', 'Adam O:Brien/Keep', new Date('2026-07-15T15:07:00Z'));
  assert.match(f, /^\d{4}-\d{2}-\d{2} \d{4} — .+ — MERGE\.xlsx$/);
  assert.ok(!/[\\/:*?"<>|]/.test(f.replace('.xlsx', '')), 'no illegal filename chars');
});

test('scalar_fields drops nested objects (attributes) and keeps scalars', () => {
  const sc = dossier.scalar_fields({ Name: 'A', Phone: '1', attributes: { type: 'Account' }, nested: { x: 1 }, blank: null });
  assert.deepEqual(sc, { Name: 'A', Phone: '1', blank: '' });
});

test('build assembles a 5-tab workbook from the stores', async () => {
  const r = await dossier.build({ run_id: 'run-1', queue_id: 5, action: 'merge', actor: 'skip via svc@sf', result: 'done', reason: 'merged 2 record(s)' }, fakeDeps());
  assert.match(r.filename, / — MERGE\.xlsx$/);
  assert.equal(r.sheets.length, 8);
  assert.ok(Buffer.isBuffer(r.buffer) && r.buffer.length > 0);

  // Read the produced bytes back and check content landed on the right tabs.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Reference', 'Overrides & survivorship', 'Stage baseline', 'Pre-merge snapshot', 'Post-merge snapshot', 'Children re-parented', 'History & drift']);

  const post = wb.getWorksheet('Post-merge snapshot');
  const pkv = {};
  post.eachRow((row) => { pkv[row.getCell(1).value] = row.getCell(2).value; });
  assert.equal(pkv['SF LastModifiedDate at capture'], '2026-07-15T15:05:00.000Z');
  assert.equal(pkv['PersonEmail'], 'new@x.com', 'post-merge survivor field value present');

  // Stage baseline tab has the staged accounts
  const stage = wb.getWorksheet('Stage baseline');
  assert.equal(stage.getRow(1).getCell(1).value, 'Account Id');
  assert.ok(stage.rowCount >= 3, 'two staged accounts + header');

  // Reference tab carries the explainer + SQL referencing this queue_id (5)
  const ref = wb.getWorksheet('Reference');
  let sqlSeen = false;
  ref.eachRow((row) => { const q = String(row.getCell(3).value || ''); if (/salesforce_merge_postmerge_snapshot WHERE queue_id = 5/.test(q)) sqlSeen = true; });
  assert.ok(sqlSeen, 'Reference tab includes SQL scoped to this dossier’s queue_id');

  const summary = wb.getWorksheet('Summary');
  const kv = {};
  summary.eachRow((row, i) => { if (i > 1) kv[row.getCell(1).value] = row.getCell(2).value; });
  assert.equal(kv['Action'], 'MERGE');
  assert.equal(kv['Survivor Account Id'], 'M');
  assert.equal(kv['Performed by'], 'skip via svc@sf');

  const ov = wb.getWorksheet('Overrides & survivorship');
  assert.ok([...Array(ov.rowCount)].some((_, i) => String(ov.getRow(i + 1).getCell(1).value).includes('PersonEmail')), 'override field listed');

  const snap = wb.getWorksheet('Pre-merge snapshot');
  assert.equal(snap.getRow(1).getCell(1).value, 'Role');
  assert.equal(snap.getRow(2).getCell(1).value, 'survivor');

  const kids = wb.getWorksheet('Children re-parented');
  assert.equal(kids.getRow(2).getCell(1).value, 'Opportunity');
  assert.equal(kids.getRow(2).getCell(5).value, 'M', 're-parented to survivor');
  // the ContentDocumentLink child surfaces its ContentDocumentId + share settings
  let cdocSeen = false;
  kids.eachRow((row) => { if (row.getCell(1).value === 'ContentDocumentLink' && row.getCell(7).value === '069DOC1') cdocSeen = true; });
  assert.ok(cdocSeen, 'file-share row shows its ContentDocumentId');

  const hist = wb.getWorksheet('History & drift');
  assert.equal(hist.rowCount, 7, 'header + 3 history rows + blank + 2 SOQL footer rows');
  let fileSoql = false;
  hist.eachRow((row) => { if (/ContentDocumentLink WHERE LinkedEntityId/.test(String(row.getCell(6).value || ''))) fileSoql = true; });
  assert.ok(fileSoql, 'History tab footer includes the SOQL to fetch this file');
});

test('save_copy stores the blob + metadata; list_for_entry parses attached_to; get_blob returns bytes', async () => {
  const store = [];
  const query = async (sql, params) => {
    if (/^CREATE TABLE/i.test(sql)) return {};
    if (/^INSERT/i.test(sql)) { store.push(params); return { insertId: store.length }; }
    if (/WHERE queue_id/i.test(sql)) return [{ id: 1, action: 'MERGE', filename: 'f.xlsx', attached_to: JSON.stringify(['001A', '001B']), byte_size: 3 }];
    if (/WHERE id/i.test(sql)) return [{ id: 1, filename: 'f.xlsx', byte_size: 3, workbook: Buffer.from('xyz') }];
    return [];
  };
  const r = await dossier.save_copy({ run_id: 'run-1', queue_id: 5, action: 'merge', survivor_account: 'M', filename: 'f.xlsx', content_document_id: '069', attached_to: ['001A', '001B'], buffer: Buffer.from('xyz') }, query);
  assert.equal(r.id, 1);
  assert.equal(store[0][2], 'MERGE', 'action upper-cased');
  assert.equal(store[0][8], 3, 'byte_size = buffer length');

  const list = await dossier.list_for_entry(5, query);
  assert.deepEqual(list[0].attached_to, ['001A', '001B']);

  const blob = await dossier.get_blob(1, query);
  assert.ok(Buffer.isBuffer(blob.buffer) && blob.buffer.toString() === 'xyz');
});

test('build tolerates a set with no snapshot/history (placeholder rows, still 5 tabs)', async () => {
  const deps = { queue: { get: async () => null }, snapshot: { list_for_entry: async () => [] },
    history: { list_for_entry: async () => [] }, post_snapshot: { get: async () => null }, query: async () => [], when: new Date('2026-07-15T15:07:00Z') };
  const r = await dossier.build({ run_id: 'r', queue_id: 9, action: 'RECREATE', survivor_name: 'X', survivor_account: 'S1', new_ids: { L1: 'NEW1' } }, deps);
  assert.equal(r.sheets.length, 8);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.buffer);
  assert.ok(wb.getWorksheet('Pre-merge snapshot').rowCount >= 2, 'placeholder row present');
  assert.ok(wb.getWorksheet('Post-merge snapshot').rowCount >= 1, 'post-merge tab present even with no snapshot');
});

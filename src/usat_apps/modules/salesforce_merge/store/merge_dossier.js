'use strict';
// Merge dossier — a multi-tab Excel workbook that records everything about a lifecycle action
// (MERGE / RESTORE / RECREATE) on a merge set: a summary, the survivorship overrides, the full
// pre-merge snapshot of every record, the children that were re-parented, and the history/drift
// audit trail. Built entirely from data the tool already persists (queue + pre-merge snapshot +
// history), so it is a faithful, self-contained record that can be attached to Salesforce and/or
// kept in the DB.
//
// Two responsibilities live here:
//   1. build(opts, deps) -> { filename, buffer, sheets } — assemble the .xlsx (pure-ish; reads the
//      DB stores through injectable deps so it is testable with fakes).
//   2. the `salesforce_merge_dossier` table (LONGBLOB copy) — save/get/list, keyed by run + queue +
//      action, so the History page can offer a download even if the Salesforce file is unreachable.
const ExcelJS = require('exceljs');
const { query: real_query } = require('../../../store/db');
const { now_mtn_utc } = require('./timestamps');

const queue = require('./merge_queue');
const snapshot = require('./merge_snapshot');
const history = require('./merge_history');
const post_snapshot = require('./merge_post_snapshot');
const stage_baseline = require('./merge_stage_baseline');

const TABLE = 'salesforce_merge_dossier';
const PURPOSE = 'Merge dossier archive: a multi-tab Excel workbook (summary / overrides / pre-merge '
  + 'snapshot / children / history+drift) built for each lifecycle action (MERGE/RESTORE/RECREATE) and '
  + 'attached to the affected Salesforce records. This is the DB copy (LONGBLOB) so it can be re-downloaded.';

const DDL = 'CREATE TABLE IF NOT EXISTS `' + TABLE + '` (' +
  ' id INT AUTO_INCREMENT PRIMARY KEY,' +
  " purpose VARCHAR(400) NOT NULL DEFAULT '" + PURPOSE.replace(/'/g, "''") + "'," +
  ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  ' run_id VARCHAR(64) NOT NULL,' +
  ' queue_id INT,' +
  ' action VARCHAR(16) NOT NULL,' +               // MERGE | RESTORE | RECREATE
  ' survivor_account VARCHAR(32),' +
  ' survivor_name VARCHAR(255),' +
  ' filename VARCHAR(255) NOT NULL,' +
  ' content_document_id VARCHAR(32),' +           // Salesforce ContentDocumentId (if attached)
  ' attached_to TEXT,' +                          // JSON array of record ids the SF file is linked to
  ' byte_size INT,' +
  ' workbook LONGBLOB,' +                         // the .xlsx bytes (the re-downloadable copy)
  ' created_at_mtn DATETIME NULL,' +
  ' created_at_utc DATETIME NULL' +
  ')';

let _ensured = false;
async function ensure_table(query = real_query) {
  if (_ensured) return;
  await query(DDL, []);
  _ensured = true;
}

// ---- filename (option 5): "YYYY-MM-DD HHMM — <survivor> — <ACTION>.xlsx" ------------------------
// Colons are illegal in filenames, so the time is HHMM with no separator. The survivor name is
// sanitised to keep the file portable across Windows/macOS/Linux + Salesforce.
function safe_name_part(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'unknown';
}
function build_filename(action, survivorName, when) {
  const ts = now_mtn_utc(when);              // { mtn: 'YYYY-MM-DD HH:mm:ss' }
  const [date, time] = ts.mtn.split(' ');
  const hhmm = (time || '00:00:00').slice(0, 5).replace(':', '');
  return date + ' ' + hhmm + ' — ' + safe_name_part(survivorName) + ' — ' + String(action).toUpperCase() + '.xlsx';
}

// A scalar-only view of a snapshot record's fields (drops nested objects like `attributes`), so the
// snapshot tab is a readable grid rather than a wall of JSON.
function scalar_fields(fields) {
  const out = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'attributes') continue;
    if (v == null) { out[k] = ''; continue; }
    if (typeof v === 'object') continue;
    out[k] = v;
  }
  return out;
}

function style_header(row) {
  row.font = { bold: true };
  row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });
}

// ---- build the workbook ------------------------------------------------------------------------
// opts: { run_id, queue_id, action, actor, environment, org_id, result, reason, survivor_account,
//         survivor_name, loser_accounts, loser_count, new_ids?, attached_to? }
// deps: { queue, snapshot, history, query, when }
async function build(opts = {}, deps = {}) {
  const Q = deps.queue || queue;
  const SN = deps.snapshot || snapshot;
  const H = deps.history || history;
  const PS = deps.post_snapshot || post_snapshot;
  const BASE = deps.baseline || stage_baseline;
  const query = deps.query || real_query;
  const when = deps.when || new Date();
  const action = String(opts.action || 'MERGE').toUpperCase();

  const entry = opts.queue_id != null ? await Q.get(opts.queue_id, query).catch(() => null) : null;
  const snapRows = opts.queue_id != null ? await SN.list_for_entry(opts.queue_id, query).catch(() => []) : [];
  const histRows = opts.queue_id != null ? await H.list_for_entry(opts.queue_id, query).catch(() => []) : [];
  // Post-merge snapshot (survivor values + SF LastModifiedDate captured right after the merge). Present
  // for merges (just saved) and for restore/recreate (the one from the original merge). null if never captured.
  const psnap = opts.queue_id != null ? await PS.get(opts.queue_id, query).catch(() => null) : null;
  // Stage-time baseline ({ accountId: fields } as reviewed when the set was queued — the drift baseline).
  // null for bulk-added sets that skipped baseline capture.
  const stageMap = opts.queue_id != null ? await BASE.get(opts.queue_id, query).catch(() => null) : null;

  const survivorAccount = opts.survivor_account || (entry && entry.survivor_account) || '';
  const survivorName = opts.survivor_name || (entry && entry.survivor_name) || '';
  const overrides = (entry && entry.field_overrides) || {};
  const ts = now_mtn_utc(when);
  const filename = build_filename(action, survivorName, when);   // deterministic — also used in the Reference SOQL

  const wb = new ExcelJS.Workbook();
  wb.creator = 'USAT Salesforce Merge Tool';
  wb.created = when;

  // --- Tab 1: Summary ---------------------------------------------------------------------------
  const s1 = wb.addWorksheet('Summary');
  s1.columns = [{ header: 'Field', key: 'k', width: 26 }, { header: 'Value', key: 'v', width: 70 }];
  style_header(s1.getRow(1));
  const losers = opts.loser_accounts != null ? String(opts.loser_accounts) : (entry ? String(entry.loser_accounts || '') : '');
  const summary = [
    ['Action', action],
    ['Result', opts.result || ''],
    ['Survivor name', survivorName],
    ['Survivor Account Id', survivorAccount],
    ['Loser account(s)', losers],
    ['Loser count', opts.loser_count != null ? opts.loser_count : (entry ? entry.loser_count : '')],
    ['New account id(s) (recreate)', opts.new_ids ? Object.entries(opts.new_ids).map(([o, n]) => o + ' → ' + n).join(', ') : ''],
    ['Run Id', opts.run_id || ''],
    ['Queue Id', opts.queue_id != null ? opts.queue_id : ''],
    ['Source', (entry ? (entry.source_type + ' / ' + entry.source_key) : '')],
    ['Environment', opts.environment || (entry && entry.environment) || ''],
    ['Org Id', opts.org_id || (entry && entry.org_id) || ''],
    ['Performed by', opts.actor || ''],
    ['Reason', opts.reason || ''],
    ['Generated (Denver)', ts.mtn],
    ['Generated (UTC)', ts.utc],
  ];
  for (const [k, v] of summary) s1.addRow({ k, v: v == null ? '' : v });

  // --- Tab 1b: Reference (what each tab means + the SQL to pull the same data) -------------------
  const qid = opts.queue_id != null ? opts.queue_id : '<queue_id>';
  const rid = opts.run_id || '<run_id>';
  const surv = survivorAccount || '<survivor_id>';
  const ref = wb.addWorksheet('Reference');
  ref.columns = [{ header: 'Tab / item', key: 't', width: 26 }, { header: 'What it shows', key: 'w', width: 58 }, { header: 'SQL to see the same data (MySQL, unless noted)', key: 'q', width: 74 }];
  style_header(ref.getRow(1));
  const REF_ROWS = [
    ['About this file', 'A point-in-time record of one lifecycle action (MERGE / RESTORE / RECREATE) on a merge set, built by the tool and attached to the affected Salesforce record(s) as a File. A copy is kept in MySQL (table salesforce_merge_dossier) and linked on the History row.', "SELECT id, action, filename, content_document_id, byte_size, created_at_mtn FROM salesforce_merge_dossier WHERE queue_id = " + qid + ";"],
    ['Three reference points', 'The tool captures the survivor/losers at three moments so any change can be attributed: STAGE (when queued) → PRE-MERGE (just before the merge) → POST-MERGE (right after). Drift = stage vs live-at-merge; “edited since merge” = post-merge vs now.', '(see the three snapshot rows below)'],
    ['Summary', 'The action, result, survivor + losers, run/queue ids, environment/org, who ran it, and when this file was generated.', "SELECT * FROM salesforce_merge_history WHERE queue_id = " + qid + " ORDER BY id;"],
    ['Overrides & survivorship', 'The field-level survivorship overrides chosen for this set (which account each field was taken from); blank = default (keep survivor, backfill blanks from losers).', "SELECT field_overrides FROM salesforce_merge_queue WHERE id = " + qid + ";"],
    ['Stage baseline', 'The account field values as the reviewer saw them WHEN THE SET WAS QUEUED — the baseline the merge drift check compares live values against. Empty for bulk-added sets.', "SELECT fields, created_at_mtn FROM salesforce_merge_stage_baseline WHERE queue_id = " + qid + ";"],
    ['Pre-merge snapshot', 'The FULL field values of every record in the set (survivor + losers + child records) captured right before the merge — the restore/recreate backup.', "SELECT role, account, child_object, fields FROM salesforce_merge_premerge_snapshot WHERE queue_id = " + qid + " ORDER BY id;"],
    ['Post-merge snapshot', 'The survivor’s field values + Salesforce LastModifiedDate captured right AFTER the merge — the baseline for “was the survivor edited in Salesforce since the merge?”.', "SELECT sf_last_modified, created_at_mtn, fields FROM salesforce_merge_postmerge_snapshot WHERE queue_id = " + qid + " ORDER BY id DESC LIMIT 1;"],
    ['Children re-parented', 'The child records that were moved from a loser to the survivor (object, id, parent field, from → to).', "SELECT child_object, fields FROM salesforce_merge_premerge_snapshot WHERE queue_id = " + qid + " AND role = 'child';"],
    ['History & drift', 'Every processed row for this set (simulate / done / restored / recreated / failed), the human reason, and the field-level diff (merge drift, or restore/recreate reset + kept).', "SELECT created_at_mtn, result, mode, reason, diff_json, dossier_id, dossier_doc_id FROM salesforce_merge_history WHERE queue_id = " + qid + " ORDER BY id;"],
    ['Lifecycle stamp (in Salesforce)', 'The usat_was_* marker written on the survivor by each action (flag on after MERGE / off after RESTORE|RECREATE; text “<ACTION> — <actor>”). These live in Salesforce, not MySQL.', "SOQL:  SELECT Id, usat_was_merged__c, usat_was_merged_date__c, usat_was_merged_by__c FROM Account WHERE Id = '" + surv + "'"],
    ['This file — in Salesforce (SOQL)', 'This dossier IS this file, attached as a Salesforce File (ContentVersion→ContentDocument→ContentDocumentLink). Find it by the record it is attached to, or by its exact name.', "SOQL by record:  SELECT ContentDocument.Title, ContentDocument.LatestPublishedVersionId, LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId = '" + surv + "'\nSOQL by name:    SELECT Id, Title, FileExtension, ContentSize, CreatedDate FROM ContentVersion WHERE Title = '" + filename + "' ORDER BY CreatedDate DESC"],
    ['This file — download bytes', 'Download the file itself: the VersionData field on the ContentVersion (base64) in Salesforce, OR the DB copy via the tool’s endpoint / the workbook LONGBLOB.', "Salesforce (SOQL):  SELECT VersionData FROM ContentVersion WHERE Id = '<ContentVersionId from above>'\nTool endpoint:      GET /api/salesforce-merge/merge/dossier/<dossier_id>/download\nMySQL copy:         SELECT filename, workbook FROM salesforce_merge_dossier WHERE queue_id = " + qid + ";"],
    ['This run', 'The whole run this action belonged to (progress, mode, counts).', "SELECT * FROM salesforce_merge_run WHERE run_id = '" + rid + "';"],
  ];
  for (const [t, w, q] of REF_ROWS) {
    const row = ref.addRow({ t, w, q });
    row.getCell(1).font = { bold: true };
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(3).font = { name: 'Consolas', size: 10 };
  }

  // --- Tab 2: Overrides & survivorship ----------------------------------------------------------
  const s2 = wb.addWorksheet('Overrides & survivorship');
  s2.columns = [{ header: 'Field', key: 'f', width: 34 }, { header: 'Survivorship choice', key: 'c', width: 46 }];
  style_header(s2.getRow(1));
  const ovKeys = Object.keys(overrides || {});
  if (!ovKeys.length) {
    s2.addRow({ f: '(no field overrides)', c: 'Default survivorship: keep the survivor’s value; backfill blanks from losers.' });
  } else {
    for (const f of ovKeys) s2.addRow({ f, c: 'Use value from account ' + overrides[f] });
  }

  // --- Tab 3-pre: Stage baseline (what the reviewer saw when the set was queued — drift baseline) --
  const priority = ['Name', 'FirstName', 'LastName', 'PersonEmail', 'Phone', 'PersonMobilePhone', 'BillingPostalCode', 'cfg_Member_Number__pc'];
  const sb = wb.addWorksheet('Stage baseline');
  const stageAccts = stageMap && typeof stageMap === 'object' ? Object.keys(stageMap) : [];
  const sbKeySet = new Set();
  for (const acct of stageAccts) for (const k of Object.keys(scalar_fields(stageMap[acct]))) sbKeySet.add(k);
  const sbKeys = [...priority.filter((k) => sbKeySet.has(k)), ...[...sbKeySet].filter((k) => !priority.includes(k)).sort()];
  sb.columns = [{ header: 'Account Id', key: 'acct', width: 20 }, { header: 'Role', key: 'role', width: 10 },
    ...sbKeys.map((k) => ({ header: k, key: 'f_' + k, width: 22 }))];
  style_header(sb.getRow(1));
  for (const acct of stageAccts) {
    const sc = scalar_fields(stageMap[acct]);
    const row = { acct, role: acct === survivorAccount ? 'survivor' : 'loser' };
    for (const k of sbKeys) row['f_' + k] = sc[k] != null ? String(sc[k]) : '';
    sb.addRow(row);
  }
  if (!stageAccts.length) sb.addRow({ acct: '(no stage baseline captured — e.g. a bulk-added set)' });

  // --- Tab 3: Pre-merge snapshot (account rows, wide) -------------------------------------------
  const s3 = wb.addWorksheet('Pre-merge snapshot');
  const acctRows = snapRows.filter((r) => r.role === 'survivor' || r.role === 'loser');
  const fieldKeySet = new Set();
  for (const r of acctRows) for (const k of Object.keys(scalar_fields(r.fields))) fieldKeySet.add(k);
  const fieldKeys = [...priority.filter((k) => fieldKeySet.has(k)), ...[...fieldKeySet].filter((k) => !priority.includes(k)).sort()];
  s3.columns = [{ header: 'Role', key: 'role', width: 10 }, { header: 'Account Id', key: 'acct', width: 20 },
    { header: 'Contact Id', key: 'contact', width: 20 }, ...fieldKeys.map((k) => ({ header: k, key: 'f_' + k, width: 22 }))];
  style_header(s3.getRow(1));
  for (const r of acctRows) {
    const sc = scalar_fields(r.fields);
    const row = { role: r.role, acct: r.account, contact: r.contact || '' };
    for (const k of fieldKeys) row['f_' + k] = sc[k] != null ? String(sc[k]) : '';
    s3.addRow(row);
  }
  if (!acctRows.length) s3.addRow({ role: '(no pre-merge snapshot found for this set)' });

  // --- Tab 3b: Post-merge snapshot (survivor state captured right after the merge) --------------
  const s3b = wb.addWorksheet('Post-merge snapshot');
  s3b.columns = [{ header: 'Field', key: 'f', width: 30 }, { header: 'Value', key: 'v', width: 70 }];
  style_header(s3b.getRow(1));
  if (psnap) {
    const head = [
      ['Captured (Denver)', psnap.created_at_mtn || ''],
      ['Captured (UTC)', psnap.created_at_utc || ''],
      ['SF LastModifiedDate at capture', psnap.sf_last_modified || ''],
      ['Purpose', 'Baseline for “edited in Salesforce since the merge” — restore compares the survivor’s current LastModifiedDate against the value above.'],
      ['', ''],
    ];
    for (const [k, v] of head) s3b.addRow({ f: k, v });
    const sub = s3b.addRow({ f: 'Survivor field', v: 'Value (post-merge)' });
    sub.font = { bold: true };
    const sc = scalar_fields(psnap.fields);
    const keys = [...priority.filter((k) => k in sc), ...Object.keys(sc).filter((k) => !priority.includes(k)).sort()];
    if (keys.length) for (const k of keys) s3b.addRow({ f: k, v: sc[k] != null ? String(sc[k]) : '' });
    else s3b.addRow({ f: '(no survivor fields recorded)', v: '' });
  } else {
    s3b.addRow({ f: '(no post-merge snapshot captured for this set)', v: 'Sets merged before this feature — or a merge whose post-capture was skipped — have no post-merge baseline.' });
  }

  // --- Tab 4: Children re-parented --------------------------------------------------------------
  const s4 = wb.addWorksheet('Children re-parented');
  s4.columns = [{ header: 'Child object', key: 'obj', width: 26 }, { header: 'Child record Id', key: 'cid', width: 20 },
    { header: 'Parent field', key: 'pf', width: 20 }, { header: 'Belonged to (pre-merge parent)', key: 'from', width: 26 },
    { header: 'Re-parented to (survivor)', key: 'to', width: 24 }, { header: 'Child type', key: 'ct', width: 16 },
    { header: 'File (ContentDocumentId)', key: 'cdoc', width: 22 }, { header: 'Share', key: 'share', width: 16 }];
  style_header(s4.getRow(1));
  const childRows = snapRows.filter((r) => r.role === 'child');
  for (const r of childRows) {
    const f = r.fields || {};
    const isShare = (r.child_object || f.object) === 'ContentDocumentLink';
    s4.addRow({ obj: r.child_object || f.object || '', cid: f.id || '', pf: f.parent_field || '',
      from: f.parent_id || r.account || '', to: survivorAccount, ct: r.child_type || 'child',
      cdoc: isShare ? (f.content_document_id || '(pre-capture — none)') : '',
      share: isShare ? [f.share_type, f.visibility].filter(Boolean).join(' / ') : '' });
  }
  if (!childRows.length) s4.addRow({ obj: '(no child records captured for this set)' });
  // File shares (ContentDocumentLink) can't be re-parented by update; on restore/recreate they're ADDITIVELY
  // re-linked to the loser (create on loser; survivor keeps its link). Rows with no ContentDocumentId predate that capture.
  if (childRows.some((r) => (r.child_object || (r.fields || {}).object) === 'ContentDocumentLink')) {
    const note = s4.addRow({ obj: 'ⓘ ContentDocumentLink = a Salesforce File share. On restore it is additively re-linked to the loser (created on the loser; the survivor keeps its link), never updated or removed.' });
    note.font = { italic: true, color: { argb: 'FF6B6B6B' } };
  }

  // --- Tab 5: History & drift -------------------------------------------------------------------
  const s5 = wb.addWorksheet('History & drift');
  s5.columns = [{ header: 'When (Denver)', key: 'w', width: 20 }, { header: 'Result', key: 'r', width: 12 },
    { header: 'Mode', key: 'm', width: 10 }, { header: 'By', key: 'b', width: 22 }, { header: 'Reason', key: 'reason', width: 60 },
    { header: 'Field-level diff', key: 'diff', width: 60 }];
  style_header(s5.getRow(1));
  for (const r of histRows) {
    let diffText = '';
    if (r.diff) {
      if (r.diff.kind === 'restore' || r.diff.kind === 'recreate') {
        const reset = (r.diff.reset || []).map((x) => x.field + '=' + x.value).join('; ');
        diffText = 'reset: ' + reset + (r.diff.kept && r.diff.kept.length ? ' | kept: ' + r.diff.kept.join(', ') : '');
      } else if (Array.isArray(r.diff.fields)) {
        diffText = r.diff.fields.map((x) => (x.field || x.name) + ': ' + (x.before ?? x.from) + ' → ' + (x.after ?? x.to)).join('; ');
      } else {
        try { diffText = JSON.stringify(r.diff); } catch (e) { diffText = ''; }
      }
    }
    s5.addRow({ w: r.created_at_mtn || r.created_at || '', r: r.result, m: r.mode || '', b: r.created_by || '', reason: r.reason || '', diff: diffText });
  }
  if (!histRows.length) s5.addRow({ w: '(no history rows yet for this set)' });
  // Footer: the SOQL to pull THIS dossier file back out of Salesforce (handy right where the audit lives).
  s5.addRow({});
  const f1 = s5.addRow({ w: '📎 Get this file (SOQL)', reason: 'By record: ', diff: "SELECT ContentDocumentId, ContentDocument.Title FROM ContentDocumentLink WHERE LinkedEntityId = '" + surv + "'" });
  const f2 = s5.addRow({ w: '', reason: 'By name: ', diff: "SELECT Id, Title, VersionData FROM ContentVersion WHERE Title = '" + filename + "'" });
  for (const fr of [f1, f2]) { fr.getCell('w').font = { bold: true }; fr.getCell('reason').font = { bold: true }; fr.getCell('diff').font = { name: 'Consolas', size: 10 }; fr.alignment = { vertical: 'top', wrapText: true }; }

  const buf = await wb.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return { filename, buffer, sheets: ['Summary', 'Reference', 'Overrides & survivorship', 'Stage baseline', 'Pre-merge snapshot', 'Post-merge snapshot', 'Children re-parented', 'History & drift'] };
}

// ---- DB copy -----------------------------------------------------------------------------------
async function save_copy(rec, query = real_query) {
  await ensure_table(query);
  const ts = now_mtn_utc();
  const attached = rec.attached_to ? JSON.stringify(rec.attached_to) : null;
  const res = await query(
    'INSERT INTO `' + TABLE + '` (run_id, queue_id, action, survivor_account, survivor_name, filename, ' +
    'content_document_id, attached_to, byte_size, workbook, created_at_mtn, created_at_utc) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [String(rec.run_id || ''), rec.queue_id != null ? Number(rec.queue_id) : null, String(rec.action || '').toUpperCase(),
     rec.survivor_account || null, rec.survivor_name || null, String(rec.filename || ''), rec.content_document_id || null,
     attached, rec.buffer ? rec.buffer.length : null, rec.buffer || null, ts.mtn, ts.utc]);
  return { id: (res && res.insertId) || null };
}

// Metadata (no blob) for the History page / listings.
async function list_for_entry(queueId, query = real_query) {
  await ensure_table(query);
  if (queueId == null) return [];
  const rows = await query('SELECT id, created_at, run_id, queue_id, action, survivor_account, survivor_name, filename, ' +
    'content_document_id, attached_to, byte_size, created_at_mtn, created_at_utc FROM `' + TABLE + '` WHERE queue_id = ? ORDER BY id DESC', [Number(queueId)]);
  return (rows || []).map((r) => ({ ...r, attached_to: (() => { try { return r.attached_to ? JSON.parse(r.attached_to) : []; } catch (e) { return []; } })() }));
}

// The .xlsx bytes for a stored dossier (download endpoint).
async function get_blob(id, query = real_query) {
  await ensure_table(query);
  const rows = await query('SELECT id, filename, byte_size, workbook FROM `' + TABLE + '` WHERE id = ?', [Number(id)]);
  const r = (rows || [])[0];
  if (!r) return null;
  return { id: r.id, filename: r.filename, byte_size: r.byte_size, buffer: r.workbook };
}

// ---- orchestrate: build -> attach to Salesforce -> save the DB copy ---------------------------
// One best-effort call used by merge_execute / merge_restore after a successful action. NEVER throws:
// any failure (build, attach, DB) is captured and returned so the lifecycle action is never undone by
// a dossier problem. Returns { filename, dossier_id, content_document_id, attached, links, errors }.
// opts adds: conn (open write connection), targets (record ids to link the file to), plus everything
// build() needs. deps: { write, queue, snapshot, history, query }.
async function generate(opts = {}, deps = {}) {
  const out = { generated: false, filename: null, dossier_id: null, content_document_id: null, attached: false, links: [], errors: [] };
  try {
    const built = await build(opts, deps);
    out.filename = built.filename;
    out.generated = true;
    const W = deps.write;
    const targets = [...new Set((opts.targets || []).filter(Boolean))];
    let attach = { attached: false, content_document_id: null, links: [] };
    if (opts.conn && W && typeof W.attach_file === 'function' && targets.length) {
      // One shared file, viewer-linked to every target (survivor + any restore/recreate records). We do
      // NOT publish via FirstPublishLocationId: that made the dossier a ContentVersion "child" of the
      // account (insert-only field) which a later restore then failed to re-point. The record's "Files"
      // count badge is a known Salesforce cosmetic lag for API-linked files; the file itself is attached.
      attach = await W.attach_file(opts.conn, built.filename, built.buffer, targets);
      out.attached = attach.attached;
      out.content_document_id = attach.content_document_id;
      out.links = attach.links;
      if (attach.errors && attach.errors.length) out.errors.push(...attach.errors);
    }
    try {
      const saved = await save_copy({
        run_id: opts.run_id, queue_id: opts.queue_id, action: opts.action,
        survivor_account: opts.survivor_account, survivor_name: opts.survivor_name,
        filename: built.filename, content_document_id: attach.content_document_id,
        attached_to: (attach.links || []).filter((l) => l.success).map((l) => l.id),
        buffer: built.buffer,
      }, deps.query);
      out.dossier_id = saved.id;
    } catch (dberr) { out.errors.push('db copy: ' + ((dberr && dberr.message) || dberr)); }
    return out;
  } catch (e) { out.errors.push((e && e.message) || String(e)); return out; }
}

// Should a dossier be attached for this run? Master env switch (MERGE_ATTACH_DOSSIER=false disables
// globally) AND the per-run toggle (opts.attach_dossier, default on). Default = attach.
function attach_enabled(opts = {}) {
  if (process.env.MERGE_ATTACH_DOSSIER === 'false') return false;
  return opts.attach_dossier !== false;
}

module.exports = { build, generate, attach_enabled, build_filename, safe_name_part, scalar_fields, save_copy, list_for_entry, get_blob, ensure_table, TABLE, DDL };

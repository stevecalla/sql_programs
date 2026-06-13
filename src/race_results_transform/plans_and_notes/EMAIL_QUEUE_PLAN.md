# Plan — Get Race Results from the SF **Email Queue**

Living plan + progress tracker for the second Salesforce intake. The existing intake is being renamed
**"Get Race Results from SF Upload Queue"**; this adds **"Get Race Results from SF Email Queue"** —
pulling spreadsheet attachments off **open cases in the Rankings queue** (Email-to-Case) and running
them through the SAME convert → review → download pipeline.

Status legend: ⬜ not started · 🟡 in progress · ✅ done.

---

## Progress tracker

- ✅ **Phase 1** — Engine (`sf/sf_email.js`) + config + unit tests — *done; `tests/sf_email.test.js` 6/6 green*
- ✅ **Phase 2** — Server route + CLI + menu — *done; `/api/sf/email-files`, `sf:list-email`/`sf:pull-email`, menu 44/45*
- ✅ **Phase 3** — Browser UI (toggle + email controls + columns) — *done; source toggle, `sf_columns()` per-source, status filter, shared Files queue*
- ✅ **Phase 4** — Tests + docs + polish — *done; `sf_ui.test.js` email block, CLAUDE/README, this plan*

> All phases executed in one pass (per request). The user-requested hard-stop after Phase 2 was skipped on instruction.
> **Verify on a real checkout:** `node --test tests/*.test.js` (the sandbox's file mirror was stale during the build,
> so the agent could not run the app.js/sf_email-dependent suites locally — engine + lint passed before the lag set in).

---

## Decisions (locked)

| Topic | Decision |
|---|---|
| Source switch | Segmented **toggle** at the top of one "Get Race Results" card (Upload Queue / Email Queue), sharing login, folder, progress, Files queue, download. |
| Date filter | Filter on **`LastModifiedDate`** (default; On-field toggle can flip to Created). |
| Date columns | Show **both** `Opened` = **`Case.CreatedDate`** and `Modified` = **`Case.LastModifiedDate`** (matches the SF "Queue: Rankings" view + the filter). `EmailMessage.MessageDate` is also captured on the record if we later switch a column to it. |
| Default sort | **Modified, descending** (newest case-activity first). |
| Sender | Use **`EmailMessage.FromName \|\| FromAddress`** as a Sender column AND the filename "owner" slot. |
| Sanction / Program | **Best-effort, placeholder-first** — parse from the email **Subject** when present; `—` / blank most of the time. Optional `Program WHERE cfg_Id__c=<parsed>` enrichment only when an id is parsed. |
| List contents | Only Rankings cases that have an email with a **spreadsheet attachment** (`xls/xlsx/csv`). Naturally drops non-results chatter. |
| Status filter | 3-way, mapped straight to Case `IsClosed`: **Is Not Closed (default, `IsClosed=false`)** · **Is Closed (`IsClosed=true`)** · **All** (no filter). Values `not_closed`/`closed`/`all` (legacy `open`/`not_open` accepted). |
| Download default | Per-row download checkboxes auto-check **only not-closed** rows, regardless of the status filter. |
| Dedupe | Latest `ContentVersion` per `ContentDocument` (IsLatest); de-dup rows by document. |

**Email-Queue list columns:** `Opened · Modified · Status · Subject · Sender · Sanction · Program · File name · Type`
(sortable, horizontally scrollable + resizable; missing sanction/program rows highlighted).

---

## The working chain (verified in the Dev Console)

```
Group (Type='Queue', DeveloperName='cfg_Rankings')        → queue Id 00GaZ000001CqokUAC
  → Case  WHERE OwnerId = <queueId> [AND IsClosed = false]  (open Rankings cases)
    → EmailMessage WHERE ParentId IN (caseIds) AND HasAttachment = true
      → ContentDocumentLink WHERE LinkedEntityId IN (emailIds)     (attachment doc ids)
        → ContentVersion WHERE ContentDocumentId IN (...) AND IsLatest = true
                           AND FileExtension IN ('xls','xlsx','csv')
          → download ContentVersion.VersionData  (reuses sf_fetch.fetch_content_version_bytes)
```

Reference SOQL (kept for `EMAIL_QUEUE_NOTES.md`):

```sql
-- 1. queue id
SELECT Id, Name, DeveloperName, Type FROM Group
WHERE Type='Queue' AND (Name='Rankings' OR DeveloperName='cfg_Rankings');

-- 2. open cases in the queue
SELECT Id, CaseNumber, Subject, Status, IsClosed, OwnerId, CreatedDate, LastModifiedDate
FROM Case WHERE OwnerId = '00GaZ000001CqokUAC' AND IsClosed = false
ORDER BY LastModifiedDate DESC;

-- 3. emails with attachments on those cases
SELECT Id, ParentId, Subject, FromAddress, FromName, MessageDate, HasAttachment
FROM EmailMessage WHERE ParentId IN (<caseIds>) AND HasAttachment = true ORDER BY MessageDate DESC;

-- 3b. attachment document ids (canonical path; EmailMessage.ContentDocumentIds is a fallback)
SELECT ContentDocumentId, LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN (<emailIds>);

-- 4. the spreadsheet files
SELECT Id, ContentDocumentId, Title, FileExtension, FileType, ContentSize, CreatedDate, LastModifiedDate
FROM ContentVersion
WHERE IsLatest = true AND ContentDocumentId IN (<docIds>) AND FileExtension IN ('xls','xlsx','csv');
```

Worked example: Case `500aZ00000tfirtQAA` → EmailMessage `02saZ00000lC9iuQAC`
→ ContentDocument `069aZ00000mDk7pQAC` → ContentVersion `068aZ00000mdLTxQAM`
(`USAT Results - Bare Hill TRI, DU, AB - 6.7.26.xlsx`).

### Sanction / Program from the subject
- Example: `[EXTERNAL] - Bare Hill TRI, AB, & DU (38730) - USAT Results Submission - 6/7/26`.
- Sanction = number in parentheses (`38730`) via a configurable regex; Program = text before `(`.
- Usually NOT present → `—` placeholder, builder stays blank.
- Optional: when an id parses, `SELECT Name, cfg_Id__c FROM Program WHERE cfg_Id__c='38730' OR cfg_Legacy_Id__c='38730' OR cfg_Autonumber_ID__c='38730'` to upgrade to canonical name/sanction; no match → keep placeholder.

---

## Architecture

- **Engine — `sf/sf_email.js`** (keeps `sf_client.js` lean; shares the injected `conn` + `query_in_batches`
  + `make_date_filter`/`ymd_in_time_zone`/`datetime_in_time_zone` + `build_download_file_name`).
  `list_email_queue_files(conn, opts)` returns normalized records:
  `{ content_version_id, content_document_id, title, file_extension, file_type, case_id, case_number,
     status, is_closed, subject, sender, opened_utc/_mtn, modified_utc/_mtn, message_date_*, sanction_id,
     program_name, target_name }`.
- **Config — `sf/sf_config.js`**: `SF_RANKINGS_QUEUE` (default `cfg_Rankings`), optional `SF_EMAIL_SANCTION_RE`.
- **Naming — `sf/sf_naming.js`**: reuse `build_download_file_name(file, program_name, sender, sanction_id)`.
- **Server — `sf/sf_routes.js`**: `GET /api/sf/email-files` (same `mx_session` auth; params: date `mode/date/start/end/field`, `status=open|all`, `max`). Download reuses `GET /api/sf/file/:id`.
- **CLI — `src/cli.js`**: `sf:list-email` (+ `--test`, date flags, `--all` for closed) and `sf:pull-email`; menu entry.
- **Browser — `app.js` + `index.html` + `app.css`**: source toggle (`S.sf_source`) swaps controls + list endpoint; feeds the SAME Files queue + download (sanction → filename pre-fill, sender → owner).

### Reused vs new
- **Reused:** sign-in/login, folder picker, `fetch_content_version_bytes` download, progress/cancel,
  Files queue (convert/review/download/reload), CSV/XLSX + filename builder, row-delete, CSV-safe.
- **New:** `sf_email.js`, the queue/case/email/link/version chain, subject parsing + optional Program
  lookup, `/api/sf/email-files`, the toggle + email columns + status filter, CLI `sf:list-email`/`sf:pull-email`.

---

## Phases & checkpoints

### Phase 1 — Engine + config + unit tests
- `sf_config.js`: `SF_RANKINGS_QUEUE` + subject-regex.
- `sf_email.js`: `list_email_queue_files` (full chain, dedupe, subject parse, graceful Program lookup, sender).
- `sf/index.js`: export.
- `tests/sf_email.test.js` (mock `conn`): chain, parsing, no-match placeholder, dedupe, status filter.
- **Checkpoint:** `node --test tests/sf_email.test.js` green.

### Phase 2 — Server route + CLI + menu
- `sf_routes.js`: `GET /api/sf/email-files`.
- `cli.js`: `sf:list-email` / `sf:pull-email` (+ menu).
- **Checkpoint:** `node src/cli.js sf:list-email --test` lists real cases-with-attachments; columns + placeholders look right. **← stop for review.**

### Phase 3 — Browser UI
- `index.html`: rename card; segmented toggle; email control row (date picker + Open/All status + max/list/reset); email results table columns.
- `app.js`: `S.sf_source`, toggle swaps controls + endpoint, render email rows, default-select not-closed, feed shared Files queue + download.
- `app.css`: toggle + table.
- **Checkpoint:** in-browser toggle → list → select → download → converts like the upload path.

### Phase 4 — Tests + docs + polish
- Extend `sf_ui.test.js` (toggle, columns, status filter, source wiring); optional stubbed e2e.
- Docs: CLAUDE.md (rename + email section), README.md, `sf/EMAIL_QUEUE_NOTES.md`.
- Polish: missing-meta highlight, resizable table, more-available flag carry-over.
- **Checkpoint:** full unit suite green; docs current.

---

## Open items / risks
- `EmailMessage.ContentDocumentIds` vs `ContentDocumentLink` — using ContentDocumentLink as the canonical hop.
- Integration user must have Read on `Case`, `EmailMessage`, `Group` (likely yes — same user reads files today).
- MT date filtering done client-side (consistent with the upload path) after a bounded Case query.
- Program lookup degrades to blank on any error (same pattern as the upload-queue sanction lookup).

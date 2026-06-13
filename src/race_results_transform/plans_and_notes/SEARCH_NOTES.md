# Salesforce search — finding race-results files

Reference for **how the Salesforce intake finds race-results files**, the investigation behind it, and
the queries to reuse when tuning or debugging. The engine lives in `sf/sf_client.js`
(`list_race_results_files`); this doc explains the *why*.

---

## TL;DR

- Race-results files are Salesforce **Files** (`ContentVersion` rows, one per file version), attached to a
  **Program** (event) record via `ContentDocumentLink`.
- There is **no "document type / category" field** on the file. "Race Results Doc" is a **Title naming
  convention** (`Race Results Doc {N} - {YYYY-MM-DD}`), and the Description is freeform (e.g. `PER Race Results`).
- So we find files by **SOSL full-text search**, then filter to spreadsheet extensions — *not* a SOQL
  `WHERE Title LIKE ...` filter (see the visibility gotcha below).
- The pull can **broaden** the search term (CLI `--search`, the web **Broaden** checkbox, menu item "list
  recent"). Broad = OR of several terms; precise = just `Race Results Doc`.

---

## Why SOSL, not SOQL `LIKE` (the visibility gotcha)

A direct key lookup returns a file shared with you via its record link:

```sql
-- works: looks the file up by its ContentDocumentId
SELECT Id, Title, Description, TagCsv, TextPreview, ContentDocumentId
FROM ContentVersion
WHERE ContentDocumentId = '069aZ00000kxPr7QAE'
LIMIT 10
```

But a **broad SOQL scan** of `ContentVersion` (e.g. `WHERE Title LIKE '%Race%'`) returns **0 rows** for a
normal user, because SOQL only surfaces files you **own or have via a Library** — it does **not** traverse
files shared through a record attachment (`ContentDocumentLink`). Race-results files are attached to Program
records, so a SOQL filter can't see them. **SOSL search *can*** — which is why the engine uses
`conn.search('FIND {...} RETURNING ContentVersion(...)')`.

> Also note: `ContentVersion` is sharing-restricted, so the **integration user** sees files a personal
> Workbench login often can't. Run discovery as that user via `node src/cli.js sf:soql "..."`.

---

## Investigation queries (how we confirmed there's no category field)

**1. The file (ContentDocument) — format only, no business category:**
```sql
SELECT Id, Title, FileExtension, FileType, CreatedDate, LastModifiedDate, LatestPublishedVersionId, OwnerId
FROM ContentDocument
WHERE Id = '069aZ00000kxPr7QAE'
```

**2. The version (ContentVersion) — where "Race Results Doc" actually lives (Title/Description, not a tag/category):**
```sql
SELECT Id, Title, Description, TagCsv, TextPreview, ContentDocumentId
FROM ContentVersion
WHERE ContentDocumentId = '069aZ00000kxPr7QAE'
LIMIT 10
-- Example result: Title "Race Results Doc 1 - 2026-06-02", Description "PER Race Results", TagCsv empty
```

**3. List a `ContentVersion`'s fields (metadata — no record access needed; tick "Use Tooling API"):**
```sql
SELECT QualifiedApiName, Label, DataType
FROM FieldDefinition
WHERE EntityDefinition.QualifiedApiName = 'ContentVersion'
ORDER BY QualifiedApiName
-- 48 fields, all standard except one unrelated custom field (Guest_Record_fileupload__c); no RecordTypeId,
-- no "Document Type" picklist. So: no structured category -> the Title/text is the only signal.
```

---

## Production search (broadened, deduped, spreadsheet-only)

The broadened term OR's several phrases. Single-word `Results`/`Race` subsume the longer phrases, so this is
effectively "any file mentioning race or results" — wider recall, more noise (filtered to spreadsheets).

```sql
FIND {"Race Results Doc" OR "Race Results" OR Race OR Results}
IN ALL FIELDS
RETURNING ContentVersion(
  Id, ContentDocumentId, Title, FileExtension, FileType, CreatedDate, LastModifiedDate, OwnerId
  WHERE FileExtension IN ('xlsx','xls','csv')
  ORDER BY LastModifiedDate DESC
  LIMIT 200
)
```

Add **`AND IsLatest = true`** to collapse multiple versions of the same file down to the latest (one of the
two dedup guards — the engine also dedups by `ContentDocumentId` in code):

```sql
FIND {"Race Results Doc" OR "Race Results" OR Race OR Results}
IN ALL FIELDS
RETURNING ContentVersion(
  Id, ContentDocumentId, Title, FileExtension, FileType, CreatedDate, LastModifiedDate, OwnerId
  WHERE FileExtension IN ('xlsx','xls','csv') AND IsLatest = true
  ORDER BY LastModifiedDate DESC
  LIMIT 200
)
```

**No duplicates:** one SOSL returns each `ContentVersion` once even if it matches several OR terms (a file
matching both "Race Results" and "Race" is a single row), and `IsLatest = true` + the code-side
`ContentDocumentId` dedup remove version-level repeats.

---

## How it maps to the code

- `sf/sf_client.js` `list_race_results_files(conn, { search_terms, filter })` — builds the SOSL: **one** term
  stays unquoted (precise default), **multiple** terms are OR'd with multi-word phrases quoted; then filters to
  `xlsx/xls/csv` and dedups by `ContentDocumentId` (newest kept).
- **CLI:** `node src/cli.js sf:list --search "Race Results Doc,Race Results,Race,Results"` (omit `--search`
  for the precise default). Discovery: `sf:describe <Object>`, `sf:soql "<SELECT ...>"`.
- **Menu:** "Salesforce → list recent files" prompts environment (prod/`--test`) and **precise vs broad**.
- **Web:** the **Broaden** checkbox (`#sfBroaden`, default on) sends `search=...` to `/api/sf/files`.

## Tuning

- Precise (`Race Results Doc`) = cleanest, anchored to the Title convention; may miss oddly-named files
  (e.g. `America's Race - Leon's Triathlon ... _Age Group`).
- Broad = recovers those, but also pulls in unrelated spreadsheets mentioning race/results — you then
  deselect noise (the panel highlights when more files are available than selected).
- The term list is the only lever, since there's no category field. To narrow precisely you could anchor on
  the Title pattern (`Title LIKE 'Race Results Doc%'`) — but only via SOSL/integration-user access, per the
  visibility gotcha above.

# SQL backbone for the duplicate finder + tuning sweep — PLAN (not yet built)

Status: **planning only.** No code written yet. This captures the design so it can be
reviewed and approved before any work starts.

## Goal

Make a fresh MySQL table the single source the duplicate detection reads from, for
**both** the real finder (`step_1_find_duplicates.js`) and the tuning sweep
(`sweep_duplicates.js`). Salesforce is contacted only to populate the table; every
detection step after that reads from SQL.

The database is **disposable** — it is dropped and recreated on every run. That
removes a lot of complexity: no migrations, no upserts, no run history to reconcile,
no staleness between runs. Load fresh, detect, done.

## Guiding principles (carried over from the rest of this tool)

1. **Outputs stay byte-for-byte identical** to today's baseline (the exact, fuzzy,
   nickname, and consolidated CSVs). This is the regression guarantee the project has
   protected throughout. A diff harness proves it before we call it done.
2. **Matching logic stays in the existing tested pure modules** (`normalize.js`,
   `matcher.js`, `nicknames.js`). SQL takes over **storage, grouping, and candidate
   blocking** — not the Levenshtein scoring or the nickname dictionary, which have no
   native MySQL equivalent.
3. **Reuse the database already used throughout the codebase** (see Open Question #1)
   and its existing connection helper, rather than introducing a new one.

## One backbone for both; convert to SQL only where it makes sense

The SQL database is the backbone for **both** the real finder and the tuning sweep —
one fresh `salesforce_account_duplicate_snapshot` table, populated by a single
Salesforce pull, serves both. We do **not** rewrite everything in SQL; we move work to
SQL only where SQL is the right tool:

- **Goes into SQL** (set-oriented): storing the streamed records; the exact-rule
  `GROUP BY exact_duplicate_key HAVING COUNT(*) > 1`; the rule-block bucketing that
  produces fuzzy/nickname candidates; counting / filtering; later, enrichment joins to
  other `usat_sales_db` tables.
- **Stays in Node** (algorithmic, no SQL equivalent): Levenshtein scoring
  (`matcher.js`), the nickname dictionary (`nicknames.js`), and the UnionFind
  clustering (`grouping.js`). SQL hands these candidate blocks; they do the per-pair
  reasoning.

**Sequencing: start with the tuning sweep, then the real finder.** The sweep is
review-only (a mistake never corrupts the authoritative output CSVs), its existing
"snapshot → replay" model maps one-to-one onto "load the table once, query it many
times," and the current in-memory sweep engine stays as a built-in oracle to diff the
SQL path against. Once the pattern is proven there, the real finder moves onto the same
table, where the bar is byte-identical baseline outputs.

## The one design choice that keeps it safe

Compute the normalized keys in Node **at load time** (reusing `normalize.js`) and
store them as their own columns — do **not** rely on SQL's `UPPER()`/`TRIM()`/`LEFT()`
to reproduce the JavaScript normalization. If SQL did the normalizing, collation and
charset differences could group records differently than the JS does, and the outputs
would drift from the baseline. By precomputing the cleaned names, normalized
gender/birthdate, five-digit composite ZIP, and the composite keys with the same
helpers the current code already uses, a SQL `GROUP BY exact_duplicate_key` is
*guaranteed* to match the in-memory result. SQL only does set operations on keys the
JavaScript produced.

## Streaming load (no bulk-load pain)

Records are **streamed into SQL as they arrive from Salesforce** — never materialized
as one giant in-memory array or one huge file:

```
Salesforce Bulk API stream ──▶ per-record: compute normalized keys (normalize.js)
                              ──▶ buffer into a batch (e.g. ~2,000 rows)
                              ──▶ flush a single multi-row INSERT
                              ──▶ repeat until the stream ends
```

The Bulk API already hands records back as a stream (`record_stream.on('record', …)`),
so the loader rides on that: accumulate a batch, flush, clear, continue. This keeps
Node memory flat regardless of whether it is 5,000 or 700,000 records, and avoids a
single oversized load or any dependency on `LOAD DATA INFILE` / `local_infile`. Batch
size is a tunable constant. The load runs inside a transaction (or builds into a
staging table that is swapped in) so a failed/partial stream never leaves a
half-populated table.

## Architecture / data flow

```
Salesforce ──stream──▶  load into fresh table        ──▶  detection reads from SQL  ──▶  outputs
                        (drop & recreate; keys             ├─ exact:    SQL GROUP BY exact_duplicate_key HAVING COUNT(*)>1
                         precomputed in Node;              ├─ fuzzy:    SQL pulls rule_block_key blocks → Node scores pairs
                         streamed in batches)              └─ nickname / consolidated: same blocks → Node
```

The tuning sweep reuses the **same loaded table** — it runs many criteria over it
instead of one. So one Salesforce pull serves both the finder and a full sweep.

## Database design (names spelled out — no abbreviations)

Database: **`usat_sales_db`** — the local USAT MySQL database (host `127.0.0.1`) used
throughout the codebase. Reached through the existing helpers, not a new connection:
`create_local_db_connection(await local_usat_sales_db_config())` from
`utilities/` (the same path the sales / participation / marketo / google_cloud loaders
use). The database name is **not** hardcoded — it comes from the `LOCAL_USAT_SALES_DB`
environment variable, exactly like the rest of the codebase.

Primary table: **`salesforce_account_duplicate_snapshot`** — one row per fetched
Account. Columns (raw Salesforce fields first, then the precomputed detection
columns):

```text
salesforce_account_id              (primary key — the SF Id)
last_name
first_name
member_number
gender_identity
foundation_constituent
salesforce_merge_id
person_birthdate
billing_postal_code
person_mailing_postal_code
-- precomputed at load time via normalize.js --
clean_first_name
clean_last_name
gender_normalized
birthdate_normalized
composite_zip_five_digit
exact_duplicate_key                (last+first+gender+birthdate+composite-zip key)
rule_block_key                     (gender+birthdate+composite-zip blocking key)
loaded_at
```

Indexes on `exact_duplicate_key` and on `rule_block_key`. Key columns use a binary
collation so grouping is exact. Indexes are added **after** the streamed load
finishes (faster to load into an unindexed table, then index).

Phase 3 (in progress): a unified **run table** plus per-view **result tables**.

`salesforce_duplicate_detection_run` (the "logbook") — DONE. One row per run, written
by BOTH the finder and the sweep (`run_type` = `finder` | `snapshot`), carrying mode,
timestamps, record count, and the detection counts (null for a snapshot-only run).
`CREATE TABLE IF NOT EXISTS`, so it accumulates history. `write_run` / `read_latest_run`
in `src/database_results.js`; `status` reads it. This replaced the per-snapshot
`snapshot_meta` table — there is now one table describing every run.

Result tables (Option A) — DONE. One table per output view —
`salesforce_duplicate_exact_group`, `_fuzzy_pair`, `_fuzzy_group`, `_nickname_pair`,
`_nickname_group`, `_consolidated_cluster` — each mirroring its CSV (columns inferred
from the row keys, all TEXT). REFRESHED each finder run (drop + recreate; no history —
the run table holds that). An empty view drops its table and creates nothing.
`write_result_table` / `write_all_result_tables` in `src/database_results.js`. This is
the explicit, no-abbreviation form of the `Duplicate_Run__c` / `Duplicate_Result__c`
model sketched in `schema.md`. To maximize what lives in SQL, the finder also persists
two previously file-only review maps the same way: `salesforce_duplicate_zip_trim_mapping`
(raw→trimmed composite ZIP) and `salesforce_duplicate_nickname_fire_mapping` (which
nickname relationships fired). The **sweep `run`** logs a `run_type = 'sweep'` row to the
logbook too (baseline-profile counts), so every action is recorded.

## What changes in the real finder (`step_1_find_duplicates.js`)

A new stage slots in right after the Salesforce fetch: a `src/database_snapshot.js`
module that connects, drops + recreates `salesforce_account_duplicate_snapshot`, and
**streams** the incoming records in (computing keys per record via `normalize.js`).
Then detection sources from SQL:

- **Exact**: a SQL `GROUP BY exact_duplicate_key HAVING COUNT(*) > 1`, with the
  per-group member lists assembled from the grouped rows.
- **Fuzzy / nickname**: pull the candidate blocks (`rule_block_key` groups of size > 1)
  from the indexed table and stream each block into the **existing** scoring code.
- The output writers and the consolidated clustering are **unchanged**.

## What changes in the sweep (`sweep_duplicates.js`)

- `snapshot` = fetch + stream-load the table (instead of writing `snapshot.json`).
- `run` / `detail` / `diff` read from that table.
- Because the sweep varies criteria (ZIP-trim length, which rule fields are required),
  the per-profile keys can't be fully precomputed. The lean approach: keep the sweep's
  keying in the proven `src/sweep.js` engine and just swap its record source from JSON
  to a database read (the engine already rebuilds keys per profile). SQL still does the
  heavy lifting of holding and streaming the records.

## Phasing

```text
Phase 0  [DONE] Database scaffolding: src/database_snapshot.js (recreate table +
         stream batched INSERTs; keys precomputed via normalize.js for exact parity;
         injectable executor) + config constants (SNAPSHOT_TABLE_NAME,
         DB_INSERT_BATCH_SIZE) + tests/database_snapshot.test.js (10 tests, fake
         executor — no live MySQL). Does NOT yet touch step_1 or the sweep.
Phase 1  [DONE] TUNING SWEEP on SQL. `snapshot` streams the fetched records into the
         table (originally with a per-snapshot meta table, since SUPERSEDED in Phase 3
         by the unified run table); `run`/`detail`/`diff` read records back from the DB;
         `status` subcommand (menu item 17). The JSON snapshot is GONE — the database is
         the snapshot. The matching engine is unchanged; a load->read round-trip test
         proves DB-sourced records give identical counts.
Phase 2  [DONE, default ON] REAL FINDER sources records from the DB. step_1 (by default,
         ENABLE_SQL_BACKBONE=true; `--in-memory` bypasses) streams the fetched records into
         the snapshot table and reads them back in fetch order (load_sequence ordinal +
         ORDER BY), then runs the UNCHANGED detection off those records. Output is
         byte-identical to the in-memory path — a parity test
         (tests/sql_backbone_parity.test.js) proves the order-sensitive exact output
         (positional record_ids lists) survives the round-trip. Default is **ON**
         (the SQL backbone is the finder's normal path; menu items 7-10 stream into
         the snapshot table); pass `--in-memory` to bypass it. NOTE: this is the "DB as
         the record source" step. Pushing the exact
         GROUP BY itself into SQL (and fuzzy/nickname blocking) is a later optimization
         (Phase 2b) on top of this — not required for the finder to run on the backbone.
Phase 3  [DONE] Persist runs + results in the DB. (1) the unified run table
         `salesforce_duplicate_detection_run` (the "logbook") is written by BOTH the
         finder and the sweep — one row per run (run_type finder|snapshot), accumulating
         history; `status` reads it; the old snapshot_meta table is gone. (2) the six
         per-view result tables (exact_group / fuzzy_pair / fuzzy_group / nickname_pair /
         nickname_group / consolidated_cluster) are refreshed (drop+recreate) by the
         finder each run. (3) one Excel workbook (.xlsx, one tab per view) is written
         beside the CSVs via exceljs (config.ENABLE_EXCEL_OUTPUT).
```

## Verifying Phase 2b (the SQL exact rule) — Node → SQL → live

Phase 2b moves the exact-duplicate rule into SQL (`GROUP BY exact_duplicate_key
HAVING COUNT(*) > 1`) while keeping the final sort + row formatting in Node so the
output stays byte-identical. It was verified in three layers, from pure Node up to a
live run against MySQL:

**1. Node unit parity (no database).** `tests/exact_sql.test.js` runs the SQL path
(`detect_exact_duplicates_sql`) against a *fake executor* that simulates the GROUP BY
from the same records, and asserts the result deep-equals the in-memory `exact.js`
output — same groups, same positional `record_ids` / `member_numbers` lists, same sort
order — including the hard "full tie" case (two groups with identical count and display
names but different keys, where order must follow first appearance). This proves the
Node-side rebuild + sort matches the baseline independently of MySQL.

**2. The SQL it actually runs** (against `salesforce_account_duplicate_snapshot`):

```sql
SET SESSION group_concat_max_len = 67108864;

-- exact_groups_size (all distinct keys)
SELECT COUNT(DISTINCT exact_duplicate_key) AS n
FROM salesforce_account_duplicate_snapshot;

-- the duplicate groups: 2+ records, member IDs in fetch order,
-- groups ordered by first appearance
SELECT exact_duplicate_key,
       GROUP_CONCAT(salesforce_account_id ORDER BY load_sequence SEPARATOR ',') AS ids
FROM salesforce_account_duplicate_snapshot
GROUP BY exact_duplicate_key
HAVING COUNT(*) > 1
ORDER BY MIN(load_sequence);
```

Node then rebuilds each group from those IDs (via `record_lookup`) and applies the same
sort as `exact.js` — the sort stays in Node because JS `localeCompare` and MySQL
collation do not order identically.

**3. Live dual-run on real data.** Run the finder both ways on the deterministic
`--test` sample (same 5,000 ordered rows each run) and compare the run-summary counts:

```bash
node step_1_find_duplicates.js --test              # SQL backbone ON  -> GROUP BY
node step_1_find_duplicates.js --test --in-memory  # legacy in-memory Map
```

Observed (2026-06-12) — identical across every view:

| metric | SQL backbone | in-memory |
|---|---|---|
| Exact duplicate groups | 48 | 48 |
| Exact records excluded | 140 | 140 |
| Unique exact-check groups | 4,908 | 4,908 |
| Fuzzy pairs / groups | 5 / 5 | 5 / 5 |
| Nickname pairs / groups | 9 / 9 | 9 / 9 |
| Consolidated clusters | 62 | 62 |

Every number matches, confirming the SQL exact rule produces the same result as the
baseline on real data. You can also run the queries above directly in Workbench after a
backbone run (the snapshot table persists) and confirm the group count equals "Exact
duplicate groups found" in the run summary.

> Performance note: the streaming load is wrapped in a **single transaction** (DONE) —
> `recreate_table` runs first (DDL auto-commits), then `START TRANSACTION` → all batched
> inserts → `COMMIT`, then `add_indexes`. That collapses ~350 per-batch disk flushes into
> one commit (much faster) and makes the load atomic (a failure rolls back, no
> half-filled table). It needs a dedicated single connection (`open_local_connection`),
> since a transaction lives on one connection; `materialize_via_db` uses it.

## Risks and mitigations

- **Normalization parity** (the big one): mitigated by precomputing keys in Node and a
  regression diff of new vs. saved baseline outputs.
- **Partial/failed load**: stream inside a transaction or load into a staging table
  that is atomically swapped in, so detection never sees a half-loaded table.
- **Concurrency** (a manual run and the Slack `/scheduled` run both loading the same
  table): guard with the server's existing `isRunning` lock, and/or a per-run table
  name (Open Question #7).
- **Charset/collation**: `utf8mb4` with a binary collation on the key columns.
- **Standing rule**: tests, docs (`README_SQL.md` + README/CLAUDE/schema), and
  CLI/menu items move in lockstep with the code.

## Open questions (to settle before building)

1. **Which database?** RESOLVED — the local USAT database **`usat_sales_db`**
   (`127.0.0.1`), via `create_local_db_connection(await local_usat_sales_db_config())`.
   Name read from `LOCAL_USAT_SALES_DB`, not hardcoded. The snapshot table is dropped
   and recreated each run, so it never accumulates in that shared database.
2. **Schema/database name** for the snapshot — a dedicated schema that is dropped each
   run, or a table inside an existing schema (dropped/recreated each run)?
3. **Reset mechanism** — `DROP TABLE` + `CREATE`, `TRUNCATE`, or drop the whole schema
   each run? (You confirmed the data can be deleted/replaced each time.)
4. **Streaming batch size** — rows per multi-row INSERT (default ~2,000; tune for the
   connection).
5. **Keep the in-memory path as a fallback?** I'd keep an `--in-memory` flag through
   Phase 1 so we can diff SQL output against the current code as the regression check,
   then decide whether to retire it.
6. **Persist results in SQL too** (`duplicate_detection_run` / `_result`), or keep
   outputs as CSV only for now?
7. **Concurrency / table naming** — single shared table guarded by the run lock, or a
   per-run table/schema name to allow overlap?
8. **Do both run modes go through SQL**, or keep the 5,000-row `--test` sample
   in-memory and route only full/production through SQL?
9. **Sweep keying** — rebuild per-profile keys in SQL from stored atoms, or keep the
   keying in the Node sweep engine reading rows from SQL (my lean: the latter)?
10. **Test approach for the DB layer** — integration tests against a disposable local
    schema vs. mocking the pool. The pure modules stay unit-tested as they are.

## Not changing

The Salesforce query and read-only posture, the normalization/scoring/nickname logic,
the output CSV schemas, and the existing menu/Slack endpoints. SQL is added as the
record store + grouping engine; it does not rewrite the matching rules.

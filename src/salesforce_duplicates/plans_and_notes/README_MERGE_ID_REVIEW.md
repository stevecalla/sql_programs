# Merge ID Review — IMPLEMENTED

**Status:** Shipped. Review-only QA, runs every finder run (gated by
`ENABLE_MERGE_ID_REVIEW`, default on; needs `ENABLE_NICKNAME_MATCHING` for the
consolidated clusters).

## How it runs (shipped behavior)

- **Logic:** `src/merge_id_review.js` — pure builders (`build_merge_id_review_rows`,
  `count_account_buckets`, `count_duplicate_pairs`) plus a DB report path
  (`report_from_db`) behind an injectable executor. Account-row mapper
  `to_sf_merge_id_review_row` lives in `src/sf_rows.js`.
- **Every finder run** (`step_1`, after consolidation) produces, like the other views:
  a timestamped CSV (`account_merge_id_review.csv`, archived), the DB table
  `salesforce_duplicate_merge_id_review`, an Excel tab (`merge_id_review`), and an
  end-of-run summary (account buckets + duplicate pairs). Computed in-memory off the
  consolidated clusters + fetched records — no extra Salesforce query.
- **Review on demand:** menu item 11 ("Review merge ID results") →
  `node src/merge_id_review.js report` reads the latest run's tables back from the DB and
  prints the account buckets, the duplicate pairs, and a preview to the console.
- The SQL in this doc is the equivalent ad-hoc query you can run directly in SQL
  Workbench; the shipped feature computes the same numbers in Node and persists them.

## Goal

Every run, show which Salesforce accounts have been marked to merge (they have a
merge ID), and how that lines up with the duplicates our tool found.

## How the comparison works

Match accounts on their Salesforce Account ID and sort each into a bucket:

- **in_both** — Salesforce marked it *and* we found it.
- **sf_only** — Salesforce marked it, but we didn't flag it.
- **our duplicates, named by signal** — we flagged it, Salesforce hasn't yet. Instead of
  one catch-all "ours_only", we name *which* list found it: `exact_only`, `fuzzy_only`,
  `nickname_only`, or `multi_signal` when the cluster matched on more than one.

We use the **consolidated list** as our single source. Each account also keeps a
`which_list` column with the exact signal mix (e.g. `exact` or `exact,fuzzy`), so the
`multi_signal` rows still show their detail.

## Build plan (phased)

**Phase 1 — Store the merge ID with each account. ✅ ALREADY DONE.**
No new table and no schema change needed. The snapshot table
(`salesforce_account_duplicate_snapshot`) already has a `salesforce_merge_id` column
(populated from `usat_Salesforce_Merge_Id__pc`), sitting in the same row as each
account. So the merge ID is already stored next to the account — nothing to build here.

Example — the snapshot table already looks like this (merge ID in the same row):

```
account_id   first_name  last_name   salesforce_merge_id
001...AAA    John        Smith       MRG-1001
001...BBB    Jon         Smith       MRG-1001     <- shares MRG-1001 = SF says merge A+B
001...CCC    Mary        Jones       (blank)
001...DDD    Marie       Jones       (blank)
001...EEE    Bob         Lee         MRG-1002
```

**Phase 2 — Do the comparison.**
Take the two lists — accounts Salesforce marked (merge ID not blank) and accounts we
flagged as duplicates — and sort every account into the buckets above.

Example — using the rows above (we found two duplicate clusters: AAA+BBB by exact,
CCC+DDD by fuzzy):

- SF-flagged (merge ID not blank): AAA, BBB, EEE
- Ours (consolidated members): AAA, BBB, CCC, DDD

**Phase 3 — Save the result.**
Write it out the same way as our other outputs: a CSV file, a database table, and a
tab in the Excel workbook.

Example — the review output:

```
account_id   bucket        salesforce_merge_id   which_list
001...AAA    in_both       MRG-1001              exact
001...BBB    in_both       MRG-1001              exact
001...CCC    fuzzy_only    (blank)               fuzzy
001...DDD    fuzzy_only    (blank)               fuzzy
001...EEE    sf_only       MRG-1002              (none — not in our list)
```

**Phase 4 — Show the counts (two views).**
Add to the end-of-run summary, write a DB table, and add an Excel tab. There are two
counts, and we keep **both**:

- **accounts per bucket** — one row per account (with a grand total); and
- **duplicate pairs** — how many matched pairs our clusters contain, by signal (a pair
  is a match *between* two accounts, so this is a different number than the row count).

Example — the run summary:

```
Merge ID review — accounts:
  in_both    : 2
  fuzzy_only : 2
  sf_only    : 1
  TOTAL      : 5
Merge ID review — duplicate pairs:
  exact    : 1
  fuzzy    : 1
  nickname : 0
  total    : 2
```

**Phase 5 — Tests and docs.**
Add a test for the comparison and update the documentation.

Example — the test feeds a few accounts (like the Phase 1 table) and checks each lands
in the right bucket with the right `which_list`.

## SQL Workbench queries (Phase 3 & Phase 4)

These run against the tables the finder already writes — no build needed to test the
logic. Paste into SQL Workbench. Requires **MySQL 8.0+** (uses `JSON_TABLE`).

How it works: the snapshot has one row per account (`salesforce_account_id` +
`salesforce_merge_id`). The consolidated table has one row per cluster with the accounts
packed into `Record_Ids__c` (semicolon-delimited). We **explode** `Record_Ids__c` into
one row per account, then compare to the accounts that have a merge ID.

### Phase 3 — the per-account review

```sql
USE usat_sales_db;

-- =====================================================================
-- PHASE 3: one row per account, labeled with how SF and our tool compare
-- =====================================================================

-- STEP 1: "ours" = the accounts our tool flagged.
-- Our consolidated table stores a whole cluster on one row, with the account IDs
-- bunched together in Record_Ids__c like "001AAA;001BBB". JSON_TABLE splits that
-- list back into one row per account so we can compare account-by-account.
-- We also carry the cluster's signal flags (was it found by exact / fuzzy / nickname).
WITH ours AS (
  SELECT
    TRIM(jt.account_id)    AS account_id,   -- one account, pulled out of the list
    c.Has_Exact_Flag__c    AS has_exact,     -- did this cluster match on exact?
    c.Has_Fuzzy_Flag__c    AS has_fuzzy,     -- ...on fuzzy?
    c.Has_Nickname_Flag__c AS has_nick       -- ...on nickname?
  FROM salesforce_duplicate_consolidated_cluster c
  JOIN JSON_TABLE(
         CONCAT('["', REPLACE(c.Record_Ids__c, ';', '","'), '"]'),  -- list -> JSON array
         '$[*]' COLUMNS (account_id VARCHAR(20) PATH '$')             -- array -> rows
       ) jt ON TRUE
  WHERE c.Record_Ids__c IS NOT NULL AND c.Record_Ids__c <> ''
),

-- STEP 2: "sf" = the accounts Salesforce marked to merge (merge ID is filled in).
sf AS (
  SELECT salesforce_account_id AS account_id, salesforce_merge_id
  FROM salesforce_account_duplicate_snapshot
  WHERE salesforce_merge_id <> ''            -- only accounts that actually have a merge ID
),

-- STEP 3: build the labeled list, then number the rows.
review AS (
  -- 3a: start from OUR accounts and look for a matching SF merge ID.
  --   found a match  -> "in_both" (SF and we agree)
  --   no match       -> name it by WHICH list found it:
  --                     exact_only / fuzzy_only / nickname_only, or
  --                     multi_signal if the cluster matched on more than one.
  SELECT
    o.account_id,
    CASE
      WHEN s.account_id IS NOT NULL THEN 'in_both'
      -- count how many signals are "on", then name the bucket
      WHEN ( (LOWER(o.has_exact) IN ('true','1','yes','y'))
           + (LOWER(o.has_fuzzy) IN ('true','1','yes','y'))
           + (LOWER(o.has_nick ) IN ('true','1','yes','y')) ) > 1 THEN 'multi_signal'
      WHEN LOWER(o.has_exact) IN ('true','1','yes','y') THEN 'exact_only'
      WHEN LOWER(o.has_fuzzy) IN ('true','1','yes','y') THEN 'fuzzy_only'
      WHEN LOWER(o.has_nick ) IN ('true','1','yes','y') THEN 'nickname_only'
      ELSE 'ours_unknown'   -- in our list but no signal flag (shouldn't normally happen)
    END AS bucket,
    s.salesforce_merge_id,
    -- which_list = the exact signal mix (e.g. "exact" or "fuzzy,nickname")
    NULLIF(CONCAT_WS(',',
      CASE WHEN LOWER(o.has_exact) IN ('true','1','yes','y') THEN 'exact'    END,
      CASE WHEN LOWER(o.has_fuzzy) IN ('true','1','yes','y') THEN 'fuzzy'    END,
      CASE WHEN LOWER(o.has_nick ) IN ('true','1','yes','y') THEN 'nickname' END
    ), '') AS which_list
  FROM ours o
  LEFT JOIN sf s ON s.account_id = o.account_id
  WHERE o.account_id <> ''

  UNION ALL

  -- 3b: add the SF accounts we did NOT flag.
  --   "sf_only" (SF marked it to merge, but it's missing from our list)
  SELECT
    s.account_id,
    'sf_only'  AS bucket,
    s.salesforce_merge_id,
    NULL       AS which_list                  -- not in our list, so no signal
  FROM sf s
  LEFT JOIN ours o ON o.account_id = s.account_id
  WHERE o.account_id IS NULL                  -- keep only the ones with no match on our side
)

-- STEP 4: number every row (1, 2, 3, ...) so it's easy to reference.
SELECT
  ROW_NUMBER() OVER (ORDER BY bucket, account_id) AS row_num,  -- the row number
  account_id,
  bucket,
  salesforce_merge_id,
  which_list
FROM review
ORDER BY row_num;
```

### Phase 4a — account counts (one number per bucket, plus a grand total)

Same logic as Phase 3, rolled up. `WITH ROLLUP` adds the grand-total row at the bottom.
This counts **accounts** (rows):

```sql
USE usat_sales_db;

-- =====================================================================
-- PHASE 4a: how many ACCOUNTS in each bucket (+ a TOTAL row)
-- =====================================================================

-- Same building blocks as Phase 3:
--   ours = accounts we flagged (clusters split into one row per account),
--          carrying the signal flags so we can name the bucket.
WITH ours AS (
  SELECT DISTINCT
    TRIM(jt.account_id)    AS account_id,   -- DISTINCT so we count each account once
    c.Has_Exact_Flag__c    AS has_exact,
    c.Has_Fuzzy_Flag__c    AS has_fuzzy,
    c.Has_Nickname_Flag__c AS has_nick
  FROM salesforce_duplicate_consolidated_cluster c
  JOIN JSON_TABLE(
         CONCAT('["', REPLACE(c.Record_Ids__c, ';', '","'), '"]'),
         '$[*]' COLUMNS (account_id VARCHAR(20) PATH '$')
       ) jt ON TRUE
  WHERE c.Record_Ids__c IS NOT NULL AND c.Record_Ids__c <> ''
),
--   sf = accounts Salesforce marked to merge
sf AS (
  SELECT salesforce_account_id AS account_id
  FROM salesforce_account_duplicate_snapshot
  WHERE salesforce_merge_id <> ''
),
-- review = every account labeled with its bucket (same names as Phase 3)
review AS (
  SELECT
    o.account_id,
    CASE
      WHEN s.account_id IS NOT NULL THEN 'in_both'
      WHEN ( (LOWER(o.has_exact) IN ('true','1','yes','y'))
           + (LOWER(o.has_fuzzy) IN ('true','1','yes','y'))
           + (LOWER(o.has_nick ) IN ('true','1','yes','y')) ) > 1 THEN 'multi_signal'
      WHEN LOWER(o.has_exact) IN ('true','1','yes','y') THEN 'exact_only'
      WHEN LOWER(o.has_fuzzy) IN ('true','1','yes','y') THEN 'fuzzy_only'
      WHEN LOWER(o.has_nick ) IN ('true','1','yes','y') THEN 'nickname_only'
      ELSE 'ours_unknown'
    END AS bucket
  FROM ours o LEFT JOIN sf s ON s.account_id = o.account_id
  WHERE o.account_id <> ''
  UNION ALL
  SELECT s.account_id, 'sf_only'
  FROM sf s LEFT JOIN ours o ON o.account_id = s.account_id
  WHERE o.account_id IS NULL
)
-- count each bucket; WITH ROLLUP appends a grand-total row (bucket = NULL -> "TOTAL")
SELECT
  COALESCE(bucket, 'TOTAL')  AS bucket,
  FORMAT(COUNT(*), 0)        AS accounts
FROM review
GROUP BY bucket WITH ROLLUP
ORDER BY
  GROUPING(bucket),   -- the TOTAL row (grouping = 1) sorts to the bottom
  FIELD(bucket, 'in_both', 'exact_only', 'fuzzy_only', 'nickname_only',
               'multi_signal', 'ours_unknown', 'sf_only');
```

### Phase 4b — duplicate-pair counts (matched pairs, by signal)

Accounts are rows; a **duplicate pair** is a match *between* two accounts. Each
consolidated cluster already records how many matched pairs ("links") it holds, split by
signal — so we just add those up. (No `JSON_TABLE` needed here.)

```sql
USE usat_sales_db;

-- =====================================================================
-- PHASE 4b: how many duplicate PAIRS our clusters contain (by signal)
-- =====================================================================
SELECT
  FORMAT(COUNT(*), 0)                                       AS clusters,        -- our duplicate groups
  FORMAT(SUM(CAST(Exact_Link_Count__c    AS UNSIGNED)), 0) AS exact_pairs,
  FORMAT(SUM(CAST(Fuzzy_Link_Count__c    AS UNSIGNED)), 0) AS fuzzy_pairs,
  FORMAT(SUM(CAST(Nickname_Link_Count__c AS UNSIGNED)), 0) AS nickname_pairs,
  FORMAT(SUM(CAST(Match_Link_Count__c    AS UNSIGNED)), 0) AS total_pairs       -- all matched pairs
FROM salesforce_duplicate_consolidated_cluster
WHERE Record_Ids__c IS NOT NULL AND Record_Ids__c <> '';
```

**How to read the pair counts** (using a real example: clusters 10,623 /
exact 16,139 / fuzzy 333 / nickname 956 / total 17,398):

- `clusters` — how many duplicate groups we found.
- `total_pairs` — the matched *links* drawn between accounts (A matched to B). This is
  the real "how many duplicate pairs."
- `exact_pairs` / `fuzzy_pairs` / `nickname_pairs` — of those pairs, how many qualified
  through each method.
- **The three signals don't add up to the total on purpose.** A pair can qualify more
  than one way (e.g. both a fuzzy spelling match *and* a nickname match), so it's counted
  in two columns but only once in `total_pairs`. Here 16,139 + 333 + 956 = 17,428, which
  is 30 more than 17,398 → about 30 pairs matched in more than one way.
- **Sanity check.** When groups are built by chaining matched pairs, the link count comes
  out near *accounts-in-clusters − clusters*. With ~28,007 accounts in clusters:
  28,007 − 10,623 = 17,384, right where `total_pairs` (17,398) lands.
- **Note on the definition.** `total_pairs` counts the links the algorithm drew, not
  every possible pairing in a group. A group of 3 chained A–B–C is 2 links, even though
  there are 3 possible pairings. (If you'd rather count every possible pairing, that's a
  different "N-choose-2" number — ask and we'll switch it.)

### Notes before you run

- **Confirm the separator.** This assumes `Record_Ids__c` is semicolon-delimited
  (e.g. `001AAA;001BBB`). Eyeball a `SELECT Record_Ids__c FROM
  salesforce_duplicate_consolidated_cluster LIMIT 5;` and change `';'` in the `REPLACE`
  if it's different.
- **Confirm the flag values.** The `which_list` CASE treats `true/1/yes/y` as "on."
  Run `SELECT DISTINCT Has_Exact_Flag__c FROM salesforce_duplicate_consolidated_cluster;`
  and adjust the `IN (...)` list if the flags are stored differently.
- **No ID normalization needed here.** Both sides come from the same run, so the
  account IDs are already the same 18-char format.
- **Until merge IDs exist**, `sf` is empty, so there are no `in_both` or `sf_only` rows —
  every account lands in one of the signal buckets (`exact_only` / `fuzzy_only` /
  `nickname_only` / `multi_signal`). That's the expected "not entered yet" state.

## Good to know

- **Can ship now.** Until merge IDs exist in Salesforce, every account shows up in a
  signal bucket (`exact_only` / `fuzzy_only` / `nickname_only` / `multi_signal`) and
  `in_both` / `sf_only` are empty — harmless. Once your team starts entering merge IDs,
  `in_both` and `sf_only` fill in automatically, every run.
- **Keep the lists time-aligned.** Pull both sides from the same run so the account
  populations match.
- **Normalize IDs before matching** (15-char vs 18-char Salesforce IDs).

## Open decision

- **Which "our list"?** The single consolidated file (recommended — simplest), or all
  the duplicate files combined.

## Appendix — exploration queries (eyeball the tables)

Quick ad-hoc SELECTs for poking at the underlying tables in SQL Workbench (peek rows,
count totals, check which rows carry a merge ID, and read the review table the finder
writes). Read-only.

```sql
USE usat_sales_db;

-- Snapshot: every fetched account + its merge ID -----------------------------
SELECT * FROM salesforce_account_duplicate_snapshot LIMIT 10;
SELECT FORMAT(COUNT(*), 0) FROM salesforce_account_duplicate_snapshot LIMIT 10;

-- Accounts Salesforce has marked to merge (merge ID filled in)
SELECT * FROM salesforce_account_duplicate_snapshot WHERE salesforce_merge_id <> '';
SELECT COUNT(*) FROM salesforce_account_duplicate_snapshot WHERE salesforce_merge_id <> '';

-- Same name appearing under (possibly several) merge IDs
SELECT last_name, first_name, GROUP_CONCAT(salesforce_merge_id), COUNT(*)
FROM salesforce_account_duplicate_snapshot
WHERE salesforce_merge_id <> ''
GROUP BY 1, 2;

-- Exact-group result table: peek, count, and which groups carry a merge ID ----
SELECT * FROM salesforce_duplicate_exact_group LIMIT 10;
SELECT FORMAT(COUNT(*), 0) FROM salesforce_duplicate_exact_group LIMIT 10;
-- "carries a merge ID" = Merge_Ids__c isn't just blanks/semicolons
SELECT * FROM salesforce_duplicate_exact_group
WHERE Merge_ids__c IS NOT NULL AND TRIM(Merge_ids__c) <> '' AND REPLACE(TRIM(Merge_ids__c), ';', '') <> '';
SELECT COUNT(*) FROM salesforce_duplicate_exact_group
WHERE Merge_ids__c IS NOT NULL AND TRIM(Merge_ids__c) <> '' AND REPLACE(TRIM(Merge_ids__c), ';', '') <> '';

-- Consolidated cluster table: peek, count, and which clusters carry a merge ID
SELECT * FROM salesforce_duplicate_consolidated_cluster LIMIT 10;
SELECT FORMAT(COUNT(*), 0) FROM salesforce_duplicate_consolidated_cluster LIMIT 10;
SELECT * FROM salesforce_duplicate_consolidated_cluster
WHERE Merge_ids__c IS NOT NULL AND TRIM(Merge_ids__c) <> '' AND REPLACE(TRIM(Merge_ids__c), ';', '') <> '';
SELECT COUNT(*) FROM salesforce_duplicate_consolidated_cluster
WHERE Merge_ids__c IS NOT NULL AND TRIM(Merge_ids__c) <> '' AND REPLACE(TRIM(Merge_ids__c), ';', '') <> '';

-- Merge ID review table (what the finder writes; what menu item 11 reads back) -
SELECT * FROM salesforce_duplicate_merge_id_review LIMIT 10;
SELECT FORMAT(COUNT(*), 0) FROM salesforce_duplicate_merge_id_review LIMIT 10;
-- account counts per bucket (the persisted equivalent of Phase 4a)
SELECT Bucket__c, FORMAT(COUNT(*), 0) FROM salesforce_duplicate_merge_id_review GROUP BY 1;
```

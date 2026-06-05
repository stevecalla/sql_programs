# Salesforce Account Duplicate Detection

## Overview

This process connects to Salesforce from Node.js, pulls records from the `Account` object, and creates CSV files to help review potential duplicate member/person accounts.

The script is designed to mimic source-of-truth duplicate logic as closely as possible while working around Salesforce SOQL limitations.

The process creates three output files (the names below are simplified; the
actual files are written with a date/time stamp at the end, e.g.
`account_duplicates_sf_import_2026-06-04_14-30-05.csv`):

```text
account_duplicates_sf_import.csv
account_fuzzy_name_matches_sf_import.csv
account_fuzzy_name_groups_sf_import.csv
```

## Project Structure

```text
salesforce_duplicates/
  step_1_find_duplicates.js   orchestrator (exact + fuzzy pipeline + run summary)
  step_2_get_duplicate_report.js / step_2a_create_duplicate_message.js   server report + message
  report_service.js         server glue (slash-arg parsing + freshness/force logic; tested)
  config.js                 run-mode flag resolver, thresholds, output file + folder names
  menu.js                   interactive launcher (node menu.js)
  src/
    fmt.js                  duration + timestamp formatting (pure)
    log.js                  console logging + colors
    ids.js                  run id, hashing, external id (pure)
    normalize.js            field cleaning + key builders (pure)
    matcher.js              levenshtein, similarity, rule flags, reasons (pure)
    grouping.js             UnionFind + fuzzy group builder
    step_timer.js           per-step stopwatch: live [STEP] lines + end timeline
    exact.js                exact-duplicate detection
    fuzzy.js                fuzzy candidate filter + rule blocks + pairwise compare
    sf_rows.js              maps result rows to the Salesforce import schema
    output_files.js         CSV write + output/archive rotation
    salesforce.js           jsforce connect + Account query (--test=REST/ordered,
                            --prod=Bulk API/unordered)
  tests/                    node:test unit tests (normalize, matcher, grouping, ids,
                            sf_rows, exact, fuzzy, file output, step_2 report,
                            report_service, step_timer)
  README.md / CLAUDE.md / schema.md
```

`main()` in `step_1_find_duplicates.js` is now a thin orchestrator that calls
`detect_exact_duplicates` (exact.js) and `run_fuzzy_matching` (fuzzy.js).

See `CLAUDE.md` for a quick orientation map of the modules.

## Output Location and Archiving

Output is written to the cross-platform `/data` path resolved by
`utilities/determineOSPath.js` (not the code folder):

```text
usat_salesforce_duplicates/          most recent run's files
usat_salesforce_duplicates_archive/  previous run's files
```

On each run the tool clears the archive, moves the prior run's CSVs into it, then
writes the new timestamped files into `usat_salesforce_duplicates`.

## Output Files

### 1. `account_duplicates.csv`

This file contains exact duplicate groups.

Records are grouped together when all of the following fields match exactly:

```text
FirstName
LastName
Gender
Birthdate
Composite ZIP
```

One row in this file can represent multiple Salesforce Account records.

Example:

```text
John Smith | Male | 1980-01-01 | 80919 | duplicate_count = 3
```

That means three Account records share the exact same duplicate key.

### 2. `account_fuzzy_name_matches.csv`

This file contains pair-level fuzzy matches.

Each row compares two Salesforce Account records.

A pair is included when the records have:

```text
Similar first/last name
Same gender
Same birthdate
Same composite ZIP
Not already included in the exact duplicate file
Not exact same cleaned first and last name
```

This file is useful for understanding why two records were considered a fuzzy duplicate candidate.

### 3. `account_fuzzy_name_groups.csv`

This file groups connected fuzzy pairs together.

For example, if the pair file finds:

```text
Record A <-> Record B
Record B <-> Record C
```

The group file combines them into one group:

```text
Record A; Record B; Record C
```

This makes fuzzy output easier to review because it behaves more like the exact duplicate group file.

## Salesforce Object Used

The script queries the Salesforce `Account` object.

This assumes the Salesforce org stores member/person records on `Account`, such as with Person Accounts.

## Salesforce Fields Used

The script currently queries these fields:

```sql
Id,
LastName,
FirstName,
cfg_Member_Number__pc,
cfg_Gender_Identity__pc,
PersonBirthdate,
BillingPostalCode,
PersonMailingPostalCode
```

If any of these fields do not exist, or if your Salesforce user does not have access to them, the query will fail.

## SOQL Query

The script uses this Salesforce query:

```sql
SELECT Id,
    LastName,
    FirstName,
    cfg_Member_Number__pc,
    cfg_Gender_Identity__pc,
    PersonBirthdate,
    BillingPostalCode,
    PersonMailingPostalCode
FROM Account
WHERE FirstName != null
AND LastName != null
-- ORDER BY LastName, FirstName, Id   (added only for the --test pull)
```

**`ORDER BY` is applied to the `--test` pull only.** The duplicate detection never
needs sorted input — exact matching uses a hash Map, fuzzy matching uses rule-block
buckets, and all three output files are sorted in code afterward. So:

- **`--test`** uses the **ordered** query (`ACCOUNT_SOQL_ORDERED`). With
  `MAX_FETCH = 5000`, the script pulls the first 5,000 records ordered by
  `LastName, FirstName, Id` — a stable, deterministic sample (not random), so repeat
  test runs see the same rows.
- **`--prod`** uses the **unordered** query (`ACCOUNT_SOQL_BASE`). On the full
  ~700k-record extract, forcing Salesforce to sort the entire result set before
  sending it is the slowest part of the fetch; dropping `ORDER BY` lets Salesforce
  stream records as it finds them. Output ordering is unaffected (sorted in code).

## Fetch Method (REST vs. Bulk API)

The download method depends on the run mode (see `src/salesforce.js`):

```text
--test (dev sandbox)  REST autoFetch, capped at MAX_FETCH (5,000). Fast for a
                      small pull; Bulk's job-startup overhead would be slower here.
--prod (full run)     Bulk API query (conn.bulk2.query). Pulls the whole result
                      set in a few large transfers instead of REST paging 2,000 at
                      a time (~350 round-trips for ~700k records) — much faster.
```

Both paths return the same shape to the rest of the pipeline, so nothing
downstream changes. Bulk jobs run asynchronously server-side, so the poll timeout
is set generously (20 min) to allow a large extract to finish.

## Composite ZIP Logic

Salesforce has a formula field similar to:

```text
usat_Composite_zip__c
```

The logic appears to be:

```text
If BillingPostalCode is populated:
    use BillingPostalCode
else:
    use PersonMailingPostalCode
```

The script recreates that logic in Node.js:

```js
function compositeZip(row) {
    const billing = (row.BillingPostalCode || "").trim();
    const mailing = (row.PersonMailingPostalCode || "").trim();

    return billing !== "" ? billing : mailing;
}
```

This is done in Node.js because Salesforce formula fields may not be usable in SOQL `GROUP BY` queries.

## Exact Duplicate Logic

The exact duplicate logic builds a key using:

```text
LastName
FirstName
Gender
Birthdate
Composite ZIP
```

In code:

```js
function makeExactDuplicateKey(row) {
    return [
        norm(row.LastName),
        norm(row.FirstName),
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        norm(compositeZip(row)),
    ].join("|");
}
```

If more than one Account record has the same key, the group is written to:

```text
account_duplicates.csv
```

Important columns in the exact duplicate output include:

```text
row_number
duplicate_logic
LastName
FirstName
cfg_Gender_Identity__pc
PersonBirthdate
CompositeZip
duplicate_count
record_ids
member_numbers
```

## Fuzzy Match Logic

The fuzzy match logic is intentionally strict.

It does not simply compare everyone with a similar name. It only compares records that already match on the strongest rule-based identity fields.

A fuzzy match must meet all of these conditions:

```text
1. The records are not already in the exact duplicate output.
2. Gender matches.
3. Birthdate matches.
4. Composite ZIP matches.
5. First/last name similarity score is greater than or equal to the fuzzy threshold.
6. Cleaned first and last names are not both exact matches.
```

The difference between exact and fuzzy is:

```text
Exact duplicate:
    Exact name + same gender + same birthdate + same composite ZIP

Fuzzy duplicate:
    Similar name + same gender + same birthdate + same composite ZIP
```

So the fuzzy file is intended to catch records like:

```text
Alfred Aguado vs Alfredo Aguado
Hunteer Abissi vs Hunter Abissi
Sam Adams vs Sam Adams V
Martin Aguilera vs Martín Aguilera
```

These records match on gender, birthdate, and ZIP, but the name has a typo, suffix, spelling difference, or character variation.

## Name Cleaning

Before comparing names, the script normalizes them.

The cleaning process:

```text
1. Trim spaces
2. Convert to uppercase
3. Remove non-alphanumeric characters
```

In code:

```js
function cleanName(value) {
    return norm(value)
        .replace(/[^A-Z0-9]/g, "")
        .trim();
}
```

This helps compare names consistently.

Examples:

```text
Martin
MARTIN
Martin.
Martín
```

After cleaning, these become easier to compare.

## Fuzzy Scoring

The script uses a Levenshtein-distance similarity score.

Each fuzzy pair receives three scores:

```text
match_score_first_name
match_score_last_name
match_score_combined_name
```

The combined score is weighted:

```js
const combinedNameScore = Math.round(
    firstNameScore * 0.45 + lastNameScore * 0.55
);
```

This gives slightly more weight to last name than first name.

Current threshold:

```js
const FUZZY_THRESHOLD = 90;
```

That means a pair must have:

```text
combined name score >= 90
```

to be included in the fuzzy output.

A higher threshold means fewer, stricter matches.

A lower threshold means more, looser matches.

## Why Exact Duplicate Records Are Excluded From Fuzzy

After the exact duplicate groups are created, the script collects all record IDs already found in the exact duplicate file.

Those records are removed from fuzzy matching.

This prevents the same records from appearing in both:

```text
account_duplicates.csv
account_fuzzy_name_matches.csv
account_fuzzy_name_groups.csv
```

Example:

```text
Base records fetched: 5,000
Exact duplicate record IDs excluded: 138
Records after exact duplicate exclusion: 4,862
```

The fuzzy process starts from the remaining records.

## Required Fields for Fuzzy Matching

Fuzzy matching requires all three rule-based fields:

```text
Gender
Birthdate
Composite ZIP
```

Records missing any of these fields are excluded from fuzzy matching.

Example:

```text
Base records fetched: 5,000
Exact duplicate record IDs excluded: 138
Records after exact duplicate exclusion: 4,862
Records excluded missing gender/birthdate/ZIP: 618
Final fuzzy candidate records: 4,244
```

This means:

```text
5,000 base records
- 138 exact duplicate records
= 4,862 records available for fuzzy
- 618 records missing gender, birthdate, or ZIP
= 4,244 final fuzzy candidates
```

## Fuzzy Rule Blocks

The script does not compare every record to every other record.

Instead, it groups fuzzy candidates into rule blocks using:

```text
Gender + Birthdate + Composite ZIP
```

In code:

```js
function makeRuleKey(row) {
    return [
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        norm(compositeZip(row)),
    ].join("|");
}
```

Only records in the same rule block are compared.

Example rule block:

```text
MALE|1985-03-13|43613
```

This means only records with the same gender, birthdate, and composite ZIP are compared for fuzzy name similarity.

This keeps fuzzy matching aligned with the rule-based duplicate logic.

## Pair-Level Fuzzy Output

The pair-level fuzzy output file is:

```text
account_fuzzy_name_matches.csv
```

Each row represents one fuzzy pair.

Important columns include:

```text
row_number
fuzzy_match_reason
name_difference_reason
first_name_difference_reason
last_name_difference_reason
rule_match_reason
match_score_combined_name
match_score_first_name
match_score_last_name
same_gender_flag
same_birthdate_flag
same_composite_zip_flag
strict_rule_match_flag
record_id_1
record_id_2
full_name_1
full_name_2
clean_full_name_1
clean_full_name_2
gender_1
gender_2
birthdate_1
birthdate_2
composite_zip_1
composite_zip_2
```

The explanation fields help explain why the pair was found.

Example explanation:

```text
Fuzzy match because the combined name score 95 is >= threshold 90.
First names differ after cleaning: "ALFRED" vs "ALFREDO" with score 86.
Strict rule match: same gender "MALE", same birthdate "1970-01-01", and same composite ZIP "80919".
This pair was not included in the exact duplicate file because the cleaned first and/or last name was not an exact match.
```

## Group-Level Fuzzy Output

The group-level fuzzy output file is:

```text
account_fuzzy_name_groups.csv
```

This file combines connected fuzzy pairs into groups.

For example:

```text
Record A <-> Record B
Record B <-> Record C
```

becomes:

```text
Record A; Record B; Record C
```

Important columns include:

```text
row_number
group_record_count
shared_gender
shared_birthdate
shared_composite_zip
names_in_group
clean_names_in_group
record_ids
member_numbers
best_pair_score
lowest_pair_score
fuzzy_pair_count_in_group
fuzzy_pair_summary
fuzzy_group_logic
```

## Why Fuzzy Pairs Can Be Greater Than Records

Fuzzy pairs are comparisons, not records.

If one rule block has 5 records, the number of possible pairs is:

```text
5 * 4 / 2 = 10
```

Formula:

```js
n * (n - 1) / 2
```

So pair counts can be greater than record counts.

However, because this script blocks by:

```text
Gender + Birthdate + Composite ZIP
```

pair counts should usually stay manageable.

## Settings

All tunable constants live in `config.js`:

```js
const FUZZY_THRESHOLD = 90;
const PROGRESS_LOG_EVERY_RECORDS = 1000;
const PROGRESS_LOG_EVERY_PAIRS = 250000;
```

### Test vs. production mode (`MAX_FETCH`)

The run mode is chosen with a **cross-platform command-line flag** (it works the
same in PowerShell, cmd, and bash because it's a normal process argument — no
shell-specific environment-variable syntax). `config.js` resolves it and the
result is passed into `main(is_test)`:

```js
// config.js — --test => true, --prod/--production => false, default false (prod)
function resolve_is_test(argv = process.argv) {
    if (argv.includes("--test")) return true;
    if (argv.includes("--prod") || argv.includes("--production")) return false;
    return false;
}
```

`is_test` selects the Salesforce credentials (dev sandbox vs. production) and the
fetch limit (`MAX_FETCH` = 5,000 test / 1,000,000 prod). Set it per run:

```bash
node step_1_find_duplicates.js --test   # dev sandbox, 5,000 cap
node step_1_find_duplicates.js --prod   # production, full fetch
```

### FUZZY_THRESHOLD

Controls how similar the names must be.

```text
Higher threshold = fewer, stricter fuzzy matches
Lower threshold = more, looser fuzzy matches
```

Recommended starting value:

```js
const FUZZY_THRESHOLD = 90;
```

## Environment Setup

Create or update the `.env` file used by the script.

The script currently loads:

```js
dotenv.config({ path: "../../.env" });
```

So the `.env` file must exist two folders above the script location.

Example `.env`:

```bash
SF_LOGIN_URL=https://test.salesforce.com
SF_USERNAME=your_sandbox_username
SF_PASSWORD=your_password
SF_SECURITY_TOKEN=your_security_token
```

For sandbox access, use:

```text
https://test.salesforce.com
```

For production access, use:

```text
https://login.salesforce.com
```

## Required Node Packages

Install dependencies:

```bash
npm install dotenv jsforce fast-csv
```

## Run the Script

From the script folder, either use the interactive menu (recommended):

```bash
node menu.js
```

The menu can run the tests, do a syntax check, run the finder in TEST or
PRODUCTION mode, and open the output/archive folders.

Or run the script directly:

```bash
node step_1_find_duplicates.js --test   # test (dev sandbox, 5,000 cap)
node step_1_find_duplicates.js --prod   # production (full fetch)
node step_1_find_duplicates.js          # defaults to production
```

## Testing

The `src/` modules are pure and unit-tested with Node's built-in test runner.
Tests never log into Salesforce or touch the production output folders.

```bash
node --test tests/                 # run every suite
node --test tests/matcher.test.js  # run one suite
```

Or use menu item 1 (all tests) / 2 (file output tests).

## Slack Server

`server_salesforce_duplicates_8017.js` (at the repo root, alongside the other
`server_*.js`, port 8017) exposes the duplicate output over Slack slash commands.
It mirrors `server_slack_events.js` and reuses the shared Slack upload utilities.

Run it from the repo root (or menu item 11):

```bash
node server_salesforce_duplicates_8017.js
```

Endpoints (hit directly from the CLI, or wire to Slack slash commands):

```text
GET  /salesforce-duplicates-test          health check
POST /salesforce-duplicates-stats         posts the latest run's counts (+ total records scanned)
GET  /scheduled-salesforce-duplicates     cron: regenerate + post files to a channel
POST /salesforce-duplicates-reporting     /reporting: DM the CSV file(s) + stats
```

The returned stats include the **total records scanned** from the latest run (read
from a small per-run summary file the finder writes to a meta folder).

Slash arguments (passed in the command `text` as `key=value`):

```text
mode=latest|run                 latest (default) returns existing files; run regenerates
force=true                      with mode=run, bypass the freshness window (always regenerate)
file=all|exact|fuzzy_pair|fuzzy_group   which file(s) to return (default all)
```

`mode=run` (slash commands) regenerates against **production** — but only if the
most recent output file is older than `FRESH_OUTPUT_WINDOW_MINUTES` (config,
default 30). **Within that window `mode=run` returns the latest files instead** of
re-querying Salesforce (so rapid repeat calls don't hammer it). When that happens
the Slack reply says so and points you to the override.

To regenerate anyway, add **`force=true`**:

```text
/duplicates mode=run              -> regenerate only if older than 30 min, else latest
/duplicates mode=run force=true   -> always regenerate (ignores the window)
```

The `/scheduled` endpoint additionally accepts `?is_test=true|false` (default
`false` = production), so you can drive a full server → Slack run against the dev
sandbox without touching production:

```text
GET /scheduled-salesforce-duplicates?is_test=true    # dev sandbox
GET /scheduled-salesforce-duplicates?is_test=false   # production (default)
```

CLI examples:

```bash
curl http://localhost:8017/salesforce-duplicates-test
curl "http://localhost:8017/scheduled-salesforce-duplicates?is_test=true"   # sandbox regenerate + post
curl "http://localhost:8017/scheduled-salesforce-duplicates?is_test=false"  # production
curl -X POST http://localhost:8017/salesforce-duplicates-reporting -d "text=mode=latest file=exact"
curl -X POST http://localhost:8017/salesforce-duplicates-reporting -d "text=mode=run force=true"  # force a regenerate
```

## Console Logging

### Step timing (live + end-of-run timeline)

As each major step finishes, the script prints a live one-line marker so you can
watch progress and see exactly when each stage completes:

```text
[STEP] archive prior outputs           0.1s
[STEP] fetch from Salesforce           107.0s
[STEP] exact duplicates                3.2s
[STEP] fuzzy matching                  6.8s
[STEP] fuzzy groups                    0.4s
```

Just before the run summary, it prints a timeline sorted largest-first (with bars)
so the slow stage is obvious at a glance:

```text
──────────────────────────────────────────────────────
Run timing (largest first):
  fetch from Salesforce            107.00s  ████████████████████████████
  fuzzy matching                     6.80s  ██
  exact duplicates                   3.20s  █
  fuzzy groups                       0.40s
  ────────────────────────────── ────────
  TOTAL                            117.40s
──────────────────────────────────────────────────────
```

This mirrors the stage timer in `event_analysis/build_all.js`. Implemented in
`src/step_timer.js` (`create_step_timer`).

### Run summary

The script also logs the full run summary, including:

```text
Script start time
Script end time
Script duration
Query start time
Query end time
Query duration
Salesforce total matching records
Records actually fetched
Exact duplicate groups found
Exact duplicate record IDs excluded from fuzzy
Fuzzy candidate records
Fuzzy rule blocks
Fuzzy pairs compared
Fuzzy pair matches found
Fuzzy groups found
Output file names
```

Example summary:

```text
Summary
-------
Script start time: 2026-06-04 01:32:45.301 UTC
Script end time: 2026-06-04 01:32:49.282 UTC
Script duration: 3s
Query start time: 2026-06-04 01:32:45.839 UTC
Query end time: 2026-06-04 01:32:49.133 UTC
Query duration: 3s
Total records scanned: 5000
Salesforce total matching records: 695827
Hardcoded MAX_FETCH: 5000
Hardcoded FUZZY_THRESHOLD: 90
Exact duplicate groups found: 47
Exact duplicate record IDs excluded from fuzzy files: 138
Fuzzy candidate records scanned after exact exclusion and required-rule filters: 4244
Fuzzy pairs compared: 40
Fuzzy pair matches found: 5
Fuzzy groups found: 5
```

## Recommended Review Order

Review the files in this order:

```text
1. account_duplicates.csv
2. account_fuzzy_name_groups.csv
3. account_fuzzy_name_matches.csv
```

Use the pair file to explain or audit records from the group file.

## Common Questions

### Did the exact and fuzzy logic process the same base records?

Yes.

Both start from the same Salesforce fetch.

The exact logic processes all fetched records.

The fuzzy logic starts with those same records, then removes:

```text
1. Records already found in exact duplicate groups
2. Records missing gender, birthdate, or composite ZIP
```

### Why are there fewer fuzzy candidates than total records?

Because fuzzy only uses records that:

```text
1. Were not already caught as exact duplicates
2. Have gender
3. Have birthdate
4. Have composite ZIP
```

### Why do fuzzy matches look like they should have been rule-based matches?

They are rule-based matches on:

```text
Gender + Birthdate + Composite ZIP
```

But they are not exact duplicate matches because the name differs.

For example:

```text
Alfred Aguado
Alfredo Aguado
```

These share the rule fields but not the exact first name.

So they correctly belong in the fuzzy output.

### Does fuzzy return only the highest probability match?

No.

The pair file returns every qualifying fuzzy pair.

The group file then combines related pairs into connected groups.

### Why keep both pair and group fuzzy files?

The pair file explains the specific match.

The group file helps with cleanup and review because it combines related records.

## Production Notes

For a full run across 600K+ records:

```text
1. Increase MAX_FETCH.
2. Run during off-hours.
3. Make sure the machine has enough memory.
4. Consider writing large outputs to a timestamped output folder.
5. Consider moving the fetched Salesforce records into MySQL or BigQuery for repeat analysis.
```

Recommended full-run setting:

```js
const MAX_FETCH = 1000000;
```

## Known Limitations

### The `--test` sample is deterministic, not random

The `--test` pull applies `ORDER BY LastName, FirstName, Id`, so with:

```js
const MAX_FETCH = 5000;
```

it gets the first 5,000 records alphabetically by last name, first name, and ID —
the same rows on every test run. (The `--prod` pull is unordered for speed; on a full
run every record is fetched, so order doesn't matter.)

### Formula fields are handled in Node.js

The composite ZIP formula is recreated in Node.js because Salesforce may not allow formula fields in aggregate grouping.

### Fuzzy logic requires gender, birthdate, and ZIP

Records missing any of those fields are excluded from fuzzy matching.

### Fuzzy group logic is based on connected pairs

If A matches B and B matches C, all three are placed in the same group, even if A and C are not directly matched.

This is usually helpful, but reviewers should still inspect groups before taking action.

## Suggested Future Enhancements

Potential improvements:

```text
1. [done] Timestamped output files written to /data with archive rotation.
2. Add a raw Salesforce export CSV.
3. [partial] MAX_FETCH is now env-driven (SF_DUP_IS_TEST); FUZZY_THRESHOLD still in config.js.
4. Add separate rule-based-only output:
   same gender + birthdate + ZIP, regardless of name score.
5. Add ZIP normalization to compare only first 5 digits.
6. Add nickname handling:
   Bill/William, Bob/Robert, Mike/Michael, etc.
7. Load results into MySQL for deeper review.
8. Add Salesforce update logic only after manual review.
```

## Safety Note

This script only reads Salesforce data and writes CSV files locally.

It does not update, merge, delete, or modify Salesforce records.

# CLAUDE.md — Salesforce duplicates tool (context for AI sessions)

Purpose: connect to Salesforce, pull `Account` (person) records, and write three
CSV files that flag exact and fuzzy duplicate members for review. Read-only against
Salesforce — it never updates, merges, or deletes records.

See `README.md` for the full algorithm (exact keys, fuzzy scoring, rule blocks).
This file is the orientation map for the code + how to run/test it. Keep it current
as the structure changes.

## Entry points

- `sf_duplicates_060326.js` — main orchestrator. `main()` runs the full pipeline;
  exported as `execute_get_salesforce_duplicates_data`. Guarded by
  `require.main === module`, so requiring it does not run it.
  (Recommended future rename to a stable name like `find_duplicates.js`; if renamed,
  update `menu.js` and the `tests/*.test.js` requires.)
- `menu.js` — interactive launcher (`node menu.js`): run tests, syntax check, run
  the finder in TEST or PRODUCTION mode, open the output/archive folders.

## File structure

```
salesforce_duplicates/
  sf_duplicates_060326.js   orchestrator: SF connect/query, exact + fuzzy pipeline,
                            row building, file writing, run summary
  config.js                 IS_TEST/env flag, thresholds, output filenames, dir names
  menu.js                   interactive CLI launcher
  src/
    fmt.js                  format_duration, format_timestamp_utc/mtn (pure)
    log.js                  COLORS, colorize, log_info/success/warn/error (uses fmt)
    normalize.js            field cleaning + key builders (pure)
    matcher.js              levenshtein, similarity, rule flags, reason strings (pure)
    grouping.js             UnionFind + build_fuzzy_groups
  tests/
    normalize.test.js       node:test unit tests
    matcher.test.js
    grouping.test.js
    file_output.test.js     CSV write + archive rotation
  README.md                 algorithm + field reference
  schema.md                 Salesforce custom-object/import schema notes
```

Still living inside the orchestrator (candidates for future extraction into
`src/`): `to_sf_*_row` (Salesforce import schema), the exact-detection and
fuzzy candidate/pairwise blocks inside `main()`, the SF connect/query, and
`write_csv` / `archive_previous_output_files` (an `output_files.js` seam).

## Run modes

`IS_TEST` (in `config.js`) reads the `SF_DUP_IS_TEST` env var, defaulting to
`false` (production). It controls SF credentials (dev vs prod) and `MAX_FETCH`
(5,000 in test, 1,000,000 in prod).

```bash
SF_DUP_IS_TEST=true  node sf_duplicates_060326.js   # dev sandbox, capped fetch
SF_DUP_IS_TEST=false node sf_duplicates_060326.js   # production, full fetch
node sf_duplicates_060326.js                         # defaults to production
```

Or use the menu (items 4 = TEST, 5 = PRODUCTION).

## Output + archiving

Files are written to the cross-platform `/data` path resolved by
`utilities/determineOSPath.js` (NOT the code directory):

- `usat_salesforce_duplicates/` — current run's files
- `usat_salesforce_duplicates_archive/` — previous run's files

On each run, `archive_previous_output_files()` clears the archive, moves the prior
run's CSVs into it, then the new run writes fresh files. Output names carry a
date/time stamp at the end before the extension, e.g.
`account_duplicates_sf_import_2026-06-04_14-30-05.csv`.

## Testing

```bash
node --test tests/            # all suites
node --test tests/matcher.test.js
```

Or menu item 1 (all) / 2 (file output). The `src/` modules are pure and fully
unit-tested; tests never touch Salesforce or production output folders.

## Conventions

- Reuse the shared helpers in `../../utilities/` (`determineOSPath`,
  `createDirectory`, `getCurrentDate`) rather than re-implementing.
- Keep refactors behavior-preserving: move code, don't rewrite it; verify with
  the test menu after each step.
- Output filenames are timestamped; source filenames should be stable (don't
  date-stamp source files).

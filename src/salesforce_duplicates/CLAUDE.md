# CLAUDE.md — Salesforce duplicates tool (context for AI sessions)

Purpose: connect to Salesforce, pull `Account` (person) records, and write three
CSV files that flag exact and fuzzy duplicate members for review. Read-only against
Salesforce — it never updates, merges, or deletes records.

See `README.md` for the full algorithm (exact keys, fuzzy scoring, rule blocks).
This file is the orientation map for the code + how to run/test it. Keep it current
as the structure changes.

## Entry points

- `step_1_find_duplicates.js` — main orchestrator. `main()` runs the full pipeline;
  exported as `execute_get_salesforce_duplicates_data`. Guarded by
  `require.main === module`, so requiring it does not run it.
- `menu.js` — interactive launcher (`node menu.js`): run tests, syntax check, run
  the finder in TEST or PRODUCTION mode, open the output/archive folders, start
  the Slack server.
- `../../server_salesforce_duplicates_8017.js` — Slack slash-command server (lives
  at the repo root with the other `server_*.js`). See "Slack server" below.

## File structure

```
salesforce_duplicates/
  step_1_find_duplicates.js   orchestrator: exact + fuzzy pipeline + run summary
  step_2_get_duplicate_report.js   locate latest output CSVs + counts (for the server)
  step_2a_create_duplicate_message.js   build the Slack summary text
  report_service.js         server glue: parse_report_args + resolve_report
                            (slash-arg parsing + freshness/force logic; testable)
  config.js                 run-mode flag resolver, thresholds, freshness window,
                            output filenames, dir names
  menu.js                   interactive CLI launcher
  src/
    fmt.js                  format_duration, format_timestamp_utc/mtn (pure)
    log.js                  COLORS, colorize, log_info/success/warn/error (uses fmt)
    ids.js                  make_run_id, make_hash, make_external_id (pure)
    normalize.js            field cleaning + key builders (pure); composite_zip
                            trims US ZIPs to first 5 digits (trim_zip5), the single
                            chokepoint every consumer goes through
    matcher.js              levenshtein, similarity, rule flags, reason strings (pure)
    grouping.js             UnionFind + build_fuzzy_groups
    step_timer.js           create_step_timer: live [STEP] lines + end-of-run
                            timeline (mirrors event_analysis stage timer)
    exact.js                detect_exact_duplicates (+ its summary logger)
    fuzzy.js                run_fuzzy_matching: candidate filter, rule blocks,
                            pairwise compare (+ its two summary loggers)
    zip_trim.js             build_zip_trim_mapping: reviewable raw -> trimmed
                            composite-ZIP map + counts (pure)
    sf_rows.js              to_sf_exact/pair/group_row — Salesforce import schema mapping
    output_files.js         add_timestamp_to_filename, write_csv, archive rotation,
                            write_run_summary + write_zip_trim_mapping (meta folder)
    salesforce.js           jsforce connect + Account query (only networked module);
                            --test uses REST autoFetch (ORDERED SOQL, for a stable
                            capped subset), --prod uses the Bulk API (UNORDERED SOQL
                            so SF doesn't sort ~700k rows before streaming)
    summaries.js            log_run_summary (final run summary block)
  tests/                    node:test unit tests:
    normalize.test.js  matcher.test.js  grouping.test.js  ids.test.js
    sf_rows.test.js  exact.test.js  fuzzy.test.js  zip_trim.test.js
    file_output.test.js     CSV write + archive rotation
    step_2_report.test.js   report module (counts + latest-file selection)
    report_service.test.js  slash-arg parsing + freshness/force (injected deps)
  README.md                 algorithm + field reference
  schema.md                 Salesforce custom-object/import schema notes
```

`main()` is a thin orchestrator (~230 lines): resolve mode -> archive -> fetch ->
`build_zip_trim_mapping` (+ write to meta) -> `detect_exact_duplicates` -> write ->
`run_fuzzy_matching` -> write -> `build_fuzzy_groups` -> write ->
`log_zip_trim_summary` -> `log_run_summary`. A `create_step_timer()` runs
alongside it: `timer.stage_done(label)` after each big step prints a live
`[STEP] <label> — <Xs>` line, and `timer.print_summary()` prints a sorted
(largest-first) timeline just before the run summary.

## Performance notes

- **Fetch (the dominant cost at full scale).** `--prod` uses the Bulk API with the
  UNORDERED query (`ACCOUNT_SOQL_BASE`). Dedup never needs sorted input (exact uses a
  Map, fuzzy uses rule-block buckets, outputs are sorted in code), so dropping
  `ORDER BY` lets Salesforce stream rows without sorting the whole ~700k set first.
  `--test` keeps the ORDERED query so the capped 5,000-row sample is deterministic.
- **Where the time goes** is visible at a glance in the step-timer timeline at the end
  of each run; the run summary still prints the precise Query/Fuzzy/Script durations.

## Slack server

`server_salesforce_duplicates_8017.js` (repo root, port 8017) mirrors
`server_slack_events.js`. Endpoints:

- `GET  /salesforce-duplicates-test` — health check.
- `POST /salesforce-duplicates-stats` — slash command; posts the latest run's counts
  (incl. total records scanned).
- `GET  /scheduled-salesforce-duplicates` — cron; regenerates then posts the files to
  `SF_DUP_CHANNEL_ID` (guarded by an `isRunning` lock). Drive the run with
  `?is_test=true` (dev sandbox) or `?is_test=false` (production, default).
- `POST /salesforce-duplicates-reporting` — slash `/reporting`; DMs the CSV file(s) + stats.

Slash args (in the command `text`, `key=value`): `mode=latest|run` (default `latest`),
`file=all|exact|fuzzy_pair|fuzzy_group` (default `all`), `force=true` (with `mode=run`,
bypass the freshness window). The slash commands always regenerate against production;
only `/scheduled` accepts `?is_test`.
`mode=run` regenerates via `execute_get_salesforce_duplicates_data(false)` (production)
UNLESS the newest output file is younger than `FRESH_OUTPUT_WINDOW_MINUTES` (config) —
within that window it returns the latest instead (the Slack reply explains this and
points to `force=true`). `mode=run force=true` always regenerates. Run it from the repo
root (`node server_salesforce_duplicates_8017.js`) or menu item 12; hit it with menu
items 13–16.

Each run persists a small summary (total records scanned + counts, incl. ZIP-trim
counts) to `META_DIR_NAME/RUN_SUMMARY_FILE` (a sibling of the output folder, so it
is never swept into the Slack uploads); `step_2_get_duplicate_report` reads it so the
stats message can report the total records scanned even on a `mode=latest` read. The
same meta folder also holds `ZIP_TRIM_MAPPING_FILE` (`zip_trim_mapping.csv`), the
reviewable raw -> trimmed composite-ZIP map written each run (menu item 11 opens this
folder).

## Run modes

Run mode is chosen with a cross-platform CLI flag — it works identically in
PowerShell, cmd, and bash because it's passed as a normal process argument (no
shell-specific env-var syntax). `config.js` exposes `resolve_is_test(argv)`, and
the resolved boolean is passed into `main(is_test)`, which selects SF credentials
(dev vs prod) and `MAX_FETCH` (5,000 test / 1,000,000 prod). Nothing reads
`process.env` for mode selection.

```bash
node step_1_find_duplicates.js --test    # dev sandbox, capped fetch
node step_1_find_duplicates.js --prod    # production, full fetch
node step_1_find_duplicates.js           # defaults to production
```

Or use the menu (items 7 = TEST, 8 = PRODUCTION).

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

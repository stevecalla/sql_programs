# Duplicate criteria tuning sweep

A review-only CLI that answers "how many duplicates would we get if we changed the
criteria?" It fetches the Account records **once**, then replays the matching over
many criteria combinations and prints the counts side by side — broken out by exact,
fuzzy, nickname, and the reconciled consolidated clusters, with the criteria shown.

It never touches production: the matching runs through a self-contained engine
(`src/sweep.js`) that reuses the low-level scoring primitives but does **not** modify
`exact.js` / `fuzzy.js` / `consolidate.js`. Its exact grouping uses the same rule as
production — **cleaned** first/last names (so `O'Brien`==`OBrien`) and a non-blank gate
on the required fields — so the `baseline` profile reproduces the production exact
output; other profiles generalize it by varying which fields are required. The fetched records are streamed once into
the local DB (table `salesforce_account_duplicate_snapshot`, plus a row in the unified
run table `salesforce_duplicate_detection_run`) and every
replay reads from there — there is no JSON snapshot file. The CSV results go to a
folder that is a sibling of the production output (see "Where output goes").

## Files

```text
src/sweep_duplicates.js   the CLI (snapshot / run / detail / diff)
src/sweep.js              the pure engine (expand_grid, run_profile, diff_profiles)
config.js                 DEFAULT_SWEEP_GRID — the default, editable criteria grid
tests/sweep.test.js       unit tests
```

## How to run

From the menu (`node menu.js`), the **DUPLICATE TUNING** section:

```text
14. Sweep snapshot — TEST         fetch records once (dev sandbox) and stream into the DB
15. Sweep snapshot — PRODUCTION   fetch records once (production) and stream into the DB
16. Run sweep (grid over snapshot) replay the grid over the DB snapshot; summary + CSV
17. Sweep snapshot status (DB)    latest run from the logbook + live row count
18. Open tuning folder            the sweep CSVs
```

The typical flow is **14 or 15 → 16 → 18**, with **17** any time to confirm what's
loaded. The snapshot lives in the local DB (table
`salesforce_account_duplicate_snapshot`, with the run logged to the unified
`salesforce_duplicate_detection_run` table) — there is no JSON file. The
`detail` and `diff` drill-downs are
available as CLI subcommands (below); profile labels read as
`t<thr>_nick<ON|OFF>_z<zipTrim>_<fields>` — e.g. `t88_nickON_z5_gbz` means
"threshold 88, nicknames on, ZIP trimmed to 5, requiring gender + birthdate + zip"
(`g`=gender, `b`=birthdate, `z`=zip; `gbz` = all three).

Or directly:

```bash
# 1. take a snapshot (fetch once, STREAM into the DB). Same flags as the finder:
node src/sweep_duplicates.js snapshot --test            # dev sandbox, capped
node src/sweep_duplicates.js snapshot --test --full     # dev sandbox, ALL records (Bulk)
node src/sweep_duplicates.js snapshot --prod --partial  # production, capped sample
node src/sweep_duplicates.js snapshot --prod            # production, full

# 2. (optional) confirm what's loaded in the DB:
node src/sweep_duplicates.js status                     # latest run (logbook) + live row count

# 3. replay the grid over the DB snapshot (no Salesforce — reads the table):
node src/sweep_duplicates.js run                        # default grid (config.js DEFAULT_SWEEP_GRID)
node src/sweep_duplicates.js run --grid my_grid.json    # a one-off JSON grid override

# 4. drill in:
node src/sweep_duplicates.js detail "t88_nickON_z5_gbz" # matched pairs for one profile
node src/sweep_duplicates.js diff "baseline" "t88_nickON_z5_gbz"   # pair-level diff
```

The snapshot step is the only one that hits Salesforce. After that, `status` / `run` /
`detail` / `diff` read from the local DB, so you can iterate on the grid freely.

On a full production snapshot, the CLI shows progress so the long steps aren't silent:
the Bulk fetch logs `Fetched 200,000 records from Salesforce...` every
`BULK_FETCH_PROGRESS_EVERY` rows, and the stream-load logs `Loaded 150,000 / 700,322
rows (21%) into the snapshot table` every `DB_LOAD_PROGRESS_EVERY` rows (both in
`config.js`). Test snapshots are small enough that they just finish.

## What the console shows

`run` replays the full detection pipeline (exact + fuzzy + nickname + consolidated)
once **per profile** over every snapshot record, so on a large prod snapshot it runs
for a while. It first prints a **live progress line per profile** — with a per-profile
time and a running ETA — so you can tell it's working and not hung:

```text
[1/18] baseline ... done in 41.2s  (~11m 40s left)
[2/18] t88_nickON_z5_gbz ... done in 39.8s  (~10m 33s left)
...
All 18 profiles complete in 12m 18s
```

(The ETA is the average time per finished profile × profiles still to go, so it steadies
as the run proceeds. A TEST snapshot is only 5,000 records, so the whole grid finishes in
seconds — the progress matters mainly on a PRODUCTION snapshot.)

After all profiles finish it prints a block per profile, then a comparison table. Each
block shows the **conditions**, the **funnel** (records → eligible → blocks → pairs compared), the
**rule signals** (exact / fuzzy / nickname, with the nickname net-new vs also-fuzzy
split), the **consolidated** clusters by strongest signal, and the **delta vs the
baseline** (matched pairs gained/lost):

```text
[t88_nickON_z5_gbz]
  Conditions : threshold=88  nickname=ON  zip_trim=5  rule_fields=gender+birthdate+zip  weights f/l=0.45/0.55
  Funnel     : 5,000 records -> 4,244 eligible (gender+birthdate+zip present) -> 1,802 blocks -> 40 pairs compared
  Exact      : 47 groups (138 records)
  Fuzzy      : 7 pairs
  Nickname   : 9 pairs (7 net-new, 2 also-fuzzy)
  Consolidated: 16 clusters [exact 11 | fuzzy 4 | nickname 1]
  vs baseline: +14 matched pairs / -0 (common 26)
```

```text
COMPARISON TABLE
Profile                            Thr  Nick  Fields  Exact  Fuzzy  Nick  Consol      dPairs
baseline                            90    ON     gbz     47      5     9      14           —
t88_nickON_z5_gbz                   88    ON     gbz     47      7     9      16      +14/-0
t90_nickOFF_z5_gbz                  90   OFF     gbz     47      5     0       9      +0/-12
...
```

## The grid (`config.js` → `DEFAULT_SWEEP_GRID`)

Each key is an axis; the sweep runs the **cartesian product** of all axes, with the
current production logic (`baseline`) always included first. The default grid lives in
`config.js` as `DEFAULT_SWEEP_GRID` — edit it there. To try a one-off grid without
touching config, pass `--grid <file>` pointing at a JSON file of the same shape.

```js
// config.js
const DEFAULT_SWEEP_GRID = {
    fuzzy_threshold: [88, 90, 92],
    nickname_enabled: [true, false],
    rule_fields: [
        ["gender", "birthdate", "zip"],
        ["gender", "birthdate"],
        ["birthdate", "zip"],
    ],
    zip_trim_len: [5],
    weight_first: [0.45],
    weight_last: [0.55],
    nickname_last_name_min_score: [90],
};
```

The default is 18 profiles (3 thresholds × nickname on/off × 3 rule-field sets).
`rule_fields` entries are subsets of `[gender, birthdate, zip]`. Keep "no DOB" and
dropping two fields at once as deliberate opt-in experiments — they widen the
comparison blocks (more pairs, more false-positive risk, slower).

## Criteria object

Each profile is a criteria object the engine understands:

| Field | Meaning |
|---|---|
| `fuzzy_threshold` | Combined-name score (0–100) a pair must reach to be a fuzzy match. |
| `weight_first` / `weight_last` | Blend for the combined score (`first*wF + last*wL`). |
| `nickname_enabled` | Whether the nickname signal runs. |
| `nickname_last_name_min_score` | Last name must score at least this for a nickname match. |
| `zip_trim_len` | Digits to keep when normalizing ZIP (5 = production; 0 = no trim). |
| `rule_fields` | Which of `gender` / `birthdate` / `zip` must be present and must match. |

## Where output goes

The sweep follows the **same external-`/data` pattern** as the rest of the tool. Just
like the production output (`usat_salesforce_duplicates`), archive
(`usat_salesforce_duplicates_archive`), and meta (`usat_salesforce_duplicates_meta`)
folders, the sweep writes to a **sibling** folder under the same external data root
resolved by `utilities/determineOSPath.js`:

```text
usat_salesforce_duplicates_tuning/
  sweep_summary.csv                      the comparison table (all profiles)
  sweep_detail_<profile>.csv             matched pairs for one profile (detail)
  sweep_diff_<a>__<b>.csv                pair-level diff between two profiles
```

The **records themselves** are not here — they live in the DB
(`salesforce_account_duplicate_snapshot`), re-used by `run`/`detail`/`diff`/`status`.
Only the CSV results land in this folder. Being a sibling (not inside the output
folder) keeps the sweep CSVs out of the Slack `/scheduled` uploads and the archive
rotation — the same reason the `meta` folder is separate. Set `SWEEP_TUNING_DIR=<path>`
to override the CSV destination.

## Testing

```bash
node --test tests/sweep.test.js
```

The engine is pure and fully unit-tested (grid expansion, the funnel/signal counts,
threshold/nickname/rule-field behavior, and the pair-level diff). Tests never touch
Salesforce or any output folder.

## Merge console — Tuning panel (review-only UI)

The sweep now also writes one row per profile to the DB table
`salesforce_duplicate_sweep_profile` (drop + recreate each `run`, alongside the
`salesforce_duplicate_*` result tables), so the merge console can show the results without
re-reading the CSV. Each row carries the criteria (`fuzzy_threshold`, `nickname_enabled`,
`rule_fields`, `zip_trim_len`) plus the counts the panel needs: `total_records`,
`accounts_in_clusters`, `duplicate_pairs`, `exact_pairs`, `fuzzy_pairs`, `nickname_pairs`,
`consolidated_clusters`, and the by-signal cluster composition `comp_exact / comp_fuzzy /
comp_nickname / comp_multi` (mirrors the dashboard's exact/fuzzy/nickname/multi split). The
baseline (production-equivalent) profile is `ordinal = 0`, `is_baseline = 1`.

In the merge tool:
- **Process page → "Run tuning sweep"** runs the sweep *replay-only* (`sweep_duplicates.js run`)
  over the snapshot already loaded — read-only, no Salesforce fetch, and it does NOT touch the
  shared `salesforce_account_duplicate_snapshot`. (If no snapshot exists yet, it errors; take one
  via the finder first.)
- **Tuning page** reads `/api/tuning` (latest profiles) and shows the baseline funnel, the selected
  profile's funnel (with deltas vs. baseline), and a sortable/searchable table of every profile's
  clusters by signal plus duplicate-account totals. Clicking a row loads it into the funnel.

Tests: `tests/sweep_profile.test.js` (run_profile composition + `write_sweep_profiles`),
plus `src/salesforce_merge/tests/tuning_read.test.js` and `reviews_filters.test.js`.

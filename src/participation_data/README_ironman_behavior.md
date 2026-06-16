# Ironman Participant Behavior Pipeline

Understands whether people who race an **IRONMAN** keep racing afterward, and how that behavior varies
by age / age bucket, gender, distance type, race type, category, and over time.

The heavy work is pre-computed into a small set of tables so the actual analysis is a simple `GROUP BY`
(or a dashboard read), instead of repeatedly scanning the full participation history.

- **Source table:** `all_participation_data_with_membership_match` (one row per race result, `id_rr`, per profile, `id_profile_rr`)
- **Population:** Ironman participants only (≥ 1 official IRONMAN race ever)
- **Final deliverable:** `im_participation_3_profile` (one row per Ironman participant) + two time-series rollups, plus CSV exports

---

## Tables produced

| # | Table | Grain | Built from | Purpose |
|---|---|---|---|---|
| 1 | `im_participation_1_profile_ids` | one row per profile | source | Distinct Ironman-participant `id_profile_rr` |
| 2 | `im_participation_2_history` | one row per race result | source ⨝ #1 | Full race history of those profiles + derived `is_ironman_event` / `im_distance_bucket` |
| 3 | `im_participation_3_profile` | one row per profile | #2 (batched) | **FINAL** per-participant behavior table |
| 4 | `im_participation_4_timeseries_cohort` | cohort × dims | #3 | Cohort retention rollup ("did behavior change by first-Ironman year/segment?") |
| 5 | `im_participation_5_timeseries_activity` | year × dims | #2 | Activity-by-calendar-year rollup ("how much did this population race each year?") |

`im_participation_2_history_batch` is a **transient** per-batch slice of `#2` (dropped/recreated each
batch, and at the end). It is not a persisted output.

All tables are prefixed `im_participation_<n>_` so they cluster together and list in pipeline order.

---

## Table details

### `#1 im_participation_1_profile_ids` — the Ironman population
`SELECT DISTINCT id_profile_rr` from the source where the IRONMAN rule matches. **One row per Ironman
participant** (PK on `id_profile_rr`).
**Answers:** *"Who counts as an Ironman participant — which profiles are in scope?"*
**Purpose:** defines exactly *whose* full history we pull into `#2`, and is the list the `#3` batch loop
pages through (via keyset range). Everything downstream is scoped to this population.

### `#2 im_participation_2_history` — the working history
The **full race history** (Ironman *and* non-Ironman races) of every `#1` profile, built by joining the
source table to `#1`. **One row per race result (`id_rr`).** It carries the dimensions needed downstream
— event / distance type / race type / category, `age` + `age_as_race_results_bin`, `gender_code`,
region, `start_date_races` + `start_date_year_races` — and adds two **derived** columns:
`is_ironman_event` (the rule applied per race) and `im_distance_bucket`
(`ironman_70_3` / `ironman_140_6` / `non_ironman`).
**Answers:** *"For everyone who's done an Ironman, what is their complete race history — Ironman and non-Ironman?"*
**Purpose:** (a) the bounded, indexed input the batched `#3` build slices over; (b) the source for the
`#5` activity rollup. We deliberately keep each participant's *whole* history — not just their Ironman
races — because the core question is what they did **before and after** their Ironman.

### `#3 im_participation_3_profile` — the answer table
**One row per Ironman participant**, computed per 50k-profile batch from `#2`. For each person it derives:
- **first and last Ironman** — date, year, age, age bucket, distance bucket, distance type, race type, category, region;
- **race counts** — total distinct races, Ironman races, `count_im_140_6` (full), `count_im_70_3`, non-Ironman races, distinct start years, first/last race year;
- **post-Ironman behavior** — races/years after the first and after the last Ironman, non-IM vs IM races after, `continued_after_first_im`/`…last_im`, and the 12/24/36-month and year+1/+2/+3 "raced again" flags;
- **`behavior_segment`** — `one_and_done` / `repeat_ironman` / `continued_non_ironman` / `lapsed_after_ironman`;
- **`ironman_race_positions`** — where each Ironman fell in their overall racing cycle, e.g. `"2 | 4 | 7"` = their 2nd, 4th and 7th races (date order) were the Ironmans;
- **three start-date-ordered timelines** — all events (tagged), Ironman-only, non-Ironman-only.

**Answers:** *"Did this person keep racing after their Ironman — and how does that vary by who they are
(age, gender, distance, race type, category)?"*
**Purpose:** the single per-participant table you slice directly by any `first_im_*` dimension. (Full
column list in the "`#3` key columns" section below.)

### `#4 im_participation_4_timeseries_cohort` — cohort retention (built from `#3`)
Groups the profile table by **when each athlete did their first Ironman** (`first_im_year`) crossed with
demographics (`first_im_distance_bucket`, `first_im_age_bucket`, `first_im_gender`, `first_im_category`,
`first_im_race_type`), and computes retention measures per cell: `count_participants`,
`count_continued_after_last_im`, `retention_rate` (share who raced again after their last Ironman),
`avg_races_after_last_im`, `avg_years_after_last_im`, `pct_repeat_ironman`, `pct_one_and_done`, and the
12/24/36-month "raced again" counts.

**Answers — "Does post-Ironman behavior differ by entry cohort and segment?"** e.g. *did people whose
first Ironman was 2018 keep racing at a higher rate than the 2023 cohort? Do 70.3 first-timers stick
around more than 140.6 first-timers? Does retention vary by age group?* This is the "how has behavior
changed over time" view, keyed on the **cohort**.

### `#5 im_participation_5_timeseries_activity` — activity by calendar year (built from `#2`)
Groups the full race history by **calendar year of each race** (`start_date_year_races`) ×
`is_ironman_event` × `im_distance_bucket` × `name_distance_types` × `name_race_type` × `category` ×
`gender_code` × `age_as_race_results_bin`, and counts `count_distinct_profiles`, `count_distinct_races`,
`count_rows`.

**Answers — "How much did this population race each year, and in what?"** e.g. *how many Ironman
participants showed up to race in 2019 vs 2024, how does their Ironman vs non-Ironman racing volume trend
year over year, which distances/demographics are growing or shrinking.* This is participation **volume
over calendar time**, within the Ironman population.

> **`#4` vs `#5` in one line:** `#4` is keyed on *when they started Ironman* (cohort retention from `#3`);
> `#5` is keyed on *the calendar year of each race* (activity volume from `#2`). Both are pre-aggregated
> convenience tables — anything in `#4` can be derived from `#3` and anything in `#5` from `#2` — they
> just save scanning the big tables for repeatable trend reports.

---

## The IRONMAN classification rule (single source of truth)

**File:** `src/queries/ironman_rule.js` → `ironman_event_predicate(col)`

An event is IRONMAN if the name contains **"ironman"**, OR it is on a curated allow-list of official
IRONMAN races whose names omit "ironman":

```
LOWER(<col>) LIKE '%ironman%'
OR <col> LIKE '%Augusta 70.3%'      -- IRONMAN 70.3 Augusta
OR <col> LIKE '%IM 70.3 Maine%'     -- IRONMAN 70.3 Maine
OR <col> LIKE '%Steelhead 70.3%'    -- IRONMAN 70.3 Steelhead (Maytag)
```

**Why curated and not a blanket `%70.3%`/`%140.6%`:** many independent half/full-distance races put
`70.3` in the name but are *not* IRONMAN-branded (e.g. "Howlin Half 70.3", "Marthas Vineyard 70.3",
"ShrineMan 70.3", "White Mountains Triathlon 70.3", "Racing for Recovery … 70.3"). A blanket rule
over-counts them. To add a newly-discovered official venue, add **one line** to `ironman_rule.js` — every
consumer picks it up.

**Consumers of the shared predicate:** `step_3e_create_ironman_profile_table.js` (`#1` filter + `#2`
`is_ironman_event` and `im_distance_bucket`), `step_1_get_participation_data.js`,
`step_1_get_event_data_042125.js`. The two `events/discovery_queries/*.sql` scratch files mirror it by
hand (kept in sync manually).

> **Divergence note:** the legacy `is_ironman` column produced upstream is now also driven by this
> curated rule, but the existing `all_participation_data_*`, `step_3a`, `step_3c` tables only reflect it
> after the upstream pipeline (`step_1 → step_2 → step_3 → step_3a → step_3c`) is **re-run**, because
> `is_ironman` is materialized.

### Distance buckets (`im_distance_bucket`)
- `ironman_70_3` — name has `70.3`/`half`, or `name_distance_types = 'Long'`
- `ironman_140_6` — name has `140.6`/`full`, or `name_distance_types = 'Ultra'`; also the **default** for any Ironman event not classified as 70.3
- `non_ironman` — everything else

`count_im_140_6` / `count_im_70_3` on `#3` count distinct races in each bucket.

---

## Files

### Orchestrators (`src/participation_data/`)
| Step | File | Builds | Default |
|---|---|---|---|
| 3e | `step_3e_create_ironman_profile.js` | `#1`, `#2`, `#3` + CSV | **on** |
| 3f | `step_3f_load_bq_ironman_profile_metrics.js` | loads `#3` → BigQuery | **off** |
| 3g | `step_3g_create_ironman_timeseries.js` | `#4`, `#5` + CSV | **on** |
| 3h | `step_3h_load_bq_ironman_timeseries_metrics.js` | loads `#4`/`#5` → BigQuery | **off** |

### Query modules (`src/queries/participation_data/`)
- `step_3e_create_ironman_profile_table.js` — `#1`/`#2`/`#3` SQL + per-batch insert + indexes
- `step_3g_create_ironman_timeseries_table.js` — `#4`/`#5` SQL + indexes

### BigQuery (`src/google_cloud/`) — used by 3f/3h and reused by the CSV exports
- queries: `query_ironman_profile.js`, `query_ironman_timeseries_cohort.js`, `query_ironman_timeseries_activity.js`
- schemas: `schema_ironman_profile.js`, `schema_ironman_timeseries_cohort.js`, `schema_ironman_timeseries_activity.js`
- BQ tables: `ironman_profile_data`, `ironman_timeseries_cohort_data`, `ironman_timeseries_activity_data` (dataset `membership_reporting`)

### Shared utility
- `utilities/save_single_csv_with_archive.js` → `execute_save_single_csv(options)` — archive + single-file CSV stream

---

## Run order & toggles

Requires `all_participation_data_with_membership_match` to already exist (built by `step_3`).

Wired into `step_0_run_participation_data_jobs_031425.js` after `step_3d`. **Master toggles:**

```js
run_step_3e = true;   // create #1-#3 + CSV
run_step_3f = false;  // #3 -> BigQuery (off for now)
run_step_3g = true;   // create #4-#5 + CSV
run_step_3h = false;  // #4/#5 -> BigQuery (off for now)
```

**In-file sub-step toggles** (run one piece at a time):

`step_3e` `steps_to_run`: `create_profile_table` (A→#3 empty), `create_distinct_ids` (B→#1),
`create_history_table` (D→#2), `process_batches` (C→insert #3), `append_indexes` (III), `export_csv` (IV).
On reruns where `#1`/`#2` already exist, set `create_distinct_ids`/`create_history_table` to `false`.

`step_3g` `steps_to_run`: `create_cohort_rollup` (#4), `create_activity_rollup` (#5), `append_indexes`,
`export_csv`.

> Run node with `--expose-gc` so the `triggerGarbageCollection()` calls actually free memory on long runs.

---

## CSV exports

Each export archives the prior run, then streams **one** query to a **single** file (row-by-row, memory-safe).
Archive = delete everything in the `_archive` folder, then move the current main-folder CSVs into it.

Root: `determineOSPath()` (Windows: `C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/`).

| Table | Main folder | Archive folder | File |
|---|---|---|---|
| #3 | `usat_csv_ironman_profile` | `usat_csv_ironman_profile_archive` | `results_<ts>_ironman_profile_data.csv` |
| #4 | `usat_csv_ironman_timeseries_cohort` | `…_cohort_archive` | `results_<ts>_ironman_timeseries_cohort_data.csv` |
| #5 | `usat_csv_ironman_timeseries_activity` | `…_activity_archive` | `results_<ts>_ironman_timeseries_activity_data.csv` |

---

## `#3` key columns

- **Identity:** `id_profile_rr`
- **First Ironman:** `first_im_date`, `first_im_year`, `first_im_age`, `first_im_age_bucket`, `first_im_gender`, `first_im_distance_bucket`, `first_im_distance_type`, `first_im_race_type`, `first_im_category`, `first_im_region`
- **Last Ironman:** `last_im_date`, `last_im_year`, `last_im_age`, `last_im_distance_bucket`
- **Counts:** `count_races_total`, `count_ironman_races`, `count_im_140_6`, `count_im_70_3`, `count_non_ironman_races`, `count_start_years`, `first_race_year`, `last_race_year`
- **Behavior:** `races_after_first_im`, `races_after_last_im`, `non_im_races_after_first_im`, `im_races_after_first_im`, `years_after_first_im`, `years_after_last_im`, `continued_after_first_im`, `continued_after_last_im`, `raced_within_12m_after_last_im`, `…_24m_…`, `…_36m_…`, `behavior_segment`
- **`ironman_race_positions`** — `"2 | 4 | 7"`-style list: the position of each Ironman within *all* the profile's races (date order). `count_ironman_races` = how many entries; the values show how deep into their racing each Ironman came.
- **Timelines (start-date ordered, `MEDIUMTEXT`):** `event_timeline` (all, tagged), `ironman_event_timeline`, `non_ironman_event_timeline`
- `created_at_mtn`, `created_at_utc`

### `behavior_segment` (sequential CASE — first match wins)
- `one_and_done` — exactly one Ironman, never raced again after it
- `repeat_ironman` — did another Ironman after the first (2+ Ironmans)
- `continued_non_ironman` — one Ironman, but kept racing afterward in non-Ironman events
- `lapsed_after_ironman` — residual (rarely fires given the ordering above)

---

## Performance notes

- **History build (`#2`):** `CREATE … AS SELECT` and the index build are run + timed separately
  (`history_create_table`, `history_create_indexes`). The `CREATE` dominates because the source table has
  no index on `id_profile_rr`; the lever to speed it is an index on
  `all_participation_data_with_membership_match.id_profile_rr` (a shared-table change — see step_3).
- **Batch loop (`#3`):** uses **keyset range paging** on `id_profile_rr` (no 50k-value `IN()` list) and a
  **materialized, indexed per-batch slice** (`im_participation_2_history_batch`), so the behavior CTEs scan
  a tiny table instead of re-filtering the full history five times.
- **Timelines** require `SET SESSION group_concat_max_len = 1000000` (set inside the insert).

---

## Caveats

- **Right-censoring:** someone whose last Ironman was recent (e.g. 2025) has had no time to "continue,"
  so the 12/24/36-month and year+1/+2/+3 retention fields under-state retention for recent cohorts.
  Filter cohorts to those old enough to be observed before drawing conclusions.
- **Rule maintenance:** the allow-list reflects only reviewed event names. Re-run the ambiguous-name
  query periodically (names containing `70.3`/`140.6` without "ironman") to catch new official venues.
- **Allow-list lives in two styles:** `ironman_rule.js` (JS, imported) and the two scratch `.sql` files
  (mirrored by hand) — keep them in sync if you change the rule.

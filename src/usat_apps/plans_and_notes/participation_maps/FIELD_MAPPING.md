# Field mapping — participation maps (live MySQL)

## Architecture (Phase 1, final)
The dashboard reads **pre-aggregated summary tables**, not the 6M-row raw table (which times out on
live `COUNT(DISTINCT)`). The ETL builds them right after the parent table:

- **step_3i** (`src/participation_data/step_3i_create_participation_summary.js`) creates
  `all_participation_data_with_membership_match_summary` (per year/month × state|region|national) and
  `all_participation_data_with_membership_match_flows` (per year/month × home→event), then indexes them.
- **step_3j** loads both to BigQuery (`membership_reporting`), same pattern as the other tables.
- Both are wired into `step_0_run_participation_data_jobs_031425.js` right after the parent build.
- The reporting app (`store/participation_read.js`) reads the summary/flows tables (a few hundred rows)
  → instant loads. `store/participation_agg.js` rolls the summary rows up into the 36 metrics.

**Region note:** the event region uses the parent's **`region_name`** column (from the `region_data`
join on `state_code_events`) — it's complete and correct for all 50 states (incl. TN = Southeast). Do
NOT use `region_name_events` (a different, patchy source). Home region = `region_data` joined on
`member_state_code_addresses`.

## Raw source
Source table: **`usat_sales_db.all_participation_data_with_membership_match`** (read-only).
Grain: one row per participation = **`id_rr`**. Query lives in `store/participation_read.js`; the
per-year roll-up (36 metrics) is `store/participation_agg.js` (a 1:1 port of the POC's `build3`).

Validated against the POC on BigQuery (2025): **CA (by event state) = 33,236**, **US 50-state total =
292,675**. The dev MySQL is an older snapshot, so numbers won't match exactly — but the *logic* does.

## ⚠ Race-side vs membership-side columns (critical — this caused real bugs)
The parent table carries **two** sets of event columns: each participation row is joined both to the
**race the athlete ran** and to the **event tied to that athlete's membership purchase**. Reporting
stats must always use the **race-side** columns.

| Use (race-side) | NOT (membership/sales-side) | Why it matters |
|---|---|---|
| `name_events_rr` | `name_events` | `name_events` is the membership-purchase event, not the race. `MAX(name_events)` per event mislabeled everything as the alphabetical max — e.g. every race showed "Visit Panama City Beach IRONMAN…". |
| `id_events_rr` | `id_events` | `id_events` is the sales event id (~3× more distinct), so `COUNT(DISTINCT id_events)` inflated the **Events** metric (CA 2024: 471 vs correct 78). |
| `id_race_rr` | — | race id — already correct (Races metric). |
| `id_sanctioning_events` | — | **event grain** (1:1 with a physical race event); the events table groups on this. |
| `state_code_events`, `city_events`, `zip_events`, `region_name`, `start_date_races` | member address fields | already race-side. |

**IRONMAN:** use the existing **`is_ironman` flag**, materialized upstream in `step_1` from the single
source of truth `src/queries/ironman_rule.js`, rolled up as `MAX(is_ironman = 1)` per event. Do **not**
re-derive a name regex in JS/React — that both over- and under-flags (`step_3c` uses the flag the same way).

**De-quoting:** `name_events_rr` / `city_events` are stored quoted; strip in SQL with
`TRIM(BOTH '"' FROM TRIM(col))` (same pattern as `step_3c`), not in React.

**Where metrics are computed:** event-row derived metrics (per-race, %s, home %, per-participant) are
computed in the **SQL** (`step_3i` events builder); the app read `evToRow` is a straight column→array map.
Summary/matrix ratios are derived client-side on **aggregated raw counts** only because multi-year/month
selections re-aggregate — the raw counts themselves still come from SQL.

## Keys & buckets
| Concept | Column |
|---|---|
| Participation (grain) | `id_rr` |
| Race / Event ids (race-side) | `id_race_rr` / `id_events_rr` (NOT `id_events`) |
| Event grain (one row per event) | `id_sanctioning_events` |
| Year / Month | `start_date_year_races` / `start_date_month_races` |
| **Event state** (the map keys on this) | `state_code_events` — restricted to the 50 states |
| **Home state** (the athlete) | `member_state_code_addresses` |
| Region (event / home) | derived from state via the app's region map (`ab2region`) |

## Metric fields
| Metric | Logic |
|---|---|
| Participants (turnout) | `COUNT(id_rr)` |
| Events / Races | `COUNT(DISTINCT id_events_rr)` / `COUNT(DISTINCT id_race_rr)` (race-side ids) |
| Adult (per event/race) | age bin ≥ 20 (`age_as_race_results_bin IN 20-29 … 90-99`) |
| Female / Male | `gender_code = 'F'` / `'M'` (NB excluded from the split) |
| Age bands | `age_as_race_results_bin`: **4-19** = (4-9)+(10-19); 20-29; 30-39; 40-49; 50-59; **60+** = (60-69…90-99); `bad_age` excluded |
| Home / Away / Unknown | Home = `member_state_code_addresses = state_code_events`; **Unknown home** = `member_state_code_addresses IS NULL OR NOT IN (50 states)`; **Away = turnout − Home − Unknown** (member is one of the 50 and ≠ event). Reconciles: Home + Away + Unknown = turnout. Home % = Home ÷ (Home + Away), the known-home basis. |
| IRONMAN | `is_ironman = 1` |
| New / Repeat | New = `member_created_at_category_starts_mp = 'created_year'`; Repeat = turnout − New |
| Unique athletes | `COUNT(DISTINCT id_profiles)` |
| Cross-state flows | home→event `COUNT(id_rr)` where both are 50-state and home ≠ event |

## Field values (profiled on BigQuery, ~2025)
- `is_ironman` → `1` (IRONMAN) / `0`
- `gender_code` → `M`, `F`, `NB` (rare)
- `member_created_at_category_starts_mp` → `created_year` (new) / `after_created_year` (repeat)
- `age_as_race_results_bin` → `4-9, 10-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80-89, 90-99, bad_age`

## Coverage (populated share, 2025 on BigQuery)
- event state, gender, age, IRONMAN, new/repeat: **~100%**
- home state (`member_state_code_addresses`): **~90%** populated with a 50-state code. The remainder
  (~11% in 2024: ~9% null/blank + ~2.5% a non-50 code like DC/territory/foreign/military) is now bucketed
  as **Unknown home** — its own metric — NOT folded into Away (that was the old behavior)
- `id_profiles` (unique): ~96%

## Notes
- The choropleth "Participants" keys on **event state**, not home state (CA hosts more races than its
  residents run — 33,236 vs 26,860). Home/Away is the local-vs-visitor split *within* the event state.
- US total (292,675) is the **50-state sum**; events in DC / territories are excluded from the map.
- `build_from_mysql()` runs annual + monthly aggregates (state, region, flows, national, events). Set
  `REPORTING_STRICT_DB=1` to surface DB/column errors instead of falling back to the fixture while tuning.

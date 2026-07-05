# Field mapping — participation maps (live MySQL)

Source table: **`usat_sales_db.all_participation_data_with_membership_match`** (read-only).
Grain: one row per participation = **`id_rr`**. Query lives in `store/participation_read.js`; the
per-year roll-up (36 metrics) is `store/participation_agg.js` (a 1:1 port of the POC's `build3`).

Validated against the POC on BigQuery (2025): **CA (by event state) = 33,236**, **US 50-state total =
292,675**. The dev MySQL is an older snapshot, so numbers won't match exactly — but the *logic* does.

## Keys & buckets
| Concept | Column |
|---|---|
| Participation (grain) | `id_rr` |
| Race / Event ids | `id_race_rr` / `id_events` |
| Year / Month | `start_date_year_races` / `start_date_month_races` |
| **Event state** (the map keys on this) | `state_code_events` — restricted to the 50 states |
| **Home state** (the athlete) | `member_state_code_addresses` |
| Region (event / home) | derived from state via the app's region map (`ab2region`) |

## Metric fields
| Metric | Logic |
|---|---|
| Participants (turnout) | `COUNT(id_rr)` |
| Events / Races | `COUNT(DISTINCT id_events)` / `COUNT(DISTINCT id_race_rr)` |
| Adult (per event/race) | age bin ≥ 20 (`age_as_race_results_bin IN 20-29 … 90-99`) |
| Female / Male | `gender_code = 'F'` / `'M'` (NB excluded from the split) |
| Age bands | `age_as_race_results_bin`: **4-19** = (4-9)+(10-19); 20-29; 30-39; 40-49; 50-59; **60+** = (60-69…90-99); `bad_age` excluded |
| Home / Away | Home = `member_state_code_addresses = state_code_events`; Away = turnout − Home (unknown home counts as away) |
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
- home state (`member_state_code_addresses`): **~90%** (the ~10% without a membership-address match
  count as "away"/unknown origin, same as the POC)
- `id_profiles` (unique): ~96%

## Notes
- The choropleth "Participants" keys on **event state**, not home state (CA hosts more races than its
  residents run — 33,236 vs 26,860). Home/Away is the local-vs-visitor split *within* the event state.
- US total (292,675) is the **50-state sum**; events in DC / territories are excluded from the map.
- `build_from_mysql()` runs annual + monthly aggregates (state, region, flows, national, events). Set
  `REPORTING_STRICT_DB=1` to surface DB/column errors instead of falling back to the fixture while tuning.

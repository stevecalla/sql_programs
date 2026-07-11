# IRONMAN definition — reference card

**Single source of truth:** `src/queries/ironman_rule.js` → `ironman_event_predicate(col)`
Import it wherever the rule is needed; never re-hardcode the logic.

---

## The rule

An event is an official IRONMAN if its **name contains "ironman"**, OR it is on the curated allow-list
of official IRONMAN races whose names omit "ironman":

```sql
(
      LOWER(<name_col>) LIKE '%ironman%'
   OR <name_col> LIKE '%Augusta 70.3%'     -- IRONMAN 70.3 Augusta
   OR <name_col> LIKE '%IM 70.3 Maine%'    -- IRONMAN 70.3 Maine
   OR <name_col> LIKE '%Steelhead 70.3%'   -- IRONMAN 70.3 Steelhead (Maytag)
)
```

**Included** (examples): IRONMAN Lake Placid · IRONMAN 70.3 Boulder · 2022/2023 Augusta 70.3 ·
IM 70.3 Maine · Maytag 70.3 Steelhead 70.3

**Excluded** — independent same-distance races that are *not* IRONMAN-branded:
Howlin Half 70.3 · Marthas Vineyard 70.3 · ShrineMan 70.3 · White Mountains Triathlon 70.3 ·
Racing for Recovery … 70.3

---

## Why curated (not a simple LIKE)

Event name alone can't cleanly separate official IRONMAN from independent same-distance races, because
both put `70.3` in the name and some official races omit "ironman." The two simple rules were both wrong:

| Rule | Problem |
|---|---|
| Broad: `%ironman%` OR `%70.3%` OR `%140.6%` (legacy) | Over-counts — pulls in Howlin Half, Marthas Vineyard, etc. |
| Strict: `%ironman%` only | Under-counts — misses Augusta 70.3, IM 70.3 Maine, Steelhead 70.3 |

The curated allow-list is the middle ground: `%ironman%` **plus** an explicit list of official venues.

---

## Distance bucket (`im_distance_bucket`)

Derived only when the event is IRONMAN (built on top of the rule in `step_3e`'s `#2` history):

- `ironman_70_3` — name has `70.3`/`half`, or `name_distance_types = 'Long'`
- `ironman_140_6` — name has `140.6`/`full`, or `name_distance_types = 'Ultra'`; also the **default** for any IRONMAN event not classified as 70.3
- `non_ironman` — everything else

---

## Where the rule is applied

| File | Use |
|---|---|
| `src/queries/ironman_rule.js` | **Definition** (`ironman_event_predicate`) |
| `src/queries/participation_data/step_3e_create_ironman_profile_table.js` | `#1` participant filter + `#2` `is_ironman_event` / `im_distance_bucket` |
| `src/queries/participation_data/step_1_get_participation_data.js` | participation-source `is_ironman` flag |
| `src/queries/events/step_1_get_event_data_042125.js` | events-source `is_ironman` flag |
| `src/queries/events/discovery_queries/discovery_events_usat_db.sql` | scratch — mirrored by hand |
| `src/queries/events/discovery_queries/scratch_pad_code.sql` | scratch — mirrored by hand |

---

## Maintenance

- **Add a newly-found official venue:** add one `OR <name_col> LIKE '%…%'` line to `ironman_event_predicate` in `ironman_rule.js`. Every JS consumer picks it up automatically; update the two scratch `.sql` files by hand to match.
- **Find candidates to review:** list names that contain `70.3`/`140.6` but not "ironman", then tag which are official:
  ```sql
  SELECT name_events_rr, COUNT(*) AS race_results, COUNT(DISTINCT id_profile_rr) AS profiles
  FROM all_participation_data_with_membership_match
  WHERE LOWER(name_events_rr) NOT LIKE '%ironman%'
    AND (name_events_rr LIKE '%70.3%' OR name_events_rr LIKE '%140.6%')
  GROUP BY name_events_rr ORDER BY race_results DESC;
  ```
- **Caveat:** changing the rule updates the *code* only. Materialized tables (`all_participation_data_*`, `im_participation_*`, `step_3a`, `step_3c`) reflect it after the relevant pipeline is re-run.

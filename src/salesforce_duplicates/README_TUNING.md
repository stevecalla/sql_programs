# Duplicate criteria tuning sweep

A review-only CLI that answers "how many duplicates would we get if we changed the
criteria?" It fetches the Account records **once**, then replays the matching over
many criteria combinations and prints the counts side by side — broken out by exact,
fuzzy, nickname, and the reconciled consolidated clusters, with the criteria shown.

It never touches production: the matching runs through a self-contained engine
(`src/sweep.js`) that reuses the low-level scoring primitives but does **not** modify
`exact.js` / `fuzzy.js` / `consolidate.js`. Output goes to its own folder, a sibling
of the production output (see "Where output goes").

## Files

```text
sweep_duplicates.js   the CLI (snapshot / run / detail / diff)
sweep_grid.json       the default, editable criteria grid
src/sweep.js          the pure engine (expand_grid, run_profile, diff_profiles)
tests/sweep.test.js   unit tests
```

## How to run

From the menu (`node menu.js`), the **DUPLICATE TUNING** section:

```text
14. Sweep snapshot — TEST         fetch records once (dev sandbox) and cache them
15. Sweep snapshot — PRODUCTION   fetch records once (production) and cache them
16. Run sweep (grid over snapshot) replay the grid; print summary + table; write CSV
17. Sweep detail (one profile)    drill into one profile -> matched-pairs CSV
18. Sweep diff (two profiles)     pair-level diff between two profiles -> CSV
19. Open tuning folder            the snapshot + sweep CSVs
```

Items 17 and 18 are interactive: after a sweep has run, they read
`sweep_summary.csv` and show the profiles as a numbered list **with each
profile's key counts inline** (threshold / nickname / fields, then
exact / fuzzy / nickname / consolidated, then the Δ-vs-baseline) — the same
figures as the comparison table — so they're easy to tell apart. You pick by
number (or type a label). The list is fully dynamic: edit `sweep_grid.json`,
re-run the sweep, and the picker reflects the new profiles. Example:

```text
  Available profiles  (label — threshold/nickname/fields · counts · Δ vs baseline):
     1. baseline           t90 nickON gbz  exact:9,299 fuzzy:329 nick:944 consol:10,512  baseline
     2. t88_nickON_z5_gbz  t88 nickON gbz  exact:9,299 fuzzy:417 nick:944 consol:10,594  Δ +85/-0
     3. t88_nickON_z5_gb   t88 nickON gb  exact:15,970 fuzzy:816 nick:1,639 consol:17,921  Δ +10,153/-337
```

The picker prints a **KEY** first that decodes the labels and columns:

```text
label  =  t<thr>_nick<ON|OFF>_z<zipTrim>_<fields>     e.g. t88_nickON_z5_gbz
  thr      fuzzy name-score threshold a pair must reach (higher = stricter)
  nick     nickname matching ON/OFF (Bill<->William, etc.)
  z<n>     ZIP trimmed to first n digits (z5 = production)
  fields   required matching fields — g=gender  b=birthdate  z=zip  (gbz = all three)
  counts   exact=exact-dup groups · fuzzy=fuzzy pairs · nick=nickname pairs · consol=consolidated clusters
  Δ        matched pairs vs baseline:  +gained / -lost
```

So `t88_nickON_z5_gbz` reads as "threshold 88, nicknames on, ZIP trimmed to 5,
requiring gender + birthdate + zip." The typical flow is
**14/15 → 16 → 17 or 18 → 19**.

Or directly:

```bash
# 1. take a snapshot (fetch once). Same flags as the finder:
node sweep_duplicates.js snapshot --test            # dev sandbox, capped
node sweep_duplicates.js snapshot --test --full     # dev sandbox, ALL records (Bulk)
node sweep_duplicates.js snapshot --prod --partial  # production, capped sample
node sweep_duplicates.js snapshot --prod            # production, full

# 2. replay the grid over the snapshot (no Salesforce — reads the cache):
node sweep_duplicates.js run                        # default grid (sweep_grid.json)
node sweep_duplicates.js run --grid my_grid.json    # a custom grid

# 3. drill in:
node sweep_duplicates.js detail "t88_nickON_z5_gbz" # matched pairs for one profile
node sweep_duplicates.js diff "baseline" "t88_nickON_z5_gbz"   # pair-level diff
```

The snapshot step is the only one that hits Salesforce. After that, `run` / `detail` /
`diff` are instant and offline, so you can iterate on the grid freely.

## What the console shows

`run` prints a block per profile, then a comparison table. Each block shows the
**conditions**, the **funnel** (records → eligible → blocks → pairs compared), the
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

## The grid (`sweep_grid.json`)

Each key is an axis; the sweep runs the **cartesian product** of all axes, with the
current production logic (`baseline`) always included first. Edit it freely.

```json
{
  "fuzzy_threshold": [88, 90, 92],
  "nickname_enabled": [true, false],
  "rule_fields": [
    ["gender", "birthdate", "zip"],
    ["gender", "birthdate"],
    ["birthdate", "zip"]
  ],
  "zip_trim_len": [5],
  "weight_first": [0.45],
  "weight_last": [0.55],
  "nickname_last_name_min_score": [90]
}
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
  snapshot.json                          the cached records (re-used by run/detail/diff)
  sweep_summary.csv                      the comparison table (all profiles)
  sweep_detail_<profile>.csv             matched pairs for one profile (detail)
  sweep_diff_<a>__<b>.csv                pair-level diff between two profiles
```

Being a sibling (not inside the output folder) keeps the sweep CSVs out of the Slack
`/scheduled` uploads and the archive rotation — the same reason the `meta` folder is
separate. Set `SWEEP_TUNING_DIR=<path>` to override the destination.

## Testing

```bash
node --test tests/sweep.test.js
```

The engine is pure and fully unit-tested (grid expansion, the funnel/signal counts,
threshold/nickname/rule-field behavior, and the pair-level diff). Tests never touch
Salesforce or any output folder.

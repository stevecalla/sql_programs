# Nickname Matching + Consolidated Output — Final Plan

![The nickname plan at a glance: two jobs and four files](nickname_plan_diagram.png)

*Plan at a glance (full source in `nickname_plan_diagram.svg`). Detail follows below.*

**Status: PLANNED (not yet implemented).** This is the design record for adding a
third name-comparison dimension (nicknames) and a final consolidated output that
reconciles exact, fuzzy(90), and nickname matches. Nothing here is built yet; the
current pipeline still produces only the three baseline files described in
`README.md`.

**Guiding principle — additive and behavior-preserving.** The existing exact,
fuzzy-pair, and fuzzy-group outputs stay byte-for-byte unchanged so they remain a
regression-safe baseline. `exact.js` and `fuzzy.js` are *not rewritten or
re-invoked differently*. All new behavior lands in new modules and new output
files.

---

## 1. Why nicknames

Both existing passes score names with Levenshtein distance only
(`src/matcher.js → similarity_score`). That structurally cannot catch nicknames,
because the strings genuinely differ:

```text
Bob   vs Robert    first-name score ~17   (combined ~63, below threshold 90)
Bill  vs William   first-name score ~0
Liz   vs Elizabeth first-name score ~30
```

With identical gender + birthdate + composite ZIP these are almost always the same
person, but today they never clear `FUZZY_THRESHOLD = 90`. Nicknames are the
specific gap Levenshtein leaves open. This is a **first-name-only** concern;
surnames do not have nicknames.

---

## 2. The package: `nicknames-curated`

```bash
npm install nicknames-curated
```

- Version `0.2.1`, license **Apache-2.0** (compatible).
- Wraps the well-known hand-curated carltonnorthern nicknames dataset — "US given
  names + diminutives," exactly on target.
- Ships **both** CommonJS and ESM builds (`require` and `import` exports) plus
  TypeScript types. This repo is CommonJS, so `const { NickNamer } = require('nicknames-curated')`
  works — **verify this at install time** since the package is ESM-first.

### API

```js
const { NickNamer } = require("nicknames-curated");
const nn = new NickNamer();

nn.nicknamesOf("alexander"); // Set { "al", "alex", ... }
nn.canonicalsOf("al");       // Set { "alexander" }
```

Three properties that drive our wrapper design:

1. **The relationship is directional.** `al` is a nickname of `alexander`, but
   `alexander` is not a nickname of `al`. A one-way lookup is not enough.
2. **Two nicknames of the same root are not directly linked.** `bob` and `bobby`
   both map to `robert`, but `nicknamesOf("bob")` does not contain `bobby`.
3. Capitalization and surrounding whitespace are ignored; unknown names return an
   empty set.

It also exposes `defaultNamesData()` so we can **merge org-specific pairs** with the
default dataset (e.g. add `["elizabeth", "has_nickname", "liz"]`) — a small,
reviewable custom-additions list living in the repo.

### Our wrapper: `src/nicknames.js`

A pure-style module (mirrors `normalize.js` / `matcher.js`) that owns a single
`NickNamer` instance (loaded once for performance) and defines our own
**symmetric** equivalence, since the package's relation is directional:

```text
are_nickname_equivalents(a, b) is TRUE when, after cleaning:
    b ∈ nicknamesOf(a) ∪ canonicalsOf(a)        (a→b either direction)
 OR a ∈ nicknamesOf(b) ∪ canonicalsOf(b)        (b→a either direction)
 OR canonicalsOf(a) ∩ canonicalsOf(b) ≠ ∅        (shared root: bob ~ bobby)
 AND clean_name(a) !== clean_name(b)             (identical names are not "nickname" matches)
```

The shared-root clause catches `Bob ~ Bobby` (both → Robert), which the package's
one-directional lookups miss. The equivalence function takes the `NickNamer` (or a
fake) as an injectable dependency so it stays unit-testable without the real
dataset.

---

## 3. Output model: three single-signal views + one reconciled view

The current pipeline stays exactly as it is and remains the baseline. Two new files
are added:

```text
(a) account_duplicates_sf_import.csv             exact groups        UNCHANGED  (group-shaped)
(b) account_fuzzy_name_matches_sf_import.csv     fuzzy(90) pairs     UNCHANGED  (pair-shaped)
    account_fuzzy_name_groups_sf_import.csv      fuzzy(90) groups    UNCHANGED  (group-shaped)
(c) account_nickname_name_matches_sf_import.csv  nickname pairs      NEW        (pair-shaped)
(d) account_consolidated_duplicates_sf_import.csv all signals        NEW        (cluster-shaped)
```

The model is **three single-signal review lenses + one reconciled view**:

```text
(a) exact         — what whole-key-identical matching caught
(b) fuzzy(90)     — what Levenshtein name matching caught
(c) nickname      — what nickname equivalence caught
(d) consolidated  — all three reconciled into clusters  ← single source of truth
```

(a), (b), and (c) each answer "what did *this one detector* find?" (d) is the only
output you would ever import or act on. Because (d) reconciles everything, overlap
between the lenses is an inspectable feature, not a competing-source-of-truth
problem. `nickname` needs no separate *group* file — (d) plays the grouping role for
all signals.

---

## 4. Two jobs: find the matches, then decide what each file shows

The design hinges on splitting two jobs the current tool does in one breath:

- **Job 1 — find all the matches.** Go through the records and work out who matches
  whom ("Bob Smith and Robert Smith are the same person"). This produces one big pile
  of match links. (Elsewhere this is called *edge generation* — it just means "do the
  matching.")
- **Job 2 — decide what each file shows.** Each output file displays *some* of those
  links. One file may hide certain matches; another shows them all. (Elsewhere this is
  called *view eligibility* — it just means "what gets printed in this file.")

Today these are glued together: when fuzzy matching runs, it *also* decides "skip
anyone already in the exact file" in the same step. The plan separates them: **do the
matching once, completely, for everyone — then let each file choose what to display.**

That split answers "why does (b) exclude (a) but (c) include (a)?" Excluding the
exact records is a Job-2 *display choice* of file (b), not a Job-1 *matching choice*.
The matches are the same for everyone; the files just choose differently. Concretely,
if Job 1 finds:

```text
Bob Smith    ↔ Robert Smith   (nickname)
Robert Smith ↔ Robert Smith   (exact — two identical records)
```

then Job 2 shows:

```text
(a) exact        the two identical Roberts
(b) fuzzy        hides anything touching those Roberts          (its old habit)
(c) nickname     Bob ↔ Robert, tagged "Robert is also in exact"
(d) consolidated Bob + both Roberts merged into one group        (single source of truth)
```

### The complete rule-eligible pool

"Complete pool" everywhere below means: all fetched records that have the three
mandatory rule fields **gender + birthdate + composite ZIP**. That gate is
universal — it already applies to baseline fuzzy and applies to nickname too;
nickname relaxes only the first-name comparison, never the rule gate. "Complete"
specifically means exact-duplicate records are **not** removed from this pool.

### Why (b) excludes (a) but (c) does not — and why that's fine

This difference is **not a principle**; it is a consequence of freezing the
baseline. The original tool removed exact-duplicate records from fuzzy at the record
level for two reasons that made sense when there was no reconciler: avoid the same
records appearing redundantly across standalone files, and trim the O(n²) work.

With (d) now the single source of truth, that exclusion is no longer desirable in
principle — overlap is informative. In a from-scratch design (b) and (c) would be
treated identically. They differ only because we cannot touch (b) without breaking
the regression baseline, whereas (c) is new and gets the better design. The two-layer
split keeps the difference confined to *presentation*, and makes *detection* uniform:

```text
                 JOB 1: FIND THE MATCHES                 JOB 2: WHAT THIS FILE SHOWS
(a) exact        exact grouping over all records         groups with count > 1            (baseline, unchanged)
(b) fuzzy view   baseline fuzzy.js, post-exact-exclusion exact records excluded           (baseline, UNCHANGED)
(c) nickname     nickname over the COMPLETE pool         all nickname edges, each tagged
                                                         in_exact_group / also_clears_fuzzy
(d) consolidated exact + fuzzy + nickname edges,         none — every edge feeds UnionFind
                 ALL recomputed over the COMPLETE pool
```

The key line is the last one: for (d), **all three edge types are generated on the
complete pool**, not just nickname. This matters because the exclusion gap is not
nickname-specific. Example: two exact-dup "Robert Smith"s plus a "Robbert Smith"
typo at the same DOB/ZIP — baseline (b) excluded the Roberts, so even that *fuzzy*
edge was never computed. If (d) reused only (b)'s post-exclusion fuzzy edges it would
merge exact↔nickname but silently miss exact↔fuzzy. Recomputing every signal on the
complete pool for (d) removes the asymmetry uniformly.

### Implementation note — keep the baseline path literally untouched (Approach B)

To guarantee (a)/(b) stay byte-for-byte identical, do **not** rewire the existing
`exact.js`/`fuzzy.js` invocation to "generate then filter." Keep the current path
exactly as-is to produce (a) and (b). Then add a **separate consolidation layer**
that generates fuzzy + nickname edges over the complete pool (reusing the same pure
helpers from `matcher.js` / `nicknames.js`) to feed (c)'s flags and (d)'s clusters.
This recomputes fuzzy comparisons twice — once post-exclusion for (b), once
complete-pool for (d) — but the complete pool is only marginally larger (exact
records are a small fraction), so the cost is modest, and it makes regression safety
trivial to prove (the baseline code never changed).

---

## 5. Managing overlap between the lists

Three mechanisms keep overlap coherent.

### 5a. Precedence ladder (per edge)

Each edge is classified at its highest-precedence reason:

```text
Exact          whole-key identical (last+first+gender+birthdate+zip)
  ↓
Fuzzy(90)      Levenshtein combined name score >= 90  (+ strict rule match)
  ↓
Nickname       first names interchangeable           (+ strict rule match)
```

The nickname check for (d) runs inside the same rule-block iteration the fuzzy
comparison uses (same gender+birthdate+ZIP block), so there is no extra O(n²) pass.

### 5b. Single emission + dual flags (fuzzy ↔ nickname overlap)

Inside (d), a pair that qualifies on **both** spelling and nickname (e.g.
`Jonathan`/`Johnathan` that are also dictionary-linked) is emitted once, with both
signals recorded:

```text
spelling_match_flag = 1
nickname_match_flag = 1
match_path          = "nickname"   (label precedence default; see Open Decisions)
```

The standalone nickname file (c) is a *single-signal view*, not a competing source
of truth: it lists nickname-qualifying pairs and carries an `also_clears_fuzzy` flag
so its overlap with (b) is visible inline. The reconciled answer always lives in (d).

### 5c. Exact ↔ nickname / exact ↔ fuzzy interaction

Because (d)'s edges are all generated on the complete pool (Section 4), a person who
is an exact duplicate of one record **and** a nickname (or fuzzy) match to a third
lands in one cluster. The baseline files still behave as before; only (d) reflects
the merged cluster.

### 5d. Auditing the overlap

Mirror the existing `pairs_skipped_*` counters and run-summary block with:

```text
nickname_pairs_found
pairs_matched_spelling_only
pairs_matched_nickname_only
pairs_matched_both
clusters_with_exact / with_fuzzy / with_nickname
```

Plus a reviewable nickname-fire summary written to the **meta folder** (parallel to
`zip_trim_mapping.csv`): which canonical groups fired and how often, so a reviewer
can sanity-check the dictionary like the ZIP-trim review.

---

## 6. Hierarchy inside the consolidated file (d)

(d) is cluster-centric: each cluster is a connected component from unioning all
edges via the existing `UnionFind` in `src/grouping.js`. The hierarchy works at two
levels.

**Strength ranking (cluster level): Exact > Fuzzy(90) > Nickname.** Exact is
near-certain; fuzzy sits above nickname because spelling proximity is self-evident
while nickname leans on the curated dictionary being correct. (That last ordering is
a judgment call — adjustable.) It is used three ways:

```text
1. Confidence tier   — each cluster's tier = the strongest signal present in it.
                       any exact edge → "exact"; else any fuzzy → "fuzzy"; else "nickname".
2. Row ordering      — clusters sorted by tier (most confident first), then cluster
                       size, then best pair score (mirrors the baseline files' sort).
3. Provenance flags  — has_exact / has_fuzzy / has_nickname stay on every cluster and
                       are NON-exclusive; a single cluster can be 1/1/1.
```

**Label precedence (edge level).** Each link keeps its own `match_path` in the
edge-reason detail. The only ambiguous edge is one that is simultaneously fuzzy and
nickname; its label defaults to "nickname" (more explainable), but `has_fuzzy=1`
still holds, so the cluster tier is unaffected by the tiebreak.

---

## 7. Files to add / change

### New

```text
src/nicknames.js          NickNamer singleton + symmetric are_nickname_equivalents (pure-style)
src/consolidate.js        consolidation layer: complete-pool edge generation (exact+fuzzy+nickname)
                          + UnionFind clustering + provenance rows
data/nickname_custom.js   (optional) org-specific additions merged via defaultNamesData()
tests/nicknames.test.js   equivalence: bob/robert, bob/bobby (shared root), unknowns, casing
tests/consolidate.test.js cluster tiers + provenance flags + exact↔nickname/exact↔fuzzy merges
README_NICKNAME.md        this document
```

### Changed (additive only — baseline detection path untouched)

```text
package.json              add dependency: nicknames-curated@^0.2.1
config.js                 ENABLE_NICKNAME_MATCHING flag,
                          NICKNAME_OUTPUT_FILE name (c), CONSOLIDATED_OUTPUT_FILE name (d),
                          NICKNAME_LAST_NAME_MIN_SCORE (last-name bar on the nickname path)
src/matcher.js            add nickname flag + first_name_nickname_match_reason helpers
                          (similarity_score itself UNCHANGED — preserves exact behavior)
src/sf_rows.js            add to_sf_nickname_row (c) + to_sf_consolidated_row (d) mappers
step_1_find_duplicates.js after the 3 baseline writes: write nickname view (c),
                          then build + write consolidated (d). Baseline calls unchanged.
schema.md                 nickname + consolidated columns (if imported to Salesforce)
README.md / CLAUDE.md     cross-reference this plan (done)
```

> Note: `src/fuzzy.js` is intentionally **not** in the changed list. Baseline (b) is
> produced by the existing fuzzy path as-is; the consolidation layer does its own
> complete-pool fuzzy edge generation by reusing the pure `matcher.js` helpers.

### No Salesforce import yet — but built SF-ready

We are **not importing into Salesforce right now**, so there is **no Salesforce admin
work and no fields to create in the org yet**. But we ARE prepping for a *possible
future* import, so the output columns still follow the **Salesforce naming
conventions** the existing files already use (the `__c` suffix style, via
`sf_rows.js`-style mappers). That way, if (c)/(d) are ever imported later, the columns
line up with no rework. For now they live only in CSV/Excel files for review.

### Output format — match the existing files

(c) and (d) are produced with the **same machinery and look** as the baseline files,
so all four are uniform:

```text
- written by the same CSV writer (src/output_files.js)
- same timestamped filenames (date/time appended before .csv)
- same archive rotation (prior run moved to the archive folder)
- same column style/conventions as the sibling files
- same run-summary + step-timer integration (see "Make sure everything is updated")
```

---

## 8. Risks & mitigations

```text
Gendered collisions (Alex → Alexander vs Alexandra)
    Mitigated: the strict rule requires the SAME gender, so cross-gender nickname
    collisions can't fire.

False-positive inflation
    Mitigated: the nickname path keeps the mandatory gender+birthdate+ZIP gate;
    it relaxes ONLY the first-name comparison.

ESM-first package in a CommonJS repo
    Mitigated: package ships a require export; verify at install.

Double fuzzy computation (baseline + complete-pool for d)
    Accepted: complete pool is only marginally larger; keeps the baseline path
    literally untouched, making regression safety trivial to prove.

Dictionary coverage / surprises
    Mitigated: reviewable nickname-fire summary in the meta folder + optional
    custom-additions list merged via defaultNamesData().
```

---

## 9. Open decisions (defaults chosen; easy to flip)

```text
1. Consolidated (d) + nickname (c) destination
   DECIDED: review-only analysis CSVs now (NOT imported to Salesforce; no SF admin
   work yet). But keep SF __c column naming so a future import is plug-and-play.

2. Label precedence when an edge is BOTH fuzzy and nickname
   DEFAULT: match_path = "nickname" (more specific / more explainable).
   Alt: match_path = "fuzzy_spelling". (Both flags recorded either way.)

2b. Contents of the standalone nickname file (c)
   DEFAULT: ALL nickname-equivalent pairs, each with in_exact_group +
   also_clears_fuzzy flags (self-describing; filter to subsets as needed).
   Alt: nickname-ONLY pairs (the incremental catches beyond fuzzy(90)).

3. Last-name bar on the nickname path
   DEFAULT: last name must be an exact clean match OR score >= FUZZY_THRESHOLD.
   Rationale: nicknames relax the first name; keep the last name strict.

4. Cluster strength order in (d)
   DEFAULT: Exact > Fuzzy(90) > Nickname.
   Alt: treat Fuzzy and Nickname as equal-confidence.

5. Fuzzy threshold everywhere
   DEFAULT: keep 90 (baseline and consolidated) so the views are comparable.
```

---

## 10. Make sure everything is updated (definition of done)

Not done until every one of these reflects (c) and (d). Explicitly includes the CLI
run timer.

```text
Code wiring
[ ] config.js            new filenames + ENABLE_NICKNAME_MATCHING + thresholds
[ ] step_1 orchestrator  write (c) and (d) after the unchanged baseline writes
[ ] archive rotation     prior-run (c)/(d) moved to the archive folder like the rest
[ ] src/output_files.js  reuse the same CSV writer for (c)/(d)

CLI run timer + summaries  (the part easy to forget)
[ ] step timer           timer.stage_done("nickname matching") and
                         timer.stage_done("consolidation") so both appear in the live
                         [STEP] lines AND the end-of-run "largest first" timeline
[ ] run summary          add nickname-pair count, consolidated-cluster count, and the
                         (c)/(d) output paths to the printed summary + run_summary.json
[ ] meta summary         nickname-fire summary in the meta folder (like zip_trim)

CLI menu
[ ] menu.js              confirm run items still work and the open-output-folder item
                         shows the new files; add menu entries only if needed

Tests
[ ] new tests            tests/nicknames.test.js + tests/consolidate.test.js
[ ] regression           existing suites still pass; baseline files byte-identical

Docs
[ ] README.md            add (c)/(d) to Output Files + Recommended Review Order;
                         update the step-timer example and run-summary example to
                         show the new stages + counts
[ ] CLAUDE.md            keep the planned-section in sync (done as we build)
[ ] README_NICKNAME.md   flip "PLANNED" wording to shipped state at the end
[ ] schema.md            note (c)/(d) columns (analysis-only; no SF import)

Optional (only if you use Slack delivery — not required for analysis)
[ ] Slack report         add nickname/consolidated to the file= options + stat counts
                         (server_salesforce_duplicates_8017.js, step_2 report, message)
```

## 11. Implementation order (when we proceed)

```text
1. npm install nicknames-curated; verify CommonJS require works.
2. src/nicknames.js + tests/nicknames.test.js (pure; no pipeline changes yet).
3. matcher.js: add nickname flag + reason helpers; extend matcher tests.
4. src/consolidate.js + tests/consolidate.test.js:
   complete-pool edge generation (exact+fuzzy+nickname) → UnionFind → clusters
   with tiers + provenance flags.
5. config.js + sf_rows.js + step_1 wiring: write nickname view (c) and
   consolidated (d) AFTER the unchanged baseline writes.
6. Step-timer stages (nickname + consolidation) + run-summary counters + paths +
   meta-folder nickname-fire summary.
7. Update README.md / CLAUDE.md / schema.md (incl. timer + summary examples) to
   reflect shipped state; run the Section 10 checklist.
8. VALIDATE: diff baseline files before/after (must be byte-identical);
   spot-check (c) flags and (d) clusters/tiers against the nickname-fire summary.
```

---

## 12. Safety note

Unchanged from the baseline tool: this remains **read-only** against Salesforce. It
never updates, merges, or deletes records — it only reads `Account` data and writes
CSV files locally for human review.

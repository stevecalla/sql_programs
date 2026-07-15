# Restore Diff — Plan + As-Built

**Status:** Phase 1 + Phase 2 IMPLEMENTED. Phase 1 = read-only diff (current live vs pre-merge
snapshot). Phase 2 = **field-level selective restore** — keep specific current values instead of
resetting them to the snapshot. Both shipped.

## Phase 2 as built (selective restore)

- **The diff is now actionable.** `RestoreDiffDetail.jsx` renders a **"Keep current"** checkbox on
  every *differing* field. Ticking it means "leave this field at its live value; don't reset it to the
  snapshot." Kept rows show the snapshot value struck through and a green "keep live" state. The
  selection is lifted to the Restore page (`onKeepChange(id, fields[])` → `keepBySet`).
- **Wire-through.** The Restore page sends `keep_fields` = `{ [queueId]: [fieldApiNames] }` for the
  sets being restored (`api.mergeRestore(ids, { …, keep_fields })` → route → enqueued run `opts`).
- **Backend enforcement.** `master_reset_fields(masterFields, survivorId, keep)` now takes a keep set
  and omits those fields from the survivor patch; `restore()` reads `opts.keep_fields[e.id]` per set,
  applies it in STEP 1 (survivor reset), and reports `reset_fields` / `kept_fields` (in the run result
  + history reason, and a `would reset N, keep M` line in the Simulate preview).
- **This is the review/acknowledgment mechanism** — stronger than the merge side's binary "merge
  anyway", because the operator chooses per field. Restore stays user-initiated + typed `RESTORE`, so
  no separate skip-gate is needed.
- **Recreate path too.** The same diff expander + Keep-current now appears on the **Recreate queue**
  (purged losers), and `recreate()` honours `keep_fields` on its survivor reset — parity with restore.

## Audit artifact (diff persisted to history)

Every merge/restore/recreate history row now carries a `diff_json` column (`merge_history` — additive
`diff` field on `write()`, parsed back by `list()`):
- **Merge** rows store `{ kind: 'merge_drift', fields: [{ account, field, before, after }] }` — the
  exact fields that drifted since staging.
- **Restore / Recreate** rows store `{ kind: 'restore'|'recreate', reset: [{ field, value }], kept: […] }`
  — which fields were reset (and to what snapshot value) and which the operator kept at their live value.
So the field-level detail is durable and queryable, not only a live-panel view.

Phase 1 recap below.

## As built (v1)

- **Store:** `store/restore_diff.js`. `build_master_diff(master, current)` is the pure builder —
  per-field `{ field, before (snapshot), after (live), state }` where state is `match` / `differ` /
  `missing`, plus a summary `{ matched, differ, missing, total }` and an `in_sync` flag. It compares
  only the fields a restore would reset (mirrors `master_reset_fields`: non-system, non-empty snapshot
  values) and uses **normalized equality** (trim + collapse whitespace + lower-case, ZIP→first 5) so
  formatting noise isn't flagged as drift. `diff_for_entry(queueId, deps)` loads the pre-merge
  snapshot (`merge_snapshot.list_for_entry`), live-fetches the survivor's current values
  (`salesforce_read.fetch_accounts_by_ids` with the compared fields), builds the diff, and reports
  each loser's recoverability state (`merge_restore.account_states`: deleted / live / missing).
  Injectable deps; fully unit-tested (`tests/restore_diff.test.js`).
- **Endpoint:** `GET /api/salesforce-merge/merge/restore/diff?id=<queueId>` (gated). One single-record
  live read per view; wrapped so a bad field/permission returns `fetch_error` instead of a 500.
- **UI:** a **Diff** expander on each row of *Completed merges* on the Restore page
  (`components/RestoreDiffDetail.jsx`, lazy-loaded on expand). Shows a headline — green "already
  matches the pre-merge snapshot — a restore would change no fields" when `in_sync`, else amber "N of
  M fields differ…"; the loser recoverability chips; and a Field / Pre-merge (snapshot) / Current
  (live) / State table with a **Differences only** toggle (default on) and colour-coded rows.
- **Deviations from the original spec:** v1 is all-or-nothing, so there's no separate "Restore writes"
  column (for a differing field, restore writes = the snapshot value). Field API names are shown (not
  labels). Losers are listed with a recoverability state rather than a field-by-field diff. Capturing
  the diff into merge history as an audit artifact is not yet done.

---

## Original design (for reference)

**Status:** Design only. A read-only "diff" view for the Restore workflow so an operator can see
exactly what a restore will change *before* confirming it. Additive; no change to the merge/restore
write path in the first phase.

## Why

Restore today is effectively blind. In simulate/preview the operator only sees "eligible / N
children to re-point," then types `RESTORE` and the code:

1. undeletes the losers from the Recycle Bin (original ids), or recreates them from the snapshot,
2. re-points their children back to their original parents, and
3. resets the survivor's overwritten master fields from the pre-merge snapshot
   (`master_reset_fields` in `merge_restore.js`).

Step 3 is the one nobody sees. A diff turns restore into an informed decision:

- **Real pre-flight preview** — the same "two-key" guardrail the forward merge has, which restore
  currently lacks: see which survivor fields the merge overwrote and what restore would set them back
  to.
- **Post-merge-edit conflict detection (highest-value)** — if the survivor was edited *after* the
  merge, restore will silently overwrite those newer values with the old master values. The diff is
  the only thing that surfaces this. If current == pre-merge for every field, the restore is
  low-risk (it just brings losers/children back).
- **Foundation for selective restore (later phase)** — once field-level changes are visible, the UI
  can let an operator restore losers + children while *keeping* specific current field values.
- **Audit artifact** — capture the diff into merge history for a record of what each restore changed.
- **Snapshot validation** — a missing/partial snapshot becomes obvious before restore relies on it.

## Applies to both restore paths — especially the Recycle Bin path

- **Recycle Bin restore (primary, ≤15 days).** When Salesforce undeletes a loser, it returns in its
  state as of deletion — which equals the pre-merge snapshot. So the diff's "these accounts return
  with these values" preview is trustworthy here, *and* it shows the survivor reset. This is the path
  operators will run most, so it's where the diff earns its keep.
- **Recreate-from-backup (secondary, losers purged).** Same survivor-reset diff; the loser side is
  "recreated with NEW ids" (external refs won't reconnect), which the view should label clearly.

## Data — all the hard parts already exist

- **The "before" side is already captured.** Every merge writes `salesforce_merge_premerge_snapshot`
  (`merge_snapshot.js`): one row per record in the set, with `role` (survivor/loser/child) and a
  `fields` JSON blob holding that record's full field values at merge time. Retrieved per set via
  `merge_snapshot.list_for_entry(queue_id)`.
- **The "current" side is a live read that already exists elsewhere.** `cluster_detail.js` already
  does live-fetch-with-snapshot-fallback for the forward preview — reuse it to fetch the survivor's
  current field values (read-only, env-aware).
- **The "what restore writes" side is already defined.** `master_reset_fields(masterFields,
  survivorId)` is the exact field set restore writes (skips system fields, drops null/empty). The
  diff must mirror it so the preview matches reality.

## The view: a three-column field diff

For the survivor account, one row per field:

| Field | Pre-merge (snapshot) | Current (live) | Restore writes |

- Flag `changed` when Current ≠ Pre-merge (the merge altered it).
- Flag `will_overwrite` when Restore-writes ≠ Current (restore will change the live value).
- Default to showing changed/affected fields, with a "show unchanged" toggle.

Alongside the survivor diff:

- **Losers that return** — id, name, a few key fields (the snapshot has their full field set). On the
  recreate path, mark them "NEW id."
- **Children** — count of child links to re-point (already known to restore).

## Build outline (phase 1 — read-only, additive)

1. **Pure diff builder** (new, unit-testable) — input: snapshot rows + live survivor fields; output:
   `{ survivor: [{field, pre_merge, current, restore_writes, changed, will_overwrite}], losers: [...],
   children_count }`. Mirrors `master_reset_fields` so "restore writes" is accurate.
2. **Read-only endpoint** — `GET /api/merge/restore/diff?id=<queueId>`, gated by the `restore` panel;
   loads the snapshot, live-fetches the survivor (reusing `cluster_detail`'s fetch + fallback),
   returns the diff object.
3. **UI** — a "View diff" expander on each restorable row of the Restore page, mirroring the forward
   preview's survivorship table, with changed rows highlighted.
4. **Tests + docs** — unit tests on the pure builder (fake snapshot + fake live record) in the
   `node:test` pattern; update README + this doc.

**Effort:** ~half a day to a day. No new writes, no change to the restore execution path. Only new
runtime cost is one single-record Salesforce read per diff view (governor-friendly, snapshot
fallback when SF is unreachable).

## Deliberately deferred — phase 2 (separate, gated)

**Field-level selective restore** — let the diff deselect fields from the survivor reset. This
touches the write path (`master_reset_fields` gains an allow/deny list) and needs its own safety
gating + confirm flow, so it should not ride along with the read-only diff.

## Open decisions

- Diff against **live current** (recommended, with snapshot fallback) vs **snapshot-only** (offline,
  but can't detect post-merge edits).
- Default to **changed-only** fields vs **all** fields (with toggle).
- **API names vs human labels** for fields — labels are a deferrable readability nicety.
- Whether to diff **losers** field-by-field or just list them (they're recovered wholesale, so a list
  is usually enough).

# Restore Diff — Plan (spec, not yet built)

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

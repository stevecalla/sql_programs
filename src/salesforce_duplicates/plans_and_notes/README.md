# plans_and_notes — index

Design and planning docs for the Salesforce duplicates tool. The root project docs
(`README.md`, `CLAUDE.md`, `schema.md`) live one level up; everything here is design detail.

## Shipped features

| Doc | What it covers |
|---|---|
| `README_NICKNAME.md` | Nickname matching + the consolidated/reconciled output (view c + d). |
| `README_SQL.md` | SQL backbone — stream the snapshot into `usat_sales_db`, detect off the DB. |
| `README_TUNING.md` | Duplicate-criteria tuning sweep (compare counts across criteria). |
| `README_MERGE_ID_FIELD.md` | The Salesforce merge-ID field (`usat_Salesforce_Merge_Id__pc`): auto-detect + carry into every output. |
| `README_MERGE_ID_REVIEW.md` | Merge-ID review (QA): reconcile our duplicates vs Salesforce merge IDs; the 7th view + SQL workbench queries. |

## Planned (not built) — now its own project

The **merge management tool** moved to its own project: **`src/salesforce_merge/`** (sibling of
`salesforce_duplicates`). Its planning docs live in `../../salesforce_merge/plans_and_notes/`:

| Path (under `src/salesforce_merge/plans_and_notes/`) | What it covers |
|---|---|
| `README_MERGE_TOOL.md` | The merge management web tool — plan, architecture, read-vs-write safety, app-shell/React, data extraction, restore. |
| `PHASE_0_KICKOFF.md` | Phase 0 kickoff + what's needed to build. |
| `mockups/` | Screen mockups of the six pages (`.svg` sources + `.png`). |
| `reference/README_MERGE_EXECUTION.md` | How a merge actually runs (Node-primary): master rule, restore tiers, Contact-Point preservation. |
| `reference/apex/` | Optional Apex merge endpoint (class + test + `DEPLOY.md`). |

## Naming note — the three "merge" docs

- `README_MERGE_ID_FIELD.md` — the merge-ID **field** (data, here).
- `README_MERGE_ID_REVIEW.md` — the merge-ID **review/QA** (shipped reconciliation, here).
- `../../salesforce_merge/plans_and_notes/README_MERGE_TOOL.md` — the merge **management tool** (planned app, separate project).

## Presentation artifacts (outside the repo)

Decks and diagrams live in the OneDrive project folder `salesforce_duplicate_code/`:
`Duplicate_Criteria_Recommendation.pptx`, `Nickname_Plan.pptx`, `duplicate_rule_explained.md`,
`nickname_plan_diagram.png`, `sql_backbone_plan_diagram.svg`.

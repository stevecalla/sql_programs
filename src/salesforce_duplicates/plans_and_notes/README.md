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

## Planned (not built)

| Path | What it covers |
|---|---|
| `merge_tool/README_MERGE_TOOL.md` | The merge management web tool — plan, architecture, read-vs-write safety, app-shell/React, data extraction, restore. |
| `merge_tool/mockups/` | Screen mockups of the six pages (`.svg` sources + `.png`). |
| `merge_tool/reference/README_MERGE_EXECUTION.md` | How a merge actually runs (Node-primary): master rule, restore tiers, Contact-Point preservation. |
| `merge_tool/reference/apex/` | Optional Apex merge endpoint (class + test + `DEPLOY.md`). |

## Naming note — the three "merge" docs

- `README_MERGE_ID_FIELD.md` — the merge-ID **field** (data).
- `README_MERGE_ID_REVIEW.md` — the merge-ID **review/QA** (shipped reconciliation).
- `merge_tool/README_MERGE_TOOL.md` — the merge **management tool** (planned app).

## Presentation artifacts (outside the repo)

Decks and diagrams live in the OneDrive project folder `salesforce_duplicate_code/`:
`Duplicate_Criteria_Recommendation.pptx`, `Nickname_Plan.pptx`, `duplicate_rule_explained.md`,
`nickname_plan_diagram.png`, `sql_backbone_plan_diagram.svg`.

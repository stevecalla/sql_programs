# Plan — Intake tabs + /metrics dashboard add-ons

Living plan + progress tracker. **No code until approved.** Two independent tracks: **A** (dashboard) and
**B** (the intake card becomes a tab bar). Update tests + docs as each item lands.

Status legend: ⬜ not started · 🟡 in progress · ✅ done.

---

## Progress tracker

**A. /metrics dashboard**
- ✅ A1 — Test-transaction count on the dashboard (`health.test_rows` + readout)
- ✅ A2 — "Uploads today" question chip (`#ask-suggest`)
- ✅ A3 — Purge-test-rows button (`/api/metrics-purge-test` + confirm + reload)

**B. Intake card → tab bar**
- ✅ B0 — Tab bar + heading rename + a11y (4-tab `role="tablist"`, "Get Race Results")
- ✅ B1 — "From Folder" tab folded into `#sfTable` (standalone `#folderCard` later **removed** after parity check)
- ✅ B2 — "Slack Ironman" tab (under-construction placeholder)

> **Review done — standalone card removed.** Parity was confirmed, so the standalone "Convert files from a
> folder" card and its `wire_folder` / `folder_*` code were deleted; the **From Folder tab** is now the only
> folder intake (two shared helpers — `folder_is_spreadsheet`, `folder_fmt_modified` — are kept). `folder_flow.spec.js`
> was repointed at the tab. Revert path for the whole intake/dashboard work: `git checkout public/index.html
> public/js/app.js public/css/app.css metrics/` (+ the `/api/metrics-purge-test` route in the 8018 server).

---

## Locked decisions

| Topic | Decision |
|---|---|
| Tab labels | **SF Upload Queue · SF Email Queue · From Folder · Slack Ironman** (Salesforce tabs prefixed "SF"). |
| Card heading | Rename "Get Race Results from Salesforce" → **"Get Race Results"**. |
| Folder card | Kept the standalone `#folderCard` during the compare, then **removed it** once the tab proved out (the From Folder tab is now the only folder intake). |
| Folder table | **Fold into the shared `#sfTable`** via a folder column set (`File name · Type · Modified`) — consistent tabbed UX; differences handled by a source-specific control row + action. |
| a11y | The bar becomes a proper **`role="tablist"`** with `role="tab"` + `aria-selected` + linked panels (passes axe; correct semantics now that there are 4 real tabs). |
| Chip wording | Suggestion chip **"Uploads today"** seeds *"How many uploads today, and list them in a table"*. |

---

## A. /metrics dashboard

### A1 — Test-transaction count
- `metrics/metrics_report.js` `build_report`: add `health.test_count = COUNT(*) WHERE is_test = 1`
  (column already exists; same `get_pool` path).
- `metrics/metrics_dashboard.html`: show it in the **DB-health strip** (rows · size · last-data · **test rows**).
- Tests: `tests/metrics_report.test.js` asserts `test_count` in the report shape. Docs: ANALYTICS_PLAN/CLAUDE note.

### A2 — "Uploads today" chip
- `metrics/metrics_dashboard.html`: add one button to `#ask-suggest` — label **"Uploads today"**, seeds the
  composer with *"How many uploads today, and list them in a table"*. The ask engine already handles
  list/recent queries and formats `created_at_mtn` in Mountain Time, so no engine change.
- Test: `e2e/metrics_dashboard.spec.js` (chip present). Docs: CLAUDE ask-box note.

### A3 — Purge-test-rows button
- Engine exists: `retention.purge_test` / `metrics.purge_test` (`DELETE … WHERE is_test = 1`).
- Server: **auth-gated** `POST /api/metrics-purge-test` (`require_dash_auth`) → `purge_test` → `{ deleted }`.
- Dashboard: a **"Purge test rows (N)"** button beside the A1 count; **confirm** dialog → POST → reload report.
  Touches only `is_test = 1` (real + Try-Me/demo rows untouched).
- Tests: route-exists assertion; existing `tests/metrics_retention.test.js` covers `purge_test`. Docs: CLAUDE/README.

---

## B. Intake card → tab bar

Today: a 2-way toggle (Upload/Email) inside the SF card, **plus** a separate "Convert files from a folder"
card. Target: one **"Get Race Results"** card with a 4-tab bar, the standalone folder card kept (for now).

### B0 — Foundation (tab bar + heading + a11y)
- `index.html`: rename heading; turn `#sfSourceSeg` into a **tablist** of 4 tabs
  (`SF Upload Queue · SF Email Queue · From Folder · Slack Ironman`) with `role="tab"` + `aria-selected`.
- `app.js`: `sf_set_source` grows to 4 cases — each shows its **own control row** + the right panel, hides the
  others. Add `.sf-folder-only` / `.sf-slack-only` control classes alongside the existing
  `.sf-upload-only` / `.sf-email-only`.
- `app.css`: tab styling (reuse `.seg`), placeholder styling.
- Tests: `sf_ui.test.js` (4 tabs, tablist roles, heading). Docs: CLAUDE/README.

### B1 — "From Folder" tab
- The folder tab reuses the shared `#sfTable` with a **folder column set** in `sf_columns()`
  (`File name · Type · Modified`), reusing the existing sort/search/select/count UI.
- Its **control row** is a folder picker (Choose folder + the `webkitdirectory` fallback), not the date row;
  its **primary action is "Load"** (local — bytes already in the browser, no server fetch) which routes the
  selected files into the **same Files queue** (`build_queue(... source:'folder')`).
- Implementation reuses the existing `folder_choose` / `folder_from_input` / file-reading logic; it populates
  `S.sf_files` with folder records and renders via `sf_render` (folder columns). **The standalone `#folderCard`
  stays untouched** so both exist during evaluation.
- Differences handled: no date/status/sanction/sender; source-specific control row; "Load" vs "Download";
  missing-meta highlighting off (no program/sanction concept for folder).
- Tests: `sf_ui.test.js` (folder tab + columns); existing folder tests still apply. Docs: CLAUDE/README.
- **Checkpoint:** you compare the in-tab folder vs the standalone card.

### B2 — "Slack Ironman" tab
- 4th tab; `sf_set_source('slack')` shows a **"cool" under-construction placeholder** panel
  (centered card, 🚧 + a short on-brand "Slack Ironman submissions — coming soon" line), hiding all other
  controls/tables. No functionality yet.
- Tests: `sf_ui.test.js` (tab + placeholder present). Docs: a one-liner.

---

## Open questions / risks
- **B1 download/queue path**: folder files skip the server "Download" step — the tab's action builds the
  queue directly. Need to make sure the shared download bar reads "Load" (not "Download") for the folder tab.
- **Two folder UIs temporarily** (tab + standalone card) is intentional for the compare; remove the standalone
  in a follow-up once approved.
- **Selection model**: folder records get a stable id (e.g. the relative path) used like `content_version_id`
  so the shared `S.sf_selected` map + checkboxes work unchanged.
- If the folded-in folder table feels worse than the standalone card, fall back to embedding the existing
  `#folderTable` as the tab's panel instead (less consolidation, zero change to folder rendering).

# USAT Sanctioned Event Analysis — Project Brief

## What this project does

Compares two years of USAT sanctioned event CSV data (2025 vs 2026) and produces:
- **Excel workbook** — 12-tab deep-dive analysis (`output/2026_event_calendar_analysis_v9f.xlsx`)
- **PowerPoint deck** — 8-slide executive summary (`output/event_trends_summary_v3.pptx`)
- **HTML dashboard** — interactive filterable roster + charts (`output/dashboard.html`)

Everything is generated dynamically from CSV data. With an Anthropic API key in `.env`, Claude writes all commentary and insights; without one, a rule-based fallback produces equivalent output. Pass `--no-ai` (or `--rule-based`) to force rule-based even when the key is set — handy for iterating on formatting without burning tokens. Menu option **2** ("Build (rule-based only)") wires that flag for you.

The AI call (~70s) dominates build time, so `build_all.js` ships a **commentary cache**: it hashes a whitelist of fields commentary actually reads (years, segments, by-type counts, monthly aggregates, organic delta, calendar impact, override count) and stamps the hash onto `commentary.json` as `_input_hash`. Next build: hash match → reuse the prior commentary, no API call. Hash miss → fresh AI call. Manual overrides: `--fresh-ai` (menu option **3**) bypasses the cache; `--stale-ai` (CLI flag only) forces the cache even when the hash drifted. Excluded from the hash: event names, sanction IDs, confidence, override row contents — so source-data typo fixes don't burn tokens, but real aggregate shifts always do.

Every build also posts a one-line status to `#steve_calla_slack_channel` via the shared `utilities/slack_messaging/slack_message_api.js` helper (same channel + same env var the participation-data and event-data jobs use: `SLACK_WEBHOOK_STEVE_CALLA_USAT_URL`). Success: `:white_check_mark: event_analysis build · 7.3s · ai_claude (cached) · 2025→2026 net -12`. Failure: `:x: event_analysis build FAILED · 12.1s · <first line of error>`. Suppress with `--no-slack`. A failed Slack post is logged but never breaks the build.

---

## How to run

```bash
node check.js                   # validate data quality before building (always run first)
node build_all.js               # generate Excel + PowerPoint + dashboard (~80s w/ AI, ~7s cached, ~7s NO_AI)
node build_all.js --no-ai       # same as above, but force rule-based commentary (no Claude tokens)
node build_all.js --fresh-ai    # bypass commentary cache, force a fresh Claude call
node build_all.js --no-db-roster   # same outputs, but skip the event_analysis_roster INSERT + retention prune
node build_all.js --no-slack    # suppress the Slack notification on completion
node menu.js                    # interactive feature launcher (34 options across 7 sections — incl. PREFERENCES toggle for showing CLI equivalents)
node build_all.js --baseline-year 2026 --analysis-year 2027   # ad-hoc: run a different year pair without editing .env
node ask.js                     # Q&A + override management CLI (DB-backed)
node server_event_analysis_8016.js   # from repo root — local read-only API at http://localhost:8016
node --test tests/              # run every *.test.js (overrides + server + menu + smoke + glossary + downloads + build + roster)
```

> Interactive override editing in the browser (Step 9) is still pending — for now the server is read-only and you manage overrides via `ask.js`.

---

## Current data state

| | 2025 | 2026 | Net |
|---|---|---|---|
| **Active events** | 1,178 | 1,166 | −12 (−1.0%) |

**Segment breakdown:**
| Segment | Count | Notes |
|---|---|---|
| Retained | 746 | Same event, same month both years |
| Shifted | 124 | Same event, different month |
| Tried to Return | 13 | 2025 active → 2026 cancelled (actionable!) |
| Lost | 295 | 2025 active, no 2026 equivalent |
| Recovered | 30 | 2025 cancelled → 2026 active |
| New | 266 | 2026 active, no 2025 equivalent |

**Data source:** event data is pulled live from `usat_sales_db.event_data_metrics` at build time (no CSV fallback). Manual overrides live in the `usat_sales_db.event_analysis_overrides` MySQL table; `data/overrides.json.migrated` is the renamed historical JSON file and is no longer read at runtime.

---

## Folder structure

```
event_analysis/
├── CLAUDE.md                    ← this file
├── build_all.js                 ← master build entry point
├── check.js                     ← data quality + override validation
├── ask.js                       ← interactive CLI Q&A + DB-backed override commands
├── menu.js                      ← interactive feature launcher
├── package.json
├── .env                         ← ANTHROPIC_API_KEY + DB credentials
├── data/
│   ├── overrides.json.migrated  ← historical JSON, no longer read by runtime
│   └── overrides_example.json   ← template for reference only
├── tests/
│   ├── overrides.test.js        ← schema + apply + approve + stale (DB)
│   ├── server.test.js           ← local server read/write API + /api/build SSE (DB)
│   ├── menu.test.js             ← menu.js wiring: unique ids/actions, required actions present (cheap)
│   ├── smoke.test.js            ← parse-check + require-check every major source file (cheap)
│   ├── glossary.test.js         ← dashboard glossary: <details> collapsed, every required term present (cheap)
│   ├── downloads.test.js        ← dashboard Excel/PowerPoint Download buttons resolve to real files (cheap)
│   ├── build.test.js            ← commentary cache: hash stability + sensitivity + insensitivity + loader (cheap)
│   └── roster.test.js           ← per-build roster snapshot: pure-function row builder + DB insert + retention pruning (DB-backed)
├── utilities/
│   ├── ensure_overrides_table.js   ← idempotent schema setup (auto-runs every build)
│   └── migrate_overrides_to_db.js  ← one-shot JSON → DB migration (auto-runs every build)
├── output/
│   ├── dashboard.html           ← interactive HTML dashboard
│   ├── <year>_event_calendar_analysis_<ts>.xlsx
│   ├── <year>_event_trends_summary_<ts>.pptx
│   ├── analysis_results.json    ← top-line summary
│   ├── analysis_state.json      ← full state snapshot (consumed by ask.js)
│   └── commentary.json          ← all generated narrative text
└── src/
    ├── loader.js                ← row → event-object parsing
    ├── normalizer.js            ← event name normalization
    ├── matcher.js               ← 3-pass fuzzy matching algorithm
    ├── analysis.js              ← derives all segment counts + metrics
    ├── calendar.js              ← calendar effect (Sat/Sun day shifts)
    ├── commentary.js            ← rule-based + AI commentary engine
    ├── overrides.js             ← DB-backed override loading + application
    ├── db.js                    ← usat_sales_db connection + queries
    ├── dashboard.js             ← generates dashboard.html
    ├── pptx/builder.js
    └── excel/
        ├── builder.js           ← orchestrates all Excel sheets
        └── sheets/              ← one file per Excel tab (12 sheets)
```

---

## Core architecture

### Matching algorithm (`src/matcher.js`)
Three-pass fuzzy matching:
1. Exact sanction ID match
2. Exact sanction ID, shifted month (Shifted segment)
3. Jaccard similarity ≥ 0.55 on normalised name tokens + date-proximity weighting

After matching, `crossMatch()` finds:
- **Tried to Return**: 2025 active → 2026 cancelled/declined (same event name)
- **Recovered**: 2025 cancelled → 2026 active (same event name)

`reclassify()` uses **exact sanction IDs** (not names) to avoid false positives where sibling events share a name.

### Segment key facts
- Internal JS arrays still use `attrited` / `triedToReturn` as variable names — only display strings say "Lost" / "Tried to Return"
- `segments.attrited` = Lost events in code; `seg.Lost` = count in dashboard/KPIs
- Recovered: 30 events (was 33, fixed — 3 false positives removed by type-matching tightening)

### Overrides — DB-backed (`usat_sales_db.event_analysis_overrides`)

Three override types are applied after automatic matching:

| Type | Effect |
|---|---|
| `force_match` | Pair two specific events → Retained (same month) or Shifted (different month) |
| `force_no_match` | Unlink a matched pair — requires both sids; assigns per-side segments (default: baseline → Lost, analysis → New) via `segment_baseline` / `segment_analysis` columns |
| `force_segment` | Force any event into a specific segment (`Retained` / `Shifted` / `Lost` / `New` / `Recovered` / `Tried to Return`) |

**Read path:** `src/overrides.js → load_overrides()` is async, year-scoped, and queries the DB for `active = 1` rows matching the current `BASELINE_YEAR` / `ANALYSIS_YEAR` plus any globals (both year columns `NULL`). Unapproved rows still apply but emit a build-time warning.

**Write path:** every `ask.js` CLI command (`--add-override match|no-match|segment`, `--remove-override`, `--approve`, `--unapprove`) writes the DB directly. `--remove-override` is a soft delete (sets `active = 0`) so the audit trail survives. New rows are tagged `created_by` = `cli` (CLI), `json_migration` (one-time import), or `test_suite` (auto-cleaned). Append `--global` to any `--add-override` to scope NULL/NULL.

**Approval lifecycle (Step 5):** un-approved overrides apply but emit a build-time warning. `--approve <sid>` flips `approved=1`, sets `approval_state='approved'` + `approved_by` + `approved_at`, and snapshots the current event(s) into `event_signature_baseline` / `event_signature_analysis`. `--unapprove <sid>` clears the approval columns + signatures (audit fields preserved).

**Stale detection (Step 6):** every build, `apply_overrides()` recomputes `{name}|{month}|{type}|{status}` for each event referenced by an approved override and compares to the stored snapshot. On drift it flags the applied record, calls `mark_overrides_stale()` to flip `approval_state='stale'` in the DB, and emits a `⚠ [stale approval]` warning naming the changed fields. `--list-overrides` renders stale rows with a `⚠ stale` badge until re-approval (refreshes the signature) or removal.

**Schema setup:** `utilities/ensure_overrides_table.js` runs at the top of every build — idempotent `CREATE TABLE IF NOT EXISTS` plus column/index upgrades for both year-scoping (Step 2.5) and signature columns (Step 6). `utilities/migrate_overrides_to_db.js` is the one-shot JSON importer; once the JSON has been migrated it's renamed `overrides.json.migrated` and ignored.

The interactive dashboard override editor (over an Express server) is step 7 on the ladder and isn't built yet — manage overrides via `ask.js` for now.

---

## Dashboard features

Open `output/dashboard.html` in a browser (a hosted version is on the roadmap as step 7).

| Feature | Details |
|---|---|
| Type strip cards | Adult Race / Youth Race / Adult Clinic / Youth Clinic — count, delta, organic % |
| KPI row | Net change (with totals + %), Retained, Lost, New, Recovered — all show count + % |
| 5 charts | Monthly count, Type count, Monthly delta, Segment donut, Weekend shifts |
| Chart flip | ⇄ Table button on each chart — flips to data table with Δ abs + Δ % columns |
| Chart expand | ⤢ Expand — opens modal; expands chart OR table depending on current view |
| Event roster table | All matched pairs, sortable, filterable |
| Year-dynamic headers | All paired-year column labels (`Mo`, `Sanction ID`, `Date`, `Day`, `Event Name`, `Status`) and chart dataset labels read from `ya`/`yb` (= `results.years.BASELINE_YEAR` / `ANALYSIS_YEAR`). Excel download link's filename also year-dynamic. Rolls over to e.g. 2026 vs 2027 without source edits. |
| Column order (per year) | `Mo · Sanction ID · Date · Day · Event Name · Status` — Date and Day are now adjacent. |
| KPI cards with denominators | Row-2 cards show count + % + italic "of N {year} events" caption so the denominator is explicit. Retained / Shifted / Lost / TTR divide by `n_baseline`; New / Recovered divide by `n_analysis`. |
| Roster search | Matches name OR sanction ID across either year — partial-prefix paste (e.g. `311655` or `311655-Adult Race`) works |
| Multi-select filters | Segment / Type / Month / **Status** dropdowns with color-coded checkboxes. Status options are populated dynamically from the unique `Status YA` / `Status YB` values present in the roster. |
| Active filter bar | Shows current filters as removable chips; ↺ Reset clears all (including Status) |
| Segment / Type / Month chip bars | Three clickable chip bars above the table. Each chip shows count + `% of N shown`; clicking toggles the matching dropdown filter. All chips recompute against the visible total on every filter. Month chips count rows once per distinct month they touch (shifted events count for both their baseline AND analysis month if those differ). Bars are individually toggleable via a "Show:" pill row above them — defaults: Segments + Types visible, Months hidden. Choice persists in `localStorage` (`chip_bar_visibility`). |
| Bottom-of-page glossary | Native `<details id="dash-glossary">` element (no JS), default-collapsed. Defines: the 6 segments, 5 confidence values (Exact / Exact-Shifted / Cross / Override / N/A — each with a one-line example), calendar-expected + organic delta (with a worked weekend-days arithmetic example), net change, sanction ID, active event, override lifecycle (approved/unapproved/stale), worst month, Reviewed?, Event Created. Audited in `tests/glossary.test.js` (its own suite — menu option 27) — a `REQUIRED_TERMS` list checks each term is present inside the `<details>` block, so renaming or removing a definition breaks the test. |
| Reviewed? checkbox | Row-level checkbox in the roster table. Checked → POSTs an "approved" no-op override (`force_match` for matched pairs / `force_no_match` for single-sided) tagged `created_by = 'dashboard:review'`. Unchecking DELETEs. Lives in the same `event_analysis_overrides` table as manual overrides — zero schema change, full audit trail / approval lifecycle for free. |
| Override-info optional columns | Three optional columns after Conf (override type / approved / note), toggled from ⊞ Columns. Populated client-side from `/api/overrides` whenever the override-status column refreshes. |
| Event Created optional columns | Two optional columns after Date YA / Date YB showing source-system creation date. Roster field comes from loader.js's `createdAt`, which strips `event_data_metrics.created_at_events` to YYYY-MM-DD. |
| Events-by-creation-month chart | Stacked-bar chart sourced from the same `createdAt` fields, with a year-pair dropdown (baseline / analysis). Calendar chart pushed to a smaller right slot in the same row. |
| Add-override form validation | Three-rule client-side validation runs before any POST to `/api/overrides`. (1) **Required-by-type**: `force_match` and `force_no_match` need both sidB AND sidA; `force_segment` needs the sid matching the Side dropdown. (2) **SID exists in correct pool**: at boot, `BASELINE_SIDS` and `ANALYSIS_SIDS` Sets are built by iterating the in-closure `ROSTER` const (not `window.ROSTER` — top-level const doesn't create a window property). If a sid is in the OTHER pool, emits "'X' is a [other]-year sid; move it to the [other] box". If in neither, "'X' doesn't match any event in the current roster". (3) **No self-link**: `sidB === sidA` rejected. Bad fields get `.dash-ov-input-err` (red border); messages aggregated into `#dash-ov-form-err`. `wire_form_clear` IIFE drops the red border + clears the message div when the operator edits any flagged field. Pure helper `window.dash_ov_validate_add_form({fields})` accepts a fields override map for unit testing without the DOM. 10 tests in `tests/dashboard.test.js`: err-div renders empty + CSS class present + sids built from ROSTER + missing-sidA-rejection + missing-sidB-rejection + force_segment with empty sidB rejected + unknown-sid message + same-sid rejection + valid force_match passes + valid force_segment passes. |
| Override list filters | Filter row above `#dash-ov-list` with three controls: search input (`#dash-ov-flt-search`, matches sid_baseline/sid_analysis/name_baseline/name_analysis/note, case-insensitive, fields joined with `␟` separator to prevent cross-field false positives), type select (`#dash-ov-flt-type`, options `all/force_match/force_no_match/force_segment`), and status select (`#dash-ov-flt-status`, four non-overlapping buckets: `all/approved/unapproved/stale`). `approved` = `approved && !is_stale`; `stale` = `approval_state === 'stale'`; `unapproved` = `!approved`. State persists via `localStorage('dash_ov_list_filters')`. Filter logic lives in the pure `window.dash_ov_apply_list_filters(items, filters)` helper (exposed for unit tests). When any filter is non-default, the summary line shows `Showing X of Y · ...` and the `#dash-ov-flt-clear` link is shown (calls `dash_ov_filters_clear` which resets all three to defaults and re-renders). Boot block in `dash_ov_init` reads localStorage, populates the input values, and wires `input`/`change` listeners. Covered by 12 tests in `tests/dashboard.test.js`: HTML structure + 8 apply_list_filters cases (no filter / search-by-sid / search-by-name / search-by-note / type filter / approved excludes stale / stale isolation / unapproved isolation / combined filters) + restore-from-localStorage. |
| Collapsible override editor | The override editor (`#dash-ov-editor`) is wrapped in a native `<details>` element. Default = closed for first-time visitors (it's a power-user tool). Open/closed state persists via `localStorage('dash_ov_editor_open')` — `'1'` re-opens, `'0'` or missing keeps it closed. A `toggle` event listener in `dash_ov_init` writes the new state. `dash_ov_focus_row` auto-expands the panel (and persists `'1'`) when the operator clicks a roster row, so the focus-an-event flow keeps working when the panel is collapsed. The server-status pill (`#dash-ov-srv-status`) lives inside the `<summary>` so connection state is visible while collapsed. CSS hides the native disclosure marker (both `::-webkit-details-marker` and `::marker`) and supplies a chevron span that rotates 90° via `[open]`. Covered by 7 tests in `tests/dashboard.test.js`: HTML structure + summary contents + 5 runtime cases (first-visit closed, '1' re-opens, '0' stays closed, toggle persists, focus_row auto-expands+persists). |
| Ad-hoc rebuild years | Collapsed `<details>` block inside `#dash-ov-rebuild-card` with baseline/analysis number inputs. Submits to `/api/build?baseline_year=Y&analysis_year=Y`, which forwards as `--baseline-year / --analysis-year` to the spawned build. Doesn't touch `.env`. **Client-side validation in `dash_ov_rebuild_with_years`** refuses the call when both inputs are blank, when either value isn't a 4-digit integer, or when either is outside `[2000, current_year+5]`. Writes the message into `#dash-ov-rebuild-years-err`; an `input` listener on each field clears the error as soon as the operator starts editing. Guards live entirely in the inline IIFE so they survive page rebuilds. Covered by 8 tests in `tests/dashboard.test.js` (HTML attribute presence + 7 runtime cases via a vm sandbox that stubs `dash_ov_rebuild` to observe whether the kickoff fired). |
| Column picker | ⊞ Columns button — show/hide Sanction ID and Date columns |
| Mobile responsive | Horizontal + vertical scroll, 60vh max-height on mobile, iOS touch scroll |

> Live override editing in the dashboard requires step 9 (interactive editor), pending. Step 7 is done — `server.js` exposes a read-only API and serves `dashboard.html` over HTTP.

---

## Local server (`server_event_analysis_8016.js`)

Lives at the repo root (`sql_programs/server_event_analysis_8016.js`) alongside the other `server_*.js` services. Default port 8016 (override via `PORT` env var). Foundation for the dashboard arc.

**Read endpoints:**

| Endpoint | Description |
|---|---|
| `GET /` | HTML index — endpoint reference + `curl` examples |
| `GET /api/status` | `{ ok, baseline_year, analysis_year, output_dir, time }` |
| `GET /api/overrides` | Current-scope + global overrides. Honours `?baseline_year=&analysis_year=` query params; defaults to env vars. Rows are enriched with `name_baseline` / `name_analysis` / `month_baseline` / `month_analysis` via a server-side join against `event_data_metrics` (helper: `fetch_event_names_for_sids` in `src/event_analysis/src/db.js`). Both editor surfaces display these inline under each sid pill; deleted events render as `(event no longer in DB)`. |
| `GET /api/build` | SSE stream of the spawned `build_all.js`. Now accepts `?baseline_year=YYYY&analysis_year=YYYY` query params (validated [2000, 2100]); forwards them as `--baseline-year / --analysis-year` CLI flags to the child. Garbage / out-of-range values are silently dropped (no 4xx) — the build just runs with default scope. |
| `ALLOWED_IPS` middleware | Dormant by default. Env var comma-separated allowlist; when set, the server rejects every request whose client IP isn't in the list with `403 {error:"forbidden", ip:"..."}`. Logs a one-time activation banner at startup + per-rejection lines at runtime. IPv6-mapped IPv4 is normalised so `127.0.0.1` matches localhost connections. Production privacy is intended to live at Cloudflare edge — this is a backstop / dev lever. |
| `GET /api/events?year=YYYY` | Events from `usat_sales_db.event_data_metrics`. Add `&include=excluded` to include CANCELLED/DECLINED/DELETED. |
| `GET /output/<file>` | Static-serves the analysis output dir (dashboard.html, JSON sidecars, archive folder) |

**Write endpoints (Step 8):**

| Endpoint | Body | Wraps |
|---|---|---|
| `POST /api/overrides` | `{ type, sid_baseline?, sid_analysis?, side?, segment?, segment_baseline?, segment_analysis?, note?, global? }` — `force_no_match` requires both sids | `cmd_add_match` / `cmd_add_no_match` / `cmd_add_segment` |
| `DELETE /api/overrides/:sid` | — | `cmd_remove_override` (soft-delete) |
| `POST /api/approve/:sid` | optional `{ approved_by }` | `cmd_approve` (captures event signatures) |
| `POST /api/unapprove/:sid` | — | `cmd_unapprove` |

**Build stream (Step 9.5):**

| Endpoint | Description |
|---|---|
| `GET /api/build` | Spawns `node src/event_analysis/build_all.js`, streams stdout/stderr line-by-line as Server-Sent Events. Event names: `out`, `err`, `done` (with exit code). Module-level `_build_running` lock returns 409 on concurrent attempts. Client disconnect kills the child. Powers the dashboard's "Rebuild now" button. |

All write endpoints validate the request before invoking the underlying `cmd_*` function (so a bad request returns 400 cleanly without risking `process.exit(1)`). Rows are tagged `created_by='server'` so HTTP writes are distinguishable from CLI / migration / test writes at the SQL level.

**Editor (Step 9) — two surfaces:**
- **Standalone SPA at `/editor/`** — plain HTML + vanilla JS in `src/event_analysis/public/`. Useful as a power-user view.
- **Dashboard-integrated panel** — embedded in the generated `output/dashboard.html`. The roster gains an "Override" status column; clicking a row focuses the editor below and prefills the sid. A sticky banner appears after edits with a **Rebuild now** button (uses `GET /api/build`'s SSE stream + auto-reloads on success).

Both surfaces hit the same write endpoints. The dashboard panel detects same-origin and gracefully degrades to "server offline" on `file://`.

Importable: `const { create_app, start_server } = require('./server_event_analysis_8016')`. Tests use `create_app()` and `listen(0)` for ephemeral-port isolation. Test suite covers ~90 cases now: ~50 overrides + ~40 server (read + write + editor static + dashboard markers + SSE stream).

CORS is open (`*`) — fine for local dev, tighten before any production hosting.

---

## Excel workbook tabs

| Tab | Description |
|---|---|
| executive_summary | KPIs, type breakdown, segment boxes, monthly table |
| step_0_calendar_structure | Sat/Sun day counts per month both years |
| step_1_event_type_by_month | Raw counts by type × month |
| step_2_calendar_impact | Calendar effect isolation |
| step_3_organic_performance | Organic delta after removing calendar effect |
| step_4_event_detail | Full event roster — all 1,474 matched pairs |
| step_4a_segment_by_month | Segment breakdown by month (2 tables) |
| step_4b_shift_flow_matrix | 12×12 matrix of month-to-month shifts |
| step_4c_shifted_events | Detail of all 124 shifted events |
| step_4d_cancelled_cross_match | TTR and Recovered events with both sides shown |
| step_5_creation_pipeline | Event creation lead-time analysis |
| monthly_reconciliation | Arithmetic check — all segments add to raw totals |

---

## Known quirks

- **Template literal escaping**: When embedding JS inside Node.js template literals, use `\x27` is also processed — use `data-seg` attributes instead of inline `'` quotes in onclick handlers (already done)
- **`\n` in template literals**: Becomes a real newline in output — breaks single-quoted JS strings. Use `String.fromCharCode(10)` or just omit
- **FUSE mount after rename**: Renaming a mounted folder on Windows causes stale inode cache. Work around: disconnect first, rename, reconnect fresh
- **Chart.js backticks**: The minified Chart.js source contains backticks — use string concatenation for the script tag, not template literals
- **Internal variable names**: `segments.attrited` is the internal name for Lost events; `segments.triedToReturn` for TTR — only change display strings, not these identifiers

---

## Terminology

| Term | Meaning |
|---|---|
| Lost | 2025 event with no 2026 equivalent (formerly "Attrited" — renamed throughout) |
| Tried to Return (TTR) | 2025 active event that re-filed for 2026 but was cancelled/declined |
| Recovered | Was cancelled in 2025, successfully ran in 2026 |
| Organic delta | Raw event count change minus the calendar effect (Sat/Sun day shifts) |
| Calendar effect | Change in event count attributable to gaining/losing weekend days in a month |
| SA / SU | Shifted Away (month 2025 lost) / Shifted Up (month 2026 gained) |

---

## Overrides ladder — what's done, what's next

| Step | Status |
|---|---|
| 1. `event_analysis_overrides` table auto-created on every build | ✓ done |
| 2. JSON → DB auto-migration on every build | ✓ done |
| 2.5. Year scoping (`baseline_year` / `analysis_year` columns + index, sid_baseline/sid_analysis rename) | ✓ done |
| 3. `analysis.js` reads from DB (async, year-scoped, surfaces unapproved warnings) | ✓ done |
| 3.5. `tests/overrides.test.js` (`node --test tests/`, menu options 25–33) | ✓ done |
| **11.** Per-build roster snapshot — `event_analysis_roster` table with full roster + `build_at` partitioning, populated by `insert_roster_snapshot.js` at the end of every build. Tiered retention via `prune_roster_table.js` (48h full / 30d daily / 90d weekly / monthly forever). Append-only historical record for trend queries and BI-tool integration. No read path yet — table is write-only. `--no-db-roster` skips the insert + prune (menu option 4 wires it). Tests in `tests/roster.test.js` (menu option 31). | ✓ done |
| **4.** `ask.js` CLI writes to DB (add / remove / list / suggest), `--global` flag, `created_by` provenance | ✓ done |
| **5.** `--approve` / `--unapprove` CLI commands. Approve flips `approved=1` + `approval_state='approved'` + `approved_by` + `approved_at`, captures event signatures. Unapprove clears approval + signatures (keeps audit fields). | ✓ done |
| **6.** Stale-approval detection. `apply_overrides()` recomputes event signatures and compares to stored snapshot; on drift the build flips `approval_state='stale'`, emits `⚠ [stale approval]` warning, and `--list-overrides` renders the row with a `⚠ stale` badge. | ✓ done |
| **7.** `server_event_analysis_8016.js` — minimal Express server at the repo root (port 8016, alongside the other `server_*.js` services). Read-only endpoints: `GET /api/status`, `GET /api/overrides` (year-scoped via query params), `GET /api/events?year=YYYY`. HTML index at `/`. Static-serves `output/` so `dashboard.html` is reachable at `/output/dashboard.html`. CORS enabled. Smoke-tested in `tests/server.test.js`. Menu option 23. | ✓ done |
| **8.** Write endpoints — `POST /api/overrides` (typed dispatch), `DELETE /api/overrides/:sid`, `POST /api/approve/:sid`, `POST /api/unapprove/:sid`. All wrap the existing `cmd_*` functions and tag rows `created_by='server'`. Stale Override Manager panel removed from `dashboard.html`. 16 new tests. | ✓ done |
| **9.** Override editor — two surfaces: (a) standalone SPA at `/editor/` (`public/{index.html,editor.css,editor.js}`); (b) dashboard-integrated panel embedded in `dashboard.html` with a new "Override" status column in the roster (click row → focus editor + prefill sid), a sticky "rebuild needed" banner that fires after edits, and a "Rebuild now" button. **Step 9.5: `GET /api/build`** streams `build_all.js` over SSE (events: `out`, `err`, `done`); 409 if a build is already running; client disconnect kills the child. Menu test runner split into 3 options. ~10 new tests covering dashboard markers + the SSE stream + the build-lock. | ✓ done |
| **11.** Roster table UX overhaul. Reviewed? checkbox (creates `force_match` for matched rows, `force_segment` for single-sided Lost / New) sits at column 3 right after Conf. Override pill + override-info columns (Override type / Approved / Override note) are optional toggles in the ⊞ Columns dropdown (with All/None buttons). All re-render paths (search, sort, filter, chip, Show all) call `refresh_status_column()` so checkbox state survives every interaction. Sort comparator handles `reviewed`, `m_baseline` / `m_analysis` (chronological by month number), and override-derived columns (`override` / `ov-type` / `ov-approved` / `ov-note`) via `_dash_ov_lookup` bridge. Date + Created cells render as combined `Mon., YYYY-MM-DD` via `fmt_date_with_day(day, date)` helper; UTC-anchored `day_of()` so weekdays don't drift by timezone. 22 tests in `tests/dashboard.test.js` (menu option 34). | ✓ done |
| **11.5.** Invariant: not active ⇒ not approved. `cmd_remove_override` clears `approved` + `approval_state` in the same UPDATE as the soft-delete; `ensure_overrides_table` runs an idempotent backfill on every build that cleans up any pre-existing violations. 4 DB tests in `tests/overrides.test.js` document and enforce the rule. | ✓ done |
| **12.** Dashboard analytics charts — new family of creation-timing charts. **Events by creation month** (stacked bars by event type, year + type filters, inline data labels, tooltip total, full action-button strip). **Creation pace** (cumulative-% line chart, baseline vs analysis curve, days-before-event-start x-axis, live hover readout + median-based "pacing AHEAD / BEHIND" conclusion line). **Creation timing — relative to event year** (grouped bars per relative-month offset; e.g. +3 = March of event year, −2 = November of prior year; year + type filters; direct YoY comparison at the same calendar position). All three register in `CHARTS` + `CHART_SNAP` so expand-modal / PNG / CSV / table-flip work uniformly. | ✓ done |
| **13.** Server: IP allowlist middleware (dormant by default). `ALLOWED_IPS` env var = comma-separated allow list. Server auto-adds the IPv6 loopback twin when the IPv4 form is present (and vice versa) so dual-stack `localhost` traffic isn't accidentally blocked. Menu **24** "Start local server (IP allowlist)" prompts for IPs and spawns with the env injected — always restricted regardless of `.env`. | ✓ done |
| 14. Cascade rules engine — pattern-based overrides ("all clinics in May named X → Lost") | pending |

## Suggested next steps (discussed but not yet built)

- **Inline segment editor in table**: Click a segment badge to change it directly, generating the appropriate override. Design fully spec'd — see conversation history for the transition logic table. Blocked on step 7/8/9.
- **Auto-syntax check before copy**: Add `node --check` on generated dashboard.html as final build step to catch JS errors before they ship.

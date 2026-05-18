# USAT Sanctioned Event Analysis — Project Brief

## What this project does

Compares two years of USAT sanctioned event CSV data (2025 vs 2026) and produces:
- **Excel workbook** — 12-tab deep-dive analysis (`output/2026_event_calendar_analysis_v9f.xlsx`)
- **PowerPoint deck** — 8-slide executive summary (`output/event_trends_summary_v3.pptx`)
- **HTML dashboard** — interactive filterable roster + charts (`output/dashboard.html`)

Everything is generated dynamically from CSV data. With an Anthropic API key in `.env`, Claude writes all commentary and insights; without one, a rule-based fallback produces equivalent output. Set `NO_AI=1` (or `RULE_BASED_ONLY=1`) to force rule-based even when the key is set — handy for iterating on formatting without burning tokens. Menu option **2** ("Build (rule-based only)") wires that env var for you.

---

## How to run

```bash
node check.js                   # validate data quality before building (always run first)
node build_all.js               # generate Excel + PowerPoint + dashboard (takes ~30s)
NO_AI=1 node build_all.js       # same as above, but force rule-based commentary (no Claude tokens)
node menu.js                    # interactive feature launcher (25 options across 6 sections)
node ask.js                     # Q&A + override management CLI (DB-backed)
node server_event_analysis_8016.js   # from repo root — local read-only API at http://localhost:8016
node --test tests/              # run every *.test.js (overrides + server + menu + smoke)
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
│   └── glossary.test.js         ← dashboard glossary: <details> collapsed, every required term present (cheap)
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
| Bottom-of-page glossary | Native `<details id="dash-glossary">` element (no JS), default-collapsed. Defines: the 6 segments, 5 confidence values (Exact / Exact-Shifted / Cross / Override / N/A — each with a one-line example), calendar-expected + organic delta (with a worked weekend-days arithmetic example), net change, sanction ID, active event, override lifecycle (approved/unapproved/stale), worst month. Audited in `tests/glossary.test.js` (its own suite — menu option 26) — a `REQUIRED_TERMS` list checks each term is present inside the `<details>` block, so renaming or removing a definition breaks the test. |
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
| `GET /api/overrides` | Current-scope + global overrides. Honours `?baseline_year=&analysis_year=` query params; defaults to env vars. |
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
| 3.5. `tests/overrides.test.js` (`node --test tests/`, menu options 21–26) | ✓ done |
| **4.** `ask.js` CLI writes to DB (add / remove / list / suggest), `--global` flag, `created_by` provenance | ✓ done |
| **5.** `--approve` / `--unapprove` CLI commands. Approve flips `approved=1` + `approval_state='approved'` + `approved_by` + `approved_at`, captures event signatures. Unapprove clears approval + signatures (keeps audit fields). | ✓ done |
| **6.** Stale-approval detection. `apply_overrides()` recomputes event signatures and compares to stored snapshot; on drift the build flips `approval_state='stale'`, emits `⚠ [stale approval]` warning, and `--list-overrides` renders the row with a `⚠ stale` badge. | ✓ done |
| **7.** `server_event_analysis_8016.js` — minimal Express server at the repo root (port 8016, alongside the other `server_*.js` services). Read-only endpoints: `GET /api/status`, `GET /api/overrides` (year-scoped via query params), `GET /api/events?year=YYYY`. HTML index at `/`. Static-serves `output/` so `dashboard.html` is reachable at `/output/dashboard.html`. CORS enabled. Smoke-tested in `tests/server.test.js`. Menu option 20. | ✓ done |
| **8.** Write endpoints — `POST /api/overrides` (typed dispatch), `DELETE /api/overrides/:sid`, `POST /api/approve/:sid`, `POST /api/unapprove/:sid`. All wrap the existing `cmd_*` functions and tag rows `created_by='server'`. Stale Override Manager panel removed from `dashboard.html`. 16 new tests. | ✓ done |
| **9.** Override editor — two surfaces: (a) standalone SPA at `/editor/` (`public/{index.html,editor.css,editor.js}`); (b) dashboard-integrated panel embedded in `dashboard.html` with a new "Override" status column in the roster (click row → focus editor + prefill sid), a sticky "rebuild needed" banner that fires after edits, and a "Rebuild now" button. **Step 9.5: `GET /api/build`** streams `build_all.js` over SSE (events: `out`, `err`, `done`); 409 if a build is already running; client disconnect kills the child. Menu test runner split into 3 options. ~10 new tests covering dashboard markers + the SSE stream + the build-lock. | ✓ done |
| 10. Cascade rules engine — pattern-based overrides ("all clinics in May named X → Lost") | pending |

## Suggested next steps (discussed but not yet built)

- **Inline segment editor in table**: Click a segment badge to change it directly, generating the appropriate override. Design fully spec'd — see conversation history for the transition logic table. Blocked on step 7/8/9.
- **Auto-syntax check before copy**: Add `node --check` on generated dashboard.html as final build step to catch JS errors before they ship.

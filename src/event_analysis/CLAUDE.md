# USAT Sanctioned Event Analysis — Project Brief

## What this project does

Compares two years of USAT sanctioned event CSV data (2025 vs 2026) and produces:
- **Excel workbook** — 12-tab deep-dive analysis (`output/2026_event_calendar_analysis_v9f.xlsx`)
- **PowerPoint deck** — 8-slide executive summary (`output/event_trends_summary_v3.pptx`)
- **HTML dashboard** — interactive filterable roster + charts (`output/dashboard.html`)

Everything is generated dynamically from CSV data. With an Anthropic API key in `.env`, Claude writes all commentary and insights; without one, a rule-based fallback produces equivalent output.

---

## How to run

```bash
node check.js          # validate data quality before building (always run first)
node build_all.js      # generate Excel + PowerPoint + dashboard (takes ~30s)
node server.js         # start local server at localhost:7474 for live override writing
node menu.js           # interactive feature launcher
node ask.js            # Q&A + override management CLI
```

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

**Data files (in `data/`):**
- `2025a_events_051526.csv` — 2025 active events
- `2026_events_051526.csv` — 2026 active events
- `2025_events_by_start_year_by_type.csv` — creation pipeline data
- `2026_events_by_start_year_by_type.csv` — creation pipeline data
- `overrides.json` — manual match/segment overrides (edit carefully)

---

## Folder structure

```
event-analysis_v2/
├── CLAUDE.md                    ← this file
├── build_all.js                 ← master build entry point
├── check.js                     ← data quality + override validation
├── server.js                    ← local Express server (localhost:7474)
├── ask.js                       ← interactive CLI Q&A + overrides
├── menu.js                      ← interactive feature launcher
├── package.json
├── .env                         ← ANTHROPIC_API_KEY goes here
├── data/
│   ├── *.csv                    ← input data files
│   └── overrides.json           ← manual overrides
├── output/
│   ├── dashboard.html           ← interactive HTML dashboard
│   ├── 2026_event_calendar_analysis_v9f.xlsx
│   ├── event_trends_summary_v3.pptx
│   └── analysis_results.json   ← cached analysis for fast rebuilds
└── src/
    ├── loader.js                ← CSV parsing + status filtering
    ├── normalizer.js            ← event name normalization
    ├── matcher.js               ← 3-pass fuzzy matching algorithm
    ├── analysis.js              ← derives all segment counts + metrics
    ├── calendar.js              ← calendar effect (Sat/Sun day shifts)
    ├── commentary.js            ← rule-based insight generation
    ├── overrides.js             ← override loading + application
    ├── dashboard.js             ← generates dashboard.html
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

### Overrides (`data/overrides.json`)
Three types:
```json
{
  "force_match":    [{ "sid_baseline": "...", "sid_analysis": "...", "note": "..." }],
  "force_no_match": [{ "sid_baseline": "...", "note": "..." }],
  "force_segment":  [{ "sid_baseline": "...", "segment": "Lost|New|Recovered|...", "note": "..." }]
}
```
Applied after automatic matching. `node server.js` + dashboard Override Manager writes these live without terminal copy-paste.

---

## Dashboard features

Open `output/dashboard.html` in a browser, or via `http://localhost:7474/dashboard` when server is running.

| Feature | Details |
|---|---|
| Type strip cards | Adult Race / Youth Race / Adult Clinic / Youth Clinic — count, delta, organic % |
| KPI row | Net change (with totals + %), Retained, Lost, New, Recovered — all show count + % |
| 5 charts | Monthly count, Type count, Monthly delta, Segment donut, Weekend shifts |
| Chart flip | ⇄ Table button on each chart — flips to data table with Δ abs + Δ % columns |
| Chart expand | ⤢ Expand — opens modal; expands chart OR table depending on current view |
| Event roster table | 1,474 rows (all matched pairs), sortable, filterable |
| Multi-select filters | Segment / Type / Month dropdowns with color-coded checkboxes |
| Active filter bar | Shows current filters as removable chips; ↺ Reset clears all |
| Segment count bar | Dynamic chips above table — clickable to toggle segment filter |
| Column picker | ⊞ Columns button — show/hide Sanction ID and Date columns |
| Mobile responsive | Horizontal + vertical scroll, 60vh max-height on mobile, iOS touch scroll |
| Override Manager | Collapsible panel — generates override commands; live-writes when server running |
| Server detection | Auto-probes localhost:7474 on load; shows green badge when connected |

---

## Local server (`server.js`)

Runs at `http://localhost:7474`. Enables the dashboard to write overrides directly without copy-paste.

| Endpoint | Description |
|---|---|
| `GET /api/status` | Health check |
| `GET /api/overrides` | Read current overrides.json |
| `POST /api/overrides/add` | Add a single override entry |
| `POST /api/overrides/remove` | Remove an override entry |
| `GET /api/rebuild` | Run build_all.js, stream output via SSE |
| `GET /dashboard` | Serve dashboard.html |

**Important:** Open the dashboard via `http://localhost:7474/dashboard` (not as a local file) for live override writing to work. Browsers block `fetch()` to localhost from `file://` pages.

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

## Suggested next steps (discussed but not yet built)

- **Inline segment editor in table**: Click a segment badge to change it directly, generating the appropriate override. Design fully spec'd — see conversation history for the transition logic table.
- **Auto-syntax check before copy**: Add `node --check` on generated dashboard.html as final build step to catch JS errors before they ship

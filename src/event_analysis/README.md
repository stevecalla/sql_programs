# USAT Sanctioned Event Analysis — event_analysis

Generates two outputs from raw CSV event data:
- **Excel workbook** (`output/2026_event_calendar_analysis_v9f.xlsx`) — 12-tab deep-dive
- **PowerPoint deck** (`output/event_trends_summary_v3.pptx`) — 8-slide summary

Everything — data, commentary, slide headers, speaker notes, and Excel narratives — is generated dynamically from the CSV data. With an Anthropic API key, Claude writes all content; without one, a rule-based engine produces equivalent output.

---

## Folder structure

```
event_analysis/
├── menu.js                 ← Interactive feature launcher (start here)
├── build_all.js            ← Entry point: node build_all.js
├── ask.js                  ← Interactive Q&A + override management
├── check.js                ← Data quality + override conflict validation
├── package.json
├── .env                    ← YOUR API KEY GOES HERE (copy from .env.example)
├── .env.example            ← Template — safe to commit
├── .gitignore
├── notes.md                ← Analyst notes + prior context (feeds into Claude)
├── README.md
│
├── data/                   ← Input CSVs + override file
│   ├── 2025a_events_051526.csv
│   ├── 2026_events_051526.csv
│   ├── 2025_events_by_start_year_by_type.csv
│   ├── 2026_events_by_start_year_by_type.csv
│   └── overrides.json          ← Manual matching overrides (edit via ask.js commands)
│
├── output/                 ← Generated files (rebuilt each run)
│   ├── 2026_event_calendar_analysis_v9f.xlsx
│   ├── event_trends_summary_v3.pptx
│   ├── dashboard.html          ← Interactive browser dashboard
│   ├── analysis_results.json   ← Full analysis dataset
│   ├── commentary.json         ← All generated narrative text
│   ├── changes.txt             ← Diff vs prior build
│   └── archive/                ← Previous versions (timestamped automatically)
│       └── 2026-05-16_143022/
│           ├── 2026_event_calendar_analysis_v9f.xlsx
│           └── event_trends_summary_v3.pptx
│
└── src/
    ├── loader.js           ← CSV parser
    ├── normalizer.js       ← Event name normalisation + fuzzy matching helpers
    ├── matcher.js          ← 3-pass event matching (exact → fuzzy → cross-match)
    ├── calendar.js         ← Weekend-day calendar impact calculations
    ├── analysis.js         ← Orchestrates matching + segment classification
    ├── commentary.js       ← Dynamic commentary engine (rule-based + Claude AI)
    └── excel/
        ├── builder.js      ← Assembles all 12 worksheet tabs in order
        ├── styles.js       ← Colour palette + ExcelJS cell helpers
        └── sheets/         ← One file per Excel tab (all snake_case)
```

---

## Setup

```bash
# 1. Install dependencies (once)
npm install

# 2. Copy env template and add your API key (optional but recommended)
cp .env.example .env
# Edit .env — paste your key from https://console.anthropic.com/api-keys

# 3. Build
node build_all.js
# or: npm run build
```

---

## Interactive Menu — menu.js

```bash
node menu.js        # launch the interactive menu
npm run menu        # same thing via npm
```

Type a number and press Enter. For features that need input the menu prompts you — no flags to remember.

The status bar at the top always shows: last build date, event totals, commentary mode (AI or rule-based), API key status, and active override count.

### All 18 features — menu number + what it runs

| # | Menu label | Equivalent command |
|---|---|---|
| **BUILD & OUTPUT** | | |
| 1 | Build everything | `node build_all.js` |
| 2 | Check data quality | `node check.js` |
| 3 | Open dashboard in browser | Opens `output/dashboard.html` |
| 4 | Open Excel workbook | Opens `output/2026_event_calendar_analysis_v9f.xlsx` |
| 5 | Open PowerPoint deck | Opens `output/event_trends_summary_v3.pptx` |
| **OVERRIDES — event matching** | | |
| 6 | List active overrides | `node ask.js --list-overrides` |
| 7 | Suggest overrides (AI) | `node ask.js --suggest-overrides` |
| 8 | Add force-match | `node ask.js --add-override match <sid_25> <sid_26> "note"` |
| 9 | Add force-no-match | `node ask.js --add-override no-match <25\|26> <sid> "note"` |
| 10 | Add force-segment | `node ask.js --add-override segment <25\|26> <sid> <segment> "note"` |
| 11 | Remove override | `node ask.js --remove-override <sid>` |
| **Q&A & ANALYSIS** | | |
| 12 | Ask a question | `node ask.js "your question"` |
| 13 | Ask and save to notes.md | `node ask.js "your question" --save-notes` |
| 14 | Rewrite a slide narrative | `node ask.js "instruction" --update-commentary <key>` |
| 15 | What changed? | `node ask.js --what-changed` |
| **INFORMATION** | | |
| 16 | View changes since last build | `cat output/changes.txt` |
| 17 | View notes.md | `cat notes.md` |
| 18 | View README | Displays this file |
| 0 | Exit | — |

---

## Standard run process — do this each time

```
STEP 0 — Launch the interactive menu (easiest way to do everything)
  node menu.js
  → Shows all 18 features as a numbered list. Type a number, press Enter.

OR run individual steps manually:

STEP 1 — Drop new CSVs into data/ (skip if CSVs haven't changed)

STEP 2 — Validate data quality
  node check.js          # or: npm run check
  → Fix any errors. Review warnings. Safe to proceed if only warnings.

STEP 3 — Review and manage overrides
  node ask.js --list-overrides      # or: menu option 6
  node ask.js --suggest-overrides   # or: menu option 7          (AI: finds likely missed matches)
  node ask.js --add-override match ...     (add specific overrides if needed)

STEP 4 — Build everything
  node build_all.js          # or: npm run build  |  menu option 1
  → Outputs: Excel, PowerPoint, HTML dashboard, analysis_results.json,
             commentary.json, changes.txt, updated notes.md build summary

STEP 5 — Review outputs
  Open output/dashboard.html in browser for a quick visual check
  Review output/changes.txt to see what shifted vs prior build
  node ask.js --what-changed    # or: menu option 15              (AI summary of differences)

STEP 6 — Ask questions / refine
  node ask.js "Your question here"
  node ask.js "Rewrite slide 8 narrative more urgently" --update-commentary slide_8_narrative
  → Then re-run: node build_all.js        (picks up updated commentary)

STEP 7 — Save useful insights
  node ask.js "What to watch next month?" --save-notes
  → Adds answer to notes.md for future context
```

---

## Adding a new year

1. Drop the new CSV files into `data/`
2. Update the four `csv_*` constants at the top of `build_all.js`
3. Update the output filename constants (`out_xlsx`, `out_pptx`) if needed
4. Run `node build_all.js`

The prior-year outputs are archived automatically. Year labels, slide headers, worst-month callouts, and calendar table rows all update automatically to match the new data — no manual edits needed.

---

## What is fully dynamic

Every element in both outputs recomputes from the CSVs each run:

| Element | Dynamic? | Notes |
|---|---|---|
| All data tables and numbers | Yes | Computed from CSV |
| Slide headers and titles | Yes | Uses actual worst months, top type |
| Year labels ("2025 vs 2026") | Yes | Extracted from CSV filenames |
| Data as-of date | Yes | Set to today's date at build time |
| Calendar table rows (slide 4) | Yes | Selects most interesting months |
| Callout box texts | Yes | References actual top decliner/grower |
| Slide narratives (slides 2–8) | Yes | Rule-based or Claude AI |
| Speaker notes (all 8 slides) | Yes | Rule-based or Claude AI |
| Excel Slack bullets | Yes | Rule-based or Claude AI |
| Excel month narratives | Yes | Rule-based or Claude AI |
| Excel type insights | Yes | Rule-based or Claude AI |
| Excel KEY FINDINGS rows | Yes | Rule-based or Claude AI |
| Excel pipeline findings | Yes | Rule-based or Claude AI |

If you load 2027 data where September is the worst month and Youth Race is the top decliner, the slide 3 header will automatically say "Monthly Breakdown -- Sep & Oct Drive the Declines", the alert box will name those months, and all narratives will describe Youth Race as the concern.

---

## Claude AI — Commentary, Insights & Speaker Notes

> Runs automatically during `node build_all.js` (menu **1**). Q&A via `node ask.js` (menu **12–15**).

The build script integrates with the Claude API to generate all narrative content dynamically.

### What Claude generates

```
slide_1_bullets            4 headline bullets (label + sub-text)
slide_2_narrative          Type-level change summary (2–3 sentences)
slide_3_narrative          Monthly breakdown narrative
slide_4_narrative          Calendar impact assessment
slide_5_narrative          Organic performance narrative
slide_6_narrative          Event-level disposition narrative
slide_7_narrative          Application pipeline narrative
slide_8_narrative          Win-back opportunity narrative
notes.slide_1..8           Speaker notes for all 8 slides
excel_slack_bullets        4 Slack-ready summary bullets (executive_summary tab)
excel_type_reads           Key-read column for type table
excel_month_narratives     12 month interpretations (step_3 tab)
excel_type_insights        4 type organic insights (step_3 tab)
excel_calendar_findings    KEY FINDINGS rows (step_2 tab)
excel_pipeline_findings    Pipeline opportunity text (step_5 tab)
```

### Getting an API key

1. Go to **https://console.anthropic.com** and sign in
2. Click **API Keys** in the left sidebar → **Create Key**
3. Paste into `.env`: `ANTHROPIC_API_KEY=sk-ant-api03-your-key-here`

### Model and cost

Uses **Claude Haiku** for the build (fast, < $0.01/run) and **Claude Sonnet** for interactive Q&A via `ask.js`.

### Fallback behaviour

If the API key is absent or the call fails, the build falls back to rule-based commentary automatically. The `commentary.json` `mode` field records which was used.

---

## Interactive Q&A — ask.js

> **Menu:** options **12–15** (or run commands directly below)

Ask Claude questions about the analysis, request rewrites, or draft communications — all grounded in the actual computed results.

```bash
# Ask analytical questions
node ask.js "Why did Adult Clinic decline but Youth Clinic grow?"
node ask.js "How does July's replacement rate compare to a healthy benchmark?"
node ask.js "What does the creation pipeline data tell us about next year?"
node ask.js "Which organizers should we prioritise for the August win-back campaign?"

# Request content rewrites
node ask.js "Rewrite the slide 6 narrative to be more urgent and action-oriented"
node ask.js "Make the slide 3 narrative shorter — two sentences maximum"

# Update commentary.json directly with the new version
node ask.js "Write a sharper version of the August win-back narrative" --update-commentary slide_8_narrative

# Draft communications
node ask.js "Draft a Slack post summarising the key findings in under 150 words"
node ask.js "Write talking points for a 5-minute standup on these results"

# Save Claude's answer to notes.md for future context
node ask.js "What should we watch in the next data pull?" --save-notes
```

**Context loaded automatically every call:**
- `output/analysis_results.json` — full computed dataset
- `output/commentary.json` — current narratives and slide text
- `notes.md` — your analyst notes, prior build summaries, and saved Q&A
- `output/archive/` — most recent prior run for trend comparison

**Model:** Claude Sonnet (streaming — answers appear in real time as Claude writes them).

**`--update-commentary <key>`** rewrites a specific key in `commentary.json` directly. On the next `node build_all.js` run the updated text appears in both the PowerPoint and Excel automatically.

---

## notes.md — Analyst Memory

> **Menu:** option **17** to view  |  option **13** to ask and save  |  or edit the file directly

`notes.md` is the persistent memory layer. It has three sources of content:

### 1. Your manual notes (edit freely)

Add context Claude cannot derive from the data alone:

```markdown
## Prior year context
- 2024: 1,201 total events. Adult Race +3%, Youth Clinic +8% (3rd consecutive year of growth).
- Pattern: Youth Clinic has grown 15%+ organically for 3 consecutive years.

## Analyst notes
- Adult Clinic decline is linked to the Q3 2024 online-only format change.
- July 2025 had unusually bad weather in the Southeast — accounts for some attrition.

## Open questions
- Is August attrition coming from the same organizers year-over-year or new ones?
- What is the typical lead time for Adult Clinic applications in May–August?

## Decisions made
- Agreed to target Adult Clinic organizer outreach May–August 2026.
- 49 July + 55 August attrited organizers identified for win-back campaign.
```

### 2. Auto-build summaries (written by the build script)

Every `node build_all.js` run automatically appends a compact summary to `notes.md`:

```
---
### Build run: May 16, 2026, 7:00 PM | mode: rule_based
- Total: 1,178 (prior) → 1,166 (current), net -12
- Segments: Retained 746, Shifted 124, Attrited 295, New 263
- Top issue: Adult Clinic -12.4%
- Top growth: Youth Clinic +17.2%
- Worst months: Aug (-18), Jul (-16)
```

Only the **5 most recent** build summaries are kept — older ones are pruned automatically so the file stays small.

### 3. Saved Q&A (written by --save-notes)

Running `node ask.js "..." --save-notes` appends the question and Claude's answer to `notes.md`. This means useful insights compound over time — next month's Claude call can see what you asked and what was concluded this month.

Smart pruning keeps the Q&A section manageable:
- Maximum **8 Q&A entries** retained (oldest dropped when limit is reached)
- Soft cap of **6,000 characters** total — oldest entries pruned if exceeded
- Your static notes section is never touched by auto-pruning

### How notes.md feeds back in

Every `node build_all.js` and every `node ask.js` call reads `notes.md` and passes the relevant content to Claude. The static notes section (prior year context, analyst observations, decisions) is included in full. Build summaries give Claude a sense of trend over time. Saved Q&A gives Claude the history of what was asked and resolved.

The result: Claude's commentary and answers get better the longer you use the system, without you having to re-explain context each time.

---

## Manual Event Overrides — data/overrides.json

> **Menu:** options **6–11** — or run the `node ask.js --...` commands directly below

The automatic matching algorithm gets ~85–90% of events right, but some cases require human judgment:

- An event with a completely different name year-over-year (e.g., sponsor name change, rebranding)
- A fuzzy match that is actually two separate events
- An event you want to classify differently than the algorithm decided

Edit `data/overrides.json` to add overrides. **Remove the leading `_` from keys to activate an entry** (keys starting with `_` are treated as comments and ignored). Run `node build_all.js` to apply.

### Override types

**`force_match`** — force two specific events to be matched:
```json
{
  "sid_25": "310628-Adult Race",
  "sid_26": "352469-Adult Race",
  "note": "Name changed between years — confirmed same event series"
}
```
Result: classified as **Retained** (if same month) or **Shifted** (if different month).

**`force_no_match`** — prevent an event from matching anything:
```json
{ "sid_25": "311157-Adult Race", "note": "Confirmed permanently cancelled" }
```
Result: 2025 event → **Attrited**. Use `sid_26` instead to force a 2026 event to **New**.

**`force_segment`** — override a segment classification on any event:
```json
{
  "sid_25": "310379-Adult Race",
  "segment": "Attrited",
  "note": "Algorithm fuzzy-matched incorrectly"
}
```
Valid segments: `Retained`, `Shifted`, `Attrited`, `New`, `Recovered`, `Tried to Return`

### Managing overrides from the command line

You never need to edit `overrides.json` by hand. Use `ask.js` commands:

```bash
# See all active overrides
node ask.js --list-overrides

# Force two events to match (→ Retained if same month, Shifted if different)
node ask.js --add-override match <sid_2025> <sid_2026> "optional note"

# Prevent an event from matching (→ Attrited for 2025 event, New for 2026 event)
node ask.js --add-override no-match 25 <sid_2025> "optional note"
node ask.js --add-override no-match 26 <sid_2026> "optional note"

# Override a segment classification
node ask.js --add-override segment 25 <sid_2025> Attrited "optional note"
node ask.js --add-override segment 26 <sid_2026> New "optional note"

# Remove all overrides for a sanction ID
node ask.js --remove-override <sid>

# Ask Claude to suggest likely missed matches (AI-powered, streaming)
node ask.js --suggest-overrides
```

After any change run `node build_all.js` to apply. Partial segment names are accepted (`attr`, `attrited`, `Attrited` all work).

### AI-powered suggestions

`--suggest-overrides` sends all unmatched 2025 and 2026 events to Claude Sonnet and returns ranked suggestions with confidence levels and reasons. You can accept all High-confidence suggestions with a single `y` or add them individually. You can also ask targeted questions:

```bash
node ask.js "Which 2025 attrited Adult Race events in June most likely match a 2026 event under a different name?"
node ask.js "Are there any 2026 new events that look like renamed 2025 events?"
```

### Tracking overrides

All applied overrides are recorded in `output/analysis_results.json` under the `overrides` key and displayed in the `step_4_event_detail` tab with `conf = Override`. The `ask.js` context automatically includes active override information so Claude is aware of manual decisions when answering questions.

---

## Output files

### Excel workbook — 12 tabs

| Tab | Contents |
|---|---|
| executive_summary | 4-step briefing + Slack bullets (all dynamic) |
| step_0_calendar_structure | Side-by-side 2025/2026 calendar grids |
| step_1_event_type_by_month | Raw delta by type × month |
| step_2_calendar_impact | Weekend-day shift analysis + KEY FINDINGS (dynamic) |
| step_3_organic_performance | Calendar-adjusted organic delta (month + type insights dynamic) |
| step_4_event_detail | Full event roster (16 cols incl. Day of Week + Status) |
| step_4a_segment_by_month | Two-table segment summary (by 2026 month + by 2025 month) |
| step_4b_shift_flow_matrix | Origin × destination flow matrix (all 3 parts combined) |
| step_4c_shifted_events | Shifted event stats + roster (Avg Distance, Top Month) |
| step_4d_cancelled_cross_match | Tried-to-Return + Recovered events |
| step_5_creation_pipeline | Application creation pipeline analysis (Parts A–F) |
| monthly_reconciliation | Segment counts by month (verification) |

### PowerPoint deck — 8 slides

| Slide | Step | Header (dynamic) |
|---|---|---|
| 1 | — | Title + 4 computed headline bullets |
| 2 | 0 | What Changed? Event Counts by Type |
| 3 | 1 | Monthly Breakdown -- {worst_month_1} & {worst_month_2} Drive the Declines |
| 4 | 2 | Is This a Calendar Effect? No -- Not for {worst_month_1} or {worst_month_2} |
| 5 | 3 | Organic Performance -- True Signal After Removing Calendar Noise |
| 6 | 4 | Did We Really Lose Events? Event-Level Disposition |
| 7 | 5 | Application Pipeline -- Who Is Filing, When, and Where the Opportunities Are |
| 8 | 6 | {worst_month_1} & {worst_month_2}: Organic Churn and the Win-Back Opportunity |

### JSON files

- **`analysis_results.json`** — full computed dataset: segments, monthly deltas, organic performance, shift flow, calendar impact.
- **`commentary.json`** — all generated text for PowerPoint and Excel, with mode indicator (`ai_claude` or `rule_based`).

---

## Archiving

> Auto-runs on every `node build_all.js` (menu option **1**)

Every `node build_all.js` run automatically moves existing output files to `output/archive/YYYY-MM-DD_HH-MM-SS/` before rebuilding. Prior versions are preserved indefinitely.


---

## Data health check — check.js

> **Menu:** option **2** — or run directly:

```bash
node check.js       # validate data before building
npm run check       # same via npm
```

Checks performed:
- **Duplicate sanction IDs** within each year's CSV
- **Unexpected status values** (e.g., `DRAFT`, `ADDITIONAL_ITEMS_NEEDED` — worth investigating)
- **Unexpected event type values** (anything outside the 4 known types)
- **Missing months** — calendar months with zero events in either year
- **Suspiciously large count changes** year-over-year (>30% swing triggers a warning)
- **Override conflicts** — sanction IDs in `overrides.json` not found in the active event list
- **Invalid segment names** in force_segment overrides
- **Cross-override conflicts** — same sanction ID in multiple override types

Exits with status 1 if errors are found (stopping a `check.js && build_all.js` pipeline). Warnings are informational — review and proceed if they're expected.

---

## HTML Dashboard — output/dashboard.html

> **Menu:** option **3** (opens in browser automatically) — or open the file manually:
> `output/dashboard.html`

Every build generates a self-contained HTML dashboard you can open in any browser — no PowerPoint, no Excel needed. Useful for sharing a quick visual overview with people who don't need the full workbook.

**Charts included:**
- Monthly event delta (raw Δ bar + organic Δ line overlay)
- Segment breakdown donut (Retained / Shifted / Attrited / New / Recovered)
- Event counts by type — grouped bar comparing both years
- Calendar expected vs organic delta scatter (labelled by month)
- Key findings summary bullets (from commentary engine)

**KPI header cards:** net change, current-year total, attrited count, new events added, retention rate.

The dashboard shows a warning badge if manual overrides are active, and labels the commentary mode (AI or rule-based).

---

## Diff report — output/changes.txt

> **Menu:** option **16** to view  |  option **15** for AI summary (`node ask.js --what-changed`)

Every build that has a prior run in `output/archive/` generates a `changes.txt` comparing:
- Key metric changes (total events, segments, net)
- Narrative changes (what text changed in each slide narrative)
- Commentary mode changes (rule-based → AI or vice versa)
- Active overrides applied

Useful for: reviewing what changed after loading updated CSVs mid-cycle, verifying that override changes had the expected effect, or documenting analysis decisions over time.

```bash
# View it directly
cat output/changes.txt

# Or ask Claude to explain the changes
node ask.js --what-changed
```

`--what-changed` does the same comparison and streams an AI summary if the API key is present.

---

## Matching methodology

Events are matched across years using a 3-pass algorithm:
1. **Exact** — sanction ID match
2. **Exact-shifted** — same name, different month
3. **Fuzzy** — Jaccard similarity ≥ 0.55 on normalised tokens + date-proximity weighting

Segments: Retained | Shifted | Attrited | Tried to Return | Recovered | New

Match confidence: ~85–90% at event level.

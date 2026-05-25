# USAT Sanctioned Event Analysis — event_analysis

Generates four outputs from live USAT sanctioned-event data:
- **Excel workbook** — `output/<year>_event_calendar_analysis_<timestamp>.xlsx` — 12-tab deep-dive
- **PowerPoint deck** — `output/<year>_event_trends_summary_<timestamp>.pptx` — 8-slide summary with rich speaker notes
- **HTML dashboard** — `output/dashboard.html` — self-contained interactive charts
- **JSON state snapshot** — `output/analysis_state.json` — every event, every match, every count (powers consistent AI Q&A)

Data is pulled live from `usat_sales_db.event_data_metrics` at build time (year-over-year, current vs prior). Every number, label, narrative, and speaker note in all four outputs is computed dynamically — no hardcoded months, types, or counts. With an Anthropic API key, Claude writes the editorial commentary; without one, a rule-based engine produces equivalent output following the same template.

---

## Folder structure

```
event_analysis/
├── menu.js                 ← Interactive feature launcher (start here)
├── build_all.js            ← Entry point: node build_all.js
├── ask.js                  ← Interactive Q&A + override management
├── check.js                ← Data quality + override conflict validation
├── package.json
├── .env                    ← API key + DB credentials (copy from .env.example)
├── .env.example            ← Template — safe to commit
├── .gitignore
├── notes.md                ← Analyst notes + prior context (feeds into Claude)
├── README.md
│
├── data/                   ← Override file only (event data now lives in DB)
│   └── overrides.json
│
├── output/                 ← Generated files (rebuilt each run)
│   ├── <year>_event_calendar_analysis_<ts>.xlsx
│   ├── <year>_event_trends_summary_<ts>.pptx
│   ├── dashboard.html               ← Interactive browser dashboard
│   ├── analysis_results.json        ← Summary dataset (used by deck + diff report)
│   ├── analysis_state.json          ← Full state for AI Q&A (every event + match)
│   ├── commentary.json              ← All generated narrative text
│   ├── changes.txt                  ← Diff vs prior build
│   └── archive/                     ← ONLY the immediately prior build (older runs auto-pruned)
│       └── 2026-05-17_14-33-46/
│           ├── <year>_event_calendar_analysis_<ts>.xlsx
│           ├── <year>_event_trends_summary_<ts>.pptx
│           ├── commentary.json
│           ├── analysis_results.json
│           ├── analysis_state.json
│           └── dashboard.html
│
├── utilities/                  ← Setup helpers for this module
│   ├── ensure_overrides_table.js   ← Idempotent table creator (auto-runs on every build)
│   └── migrate_overrides_to_db.js  ← One-shot JSON → DB migration (idempotent)
│
├── tests/                     ← node:test suite for the overrides DB chain
│   └── overrides.test.js
│
└── src/
    ├── fmt.js              ← Unicode formatters (− / — / ≥ / ⚠ / ✓ / full months)
    ├── db.js               ← usat_sales_db connection + event/pipeline queries
    ├── loader.js           ← Row → event-object parser (CSV + DB row inputs)
    ├── normalizer.js       ← Event name normalisation + fuzzy matching helpers
    ├── matcher.js          ← 3-pass event matching (exact → fuzzy → cross-match)
    ├── calendar.js         ← Weekend-day calendar impact + US holiday lists
    ├── analysis.js         ← Orchestrates matching + segment classification
    ├── commentary.js       ← Dynamic commentary engine (rule-based + Claude AI)
    ├── dashboard.js        ← Self-contained HTML dashboard generator
    ├── pptx/
    │   └── builder.js      ← PowerPoint deck builder (8 slides, fully dynamic)
    └── excel/
        ├── builder.js      ← Assembles all 12 worksheet tabs in order
        ├── styles.js       ← Colour palette + ExcelJS cell helpers
        └── sheets/         ← One file per Excel tab (all snake_case)
```

The shared CREATE-TABLE DDL for the overrides table lives at the repo-wide location used by every other table in `sql_programs`:

```
sql_programs/src/queries/create_drop_db_table/
└── query_create_event_analysis_overrides_table.js
```

---

## Setup

```bash
# 1. Install dependencies (once)
npm install

# 2. Copy env template and add required credentials
cp .env.example .env
# Edit .env — required keys:
#   ANTHROPIC_API_KEY=sk-ant-...          (optional; rule-based fallback if omitted)
#   LOCAL_HOST=...                        (usat_sales_db host)
#   LOCAL_MYSQL_USER=...
#   LOCAL_MYSQL_PASSWORD=...
#   LOCAL_USAT_SALES_DB=usat_sales_db

# 3. Build
node build_all.js
# or: npm run build
```

---

## Data source — usat_sales_db

All event data is pulled live from the `event_data_metrics` table in `usat_sales_db` via `src/db.js`. Two queries run per build:

1. **Events query** — one row per event for each year (`starts_year_events = YA` and `= YB`), filtered downstream to drop `CANCELLED` / `DECLINED` / `DELETED`.
2. **Creation pipeline query** — one row per `(creation_year, event_type, creation_month)` bucket for each year. Used by the `step_5_creation_pipeline` Excel sheet and PPT slide 7.

Year selection is controlled by CLI flags (universal across shells) — or persistent env vars in `.env` for project-wide defaults:

```bash
# Default: current year vs prior year (derived from new Date())
node build_all.js

# Specific pair via CLI flags (e.g. for historical comparisons or testing future years)
node build_all.js --baseline-year 2025 --analysis-year 2026
```

`BASELINE_YEAR` / `ANALYSIS_YEAR` env vars (or `.env` entries) still work as defaults; CLI flags override them. Menu option **5** ("Build (custom years — ad hoc)") prompts you interactively and wires the flags into the spawn — handy for one-off "what would 2026 vs 2027 look like?" runs.

If the DB is unreachable the build fails fast with a clear error — there is no CSV fallback. To verify the connection without doing a full build, run option **2** (Check data quality) from the menu.

---

## Interactive Menu — menu.js

```bash
node menu.js        # launch the interactive menu
npm run menu        # same thing via npm
```

Type a number and press Enter. For features that need input the menu prompts you — no flags to remember.

The status bar at the top always shows: last build date, event totals, commentary mode (AI or rule-based), API key status, and active override count.

### All 34 features — menu number + what it runs

| # | Menu label | Equivalent command |
|---|---|---|
| **BUILD & OUTPUT** | | |
| 1 | Build everything | `node build_all.js` (reuses cached AI commentary when commentary inputs haven't changed) |
| 2 | Build (rule-based only) | `node build_all.js --no-ai` — forces rule-based commentary; no Claude tokens spent. Useful when iterating on dashboard / Excel / pptx formatting. |
| 3 | Build (force fresh AI) | `node build_all.js --fresh-ai` — bypasses the commentary cache and calls Claude even when inputs haven't changed. Use when you tweaked the prompt or want new wording. |
| 4 | Build (skip roster DB write) | `node build_all.js --no-db-roster` — same outputs (Excel / PowerPoint / dashboard / JSON), but does NOT write the roster snapshot to `event_analysis_roster` and skips retention pruning. Use for local iteration where you don't want every throwaway build in the historical record. |
| 5 | Build (custom years — ad hoc) | Prompts for `--baseline-year` and `--analysis-year`, defaults the other two prompts to skip the DB write + Slack notification. Useful for "what would 2026 vs 2027 look like?" exploration. CLI equivalent: `node build_all.js --baseline-year 2026 --analysis-year 2027 --no-db-roster --no-slack` |
| 6 | Check data quality | `node check.js` |
| 7 | Open dashboard in browser | Opens `output/dashboard.html` |
| 8 | Open Excel workbook | Opens the newest `output/<year>_event_calendar_analysis_*.xlsx` |
| 9 | Open PowerPoint deck | Opens the newest `output/<year>_event_trends_summary_*.pptx` |
| **OVERRIDES — event matching** | | |
| 10 | List active overrides | `node ask.js --list-overrides` |
| 11 | Suggest overrides (AI) | `node ask.js --suggest-overrides` |
| 12 | Add force-match | `node ask.js --add-override match <sid_baseline> <sid_analysis> "note"` |
| 13 | Add force-no-match | `node ask.js --add-override no-match <25\|26> <sid> "note"` |
| 14 | Add force-segment | `node ask.js --add-override segment <25\|26> <sid> <segment> "note"` |
| 15 | Remove override | `node ask.js --remove-override <sid>` |
| **Q&A & ANALYSIS** | | |
| 16 | Ask a question | `node ask.js "your question"` |
| 17 | Ask and save to notes.md | `node ask.js "your question" --save-notes` |
| 18 | Rewrite a slide narrative | `node ask.js "instruction" --update-commentary <key>` |
| 19 | What changed? | `node ask.js --what-changed` |
| **INFORMATION** | | |
| 20 | View changes since last build | `cat output/changes.txt` |
| 21 | View notes.md | `cat notes.md` |
| 22 | View README | Displays this file |
| **LOCAL SERVER** | | |
| 23 | Start local server | `node server_event_analysis_8016.js` (API + `/editor/` SPA + dashboard at port 8016; `Ctrl-C` to stop) |
| 24 | Start local server (IP allowlist) | Prompts for a comma-separated list of allowed IPs (default `127.0.0.1`) and spawns the server with `ALLOWED_IPS` set so the middleware enforces the allowlist. Useful when you want a quick way to expose the dashboard to a known set of IPs (e.g. Looker Studio fetchers) without flipping config. CLI equivalent: `ALLOWED_IPS=127.0.0.1 node server_event_analysis_8016.js` (POSIX) / `$env:ALLOWED_IPS='127.0.0.1'; node server_event_analysis_8016.js` (PowerShell). |
| **TESTING** | | |
| 25 | Run ALL tests | `node --test tests/` (every `*.test.js` under `tests/`) |
| 26 | Run overrides tests only | `node --test tests/overrides.test.js` (schema + year scoping + apply + approve + stale) |
| 27 | Run server tests only | `node --test tests/server.test.js` (read/write API + editor static files) |
| 28 | Run menu tests only | `node --test tests/menu.test.js` (every menu item is wired correctly — duplicate ids, missing actions, etc.) |
| 29 | Run smoke tests only | `node --test tests/smoke.test.js` (parse-check + require-check on every major source file) |
| 30 | Run glossary tests only | `node --test tests/glossary.test.js` (every term defined in the dashboard's bottom-of-page glossary) |
| 31 | Run download tests only | `node --test tests/downloads.test.js` (Excel + PowerPoint Download buttons point at files that actually exist) |
| 32 | Run build tests only | `node --test tests/build.test.js` (commentary cache: hash stability + sensitivity + insensitivity + loader behavior) |
| 33 | Run roster tests only | `node --test tests/roster.test.js` (per-build roster snapshot: row-builder pure tests + DB insert + retention pruning) |
| **PREFERENCES** | | |
| 34 | Show/hide CLI commands | Toggles a dimmed `$ ...` second line under each menu item. Choice persists in `.menu_prefs.json` next to `menu.js` (gitignored). |
| 0 | Exit | — |

---

## Standard run process — do this each time

```
STEP 0 — Launch the interactive menu (easiest way to do everything)
  node menu.js
  → Shows all 18 features as a numbered list. Type a number, press Enter.

OR run individual steps manually:

STEP 1 — Validate data + DB connectivity
  node check.js          # or: npm run check  |  menu option 2
  → Connects to usat_sales_db, fetches events, surfaces duplicates,
    unexpected statuses, missing months, override conflicts.

STEP 2 — Review and manage overrides
  node ask.js --list-overrides      # or: menu option 6
  node ask.js --suggest-overrides   # or: menu option 7   (AI: finds likely missed matches)
  node ask.js --add-override match ...     (add specific overrides if needed)

STEP 3 — Build everything
  node build_all.js          # or: npm run build  |  menu option 1
  → Outputs: Excel, PowerPoint, HTML dashboard, analysis_results.json,
             analysis_state.json, commentary.json, changes.txt,
             updated notes.md build summary

STEP 4 — Review outputs
  Open output/dashboard.html in browser for a quick visual check
  Review output/changes.txt to see what shifted vs prior build
  node ask.js --what-changed    # or: menu option 15   (AI summary of differences)

STEP 5 — Ask questions / refine
  node ask.js "Your question here"
  node ask.js "Rewrite slide 8 narrative more urgently" --update-commentary slide_8_narrative
  → Then re-run: node build_all.js        (picks up updated commentary)

STEP 6 — Save useful insights
  node ask.js "What to watch next month?" --save-notes
  → Adds answer to notes.md for future context
```

---

## Comparing different years

Default behaviour compares the **current year vs prior year**, derived from `new Date()`. So in May 2026 it runs as 2025 vs 2026 automatically.

To compare a specific year-pair (historical or future), use the CLI flags (universal across shells — PowerShell / cmd / bash / Git Bash):

```bash
# Compare 2024 vs 2025 (ad-hoc — explicit on the command line)
node build_all.js --baseline-year 2024 --analysis-year 2025

# Or set just --analysis-year and let baseline default to analysis_year - 1
node build_all.js --analysis-year 2025

# Combine with other flags as needed
node build_all.js --baseline-year 2026 --analysis-year 2027 --no-db-roster --no-slack
```

For project-wide defaults (e.g. "this checkout always runs 2025 vs 2026"), set them in `.env` instead:

```
BASELINE_YEAR=2025
ANALYSIS_YEAR=2026
```

CLI flags always win over env vars when both are set — so you can keep a persistent `.env` default and still override it for a one-off run. **Menu option 5** ("Build (custom years — ad hoc)") prompts you interactively, defaults to skipping the DB write + Slack notification, and spawns the build with the right flags. Useful for quick "what would 2026 vs 2027 look like?" exploration without editing `.env`.

The DB queries, output filenames (e.g. `2025_event_calendar_analysis_*.xlsx`), slide headers, worst-month callouts, calendar tables, and all narratives update automatically. **No code edits required.**

---

## What is fully dynamic

Every element in all four outputs recomputes from the DB each run:

| Element | Dynamic? | Notes |
|---|---|---|
| All data tables and numbers | Yes | Pulled from `usat_sales_db.event_data_metrics` |
| Year labels (`{YA} vs {YB}`) | Yes | Default = current + prior year; env override |
| Output filenames | Yes | `<year>_<artifact>_<YYYY-MM-DD_HH-MM-SS>.{xlsx,pptx}` |
| Slide headers and titles | Yes | Names actual worst months and top decliner/grower |
| Data as-of date | Yes | Build timestamp |
| Calendar table rows (slide 4) | Yes | Picks the 5 most informative months |
| Callout box texts | Yes | References actual top decliner/grower |
| Slide narratives (slides 2–8) | Yes | Rule-based or Claude AI |
| Speaker notes (all 8 slides) | Yes | Structured with sections (Context / Key message / Methodology / Talking point / Two-speed action plan / Holiday lists) — rule-based or Claude AI |
| Excel Slack bullets | Yes | Pattern: `<headline metric>. <interpretive sentence>.` |
| Excel Step 0 "Key read" column | Yes | One short sentence with optional ⚠/✓ glyph |
| Excel month narratives | Yes | Per-month organic interpretations |
| Excel type insights | Yes | Per-type organic insights |
| Excel KEY FINDINGS rows | Yes | Picks worst-organic months + misleading months |
| Excel pipeline findings | Yes | Per-type Q4 / in-year / total |
| Calendar Excel holiday highlighting | Yes | Amber-fill + hover tooltip with holiday name |
| Speaker note holiday lists | Yes | US federal holidays for both years (with day-of-week) |
| Typography | Yes | Unicode `−`, `—`, `≥`, `1,178` thousands, full month names |

If you load 2027 data where September is the worst month and Youth Race is the top decliner, the slide 3 header will automatically say "Monthly Breakdown — Sep & Oct Drive the Declines", the alert box will name those months, and all narratives will describe Youth Race as the concern.

---

## Claude AI — Commentary, Insights & Speaker Notes

> Runs automatically during `node build_all.js` (menu **1**). Q&A via `node ask.js` (menu **12–15**).

The build script integrates with the Claude API to generate all narrative content dynamically.

### What Claude generates

```
slide_1_bullets            4 headline bullets (label + editorial sub-text)
slide_2..8_narrative       Slide narrative paragraphs (2–3 sentences each)
notes.slide_1..8           Structured speaker notes (150–300 words each)
                              Sections: Context / Key message / Headline numbers /
                              By type / Methodology / Key findings / Talking point /
                              Two-speed action plan / Holiday lists (slide 4)
excel_slack_bullets        4 Slack-ready summary bullets (executive_summary tab)
excel_type_reads           One-sentence "Key read" per event type (with ⚠/✓ glyphs)
excel_month_narratives     12 monthly organic interpretations (step_3 tab)
excel_type_insights        4 type organic insights (step_3 tab)
excel_calendar_findings    KEY FINDINGS rows (step_2 tab)
excel_pipeline_findings    Per-type pipeline status (step_5 tab)
```

### Editorial style enforced

The AI prompt locks the voice and formatting so output stays consistent run-to-run:

- **Voice:** short, decisive, opinionated. Headlines lead with the takeaway, not a data dump.
- **Pattern:** Slack bullets and type-reads follow `<headline metric> + <one interpretive sentence with the so-what>`.
- **Severity glyphs:** `⚠` on the principal decliner row, `✓` on the principal grower row.
- **Typography:** Unicode minus `−`, em-dash `—`, `≥`, thousands separators (`1,178`), full month names (`July` not `Jul`).
- **No invention:** "Use ONLY numbers that appear in the context. If a field isn't in the snapshot, say so."

### Getting an API key

1. Go to **https://console.anthropic.com** and sign in
2. Click **API Keys** in the left sidebar → **Create Key**
3. Paste into `.env`: `ANTHROPIC_API_KEY=sk-ant-api03-your-key-here`

### Model and cost

Uses **Claude Haiku** for the build (fast, < $0.01/run) and **Claude Sonnet** for interactive Q&A via `ask.js`.

### Fallback behaviour

If the API key is absent or the call fails, the build falls back to rule-based commentary automatically. The rule-based engine produces the same structured output (same section headers in speaker notes, same `<metric> + <interpretation>` Slack-bullet pattern, same Unicode formatting). The `commentary.json` `mode` field records which path was used (`ai_claude` or `rule_based`).

### Force rule-based mode — skip the API call

Pass `--no-ai` (or `--rule-based`) to force rule-based commentary even when the key is present. Menu option **2** ("Build (rule-based only)") wires this for you. Use when:

- You're iterating on dashboard / Excel / pptx formatting and don't want to burn Claude tokens regenerating narratives you already have.
- You want a deterministic build for diffing two consecutive runs (AI output can vary slightly between calls).
- The API is rate-limited / unreachable and you want a clean build now.

```bash
# Manual invocation — works identically in PowerShell / cmd / bash / Git Bash:
node build_all.js --no-ai
```

The build logs `--no-ai (or --rule-based) — skipping AI commentary, using rule-based.` so you can confirm at a glance which path ran.

### Commentary cache — reuse prior AI output when inputs haven't changed

The AI commentary call takes ~70 seconds and dominates the build time when enabled. To avoid re-spending tokens on rebuilds where nothing material changed, `build_all.js` hashes a whitelist of fields that commentary actually reads — segments, by-type counts, monthly aggregates, organic delta, calendar impact, override count, years — and stamps the hash onto `commentary.json` as `_input_hash`. On the next build:

- **Hash matches → cache HIT.** The prior `commentary.json` is reused as-is. No API call. Log line: `Commentary cache HIT (hash a3f5c8…) — reusing prior commentary.json, no AI call.`
- **Hash differs → cache MISS.** Claude is called fresh; the new commentary is saved with the new hash.

What's NOT in the hash (so a change here won't invalidate): individual event names, sanction IDs, confidence scores, day-of-week, override row contents, build timestamps, file paths. A source-data typo fix that doesn't move any aggregate → cache hit. A real segment-count shift, even by one event → cache miss.

**Manual overrides:**

| Flag | What it does | Menu |
|---|---|---|
| `--fresh-ai` | Bypass the cache and call Claude even when inputs are unchanged. Use when you've tweaked the prompt or want new wording. | Option **3** ("Build (force fresh AI)") |
| `--stale-ai` | Use the cached `commentary.json` even when the hash differs. Use when you want zero AI cost and don't mind subtly out-of-date commentary. | (CLI only — no menu entry; uncommon enough not to clutter the menu) |
| `--no-ai` (or `--rule-based`) | Skip AI entirely; run rule-based. Cache is irrelevant — rule-based output is always fresh-computed (it's fast). | Option **2** |

Together: option **1** (default) gives you the fastest correct build (cache when safe, fresh AI when needed). Option **2** is the cheapest. Option **3** is the "give me new wording" escape hatch.

### Slack notification on build complete

Every build posts a one-line summary to `#steve_calla_slack_channel` via the existing `slack_message_api` utility. Success and failure are both reported:

```
✅ event_analysis build · 7.3s · ai_claude (cached) · 2025→2026 net -12
❌ event_analysis build FAILED · 12.1s · TypeError: foo is undefined
```

Reads `SLACK_WEBHOOK_STEVE_CALLA_USAT_URL` from `.env` — same env var the other automation jobs in this repo use. Pass `--no-slack` to suppress the notification (useful when iterating locally and you don't want every test rebuild pinging the channel). A failed Slack post never breaks the build — the build's exit code is governed by its own outcome, the notification is a side-effect.

---

## Interactive Q&A — ask.js

> **Menu:** options **12–15** (or run commands directly below)

Ask Claude questions about the analysis, request rewrites, or draft communications — all grounded in the actual computed results.

```bash
# Ask analytical questions
node ask.js "Why did Adult Clinic decline but Youth Clinic grow?"
node ask.js "How many Adult Race events were in August 2026?"
node ask.js "Which Adult Race events were lost in July?"
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

### Context loaded automatically every call

- **`output/analysis_state.json`** — full state snapshot (every event, every segment match, per-month-per-type counts, shift flow, pipeline rows). **Single source of truth for Q&A — guaranteed to match what's in the deck.**
- **`output/analysis_results.json`** — top-line summary (used for cross-check sanity validation on load)
- **`output/commentary.json`** — current narratives and slide text
- **`notes.md`** — your analyst notes, prior build summaries, and saved Q&A
- **`output/archive/<prior>/commentary.json`** — most recent prior run for diffs

### Question-aware context routing

`ask.js` inspects your question for keywords and includes only the relevant detail tables in the Claude prompt (keeps the prompt within token budget while still being complete):

| Keyword pattern | Tables added to prompt |
|---|---|
| month name (`January`, `Jul`, `august`…) | per-month per-type segment tables for every segment |
| `retained` / `shifted` / `lost` / `new` / `recovered` / `tried to return` | matching segment counts per-month per-type |
| `shift` / `moved` / `migration` | 12×12 shift flow matrix (origin × destination) |
| `application` / `filed` / `pipeline` / `Q4` / `in-year` | creation pipeline rows per type |
| `organic` / `calendar` / `weekend` / `Sat` / `Sun` | calendar-impact table by month |
| `name` / `list` / `show me` / `which event` / `sanction` | event-level lists (sanction IDs, filtered by month if specified) |

### Consistency guarantees

1. **Every answer prefixes with the build timestamp** — e.g. *"Based on the build from 2026-05-17 14:33:"* — so you always know which snapshot is being cited.
2. **Cross-check on load:** if `analysis_results.json` and `analysis_state.json` disagree on top-line totals, ask.js prints `⚠ Rebuild recommended` to console.
3. **No invention:** if a field isn't in the snapshot (e.g. organizer email, registration count), Claude is instructed to say *"That field isn't in the build snapshot"* rather than guess.

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
- 49 July + 55 August lost organizers identified for win-back campaign.
```

### 2. Auto-build summaries (written by the build script)

Every `node build_all.js` run automatically appends a compact summary to `notes.md`:

```
---
### Build run: May 17, 2026, 2:33 PM | mode: ai_claude
- Total: 1,178 (prior) → 1,165 (current), net −13
- Segments: Retained 746, Shifted 123, Lost 296, New 265
- Top issue: Adult Clinic −13.4%
- Top growth: Youth Clinic +17.2%
- Worst months: Aug (−19), Jul (−16)
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

## Manual Event Overrides

> **Menu:** options **6–11** — or run the `node ask.js --...` commands directly below

### Storage — DB-backed (MySQL)

Overrides live in `usat_sales_db.event_analysis_overrides`. The runtime — both the matcher (`src/analysis.js`) and every `ask.js` CLI write — reads and writes the DB directly. The original `data/overrides.json` is retained only as a one-time migration source; it's renamed to `overrides.json.migrated` after import. The build-out happened in small steps:

| Step | Status |
|---|---|
| **1.** `event_analysis_overrides` table exists in `usat_sales_db` (auto-created on every `node build_all.js` via `ensure_overrides_table()` — idempotent `CREATE TABLE IF NOT EXISTS`) | ✓ done |
| **2.** Active entries in `data/overrides.json` auto-import into the DB on every build via `migrate_overrides_json_to_db()` (idempotent; legacy `Attrited` → `Lost` mapping; once migrated, JSON is renamed `overrides.json.migrated`) | ✓ done |
| **2.5.** Year scoping — `event_analysis_overrides` carries `baseline_year` + `analysis_year` columns so overrides apply only to the matching year-pair. `ensure_overrides_table()` adds the columns + `idx_year_pair` index idempotently if missing and backfills existing rows from current build env vars. | ✓ done |
| **3.** `analysis.js` reads overrides from the DB. `src/overrides.js` `load_overrides()` is now async and queries `event_analysis_overrides` filtered by year scope (NULL/NULL globals + matching baseline/analysis pair). `runAnalysis()` is async; `build_all.js` and `ask.js` `await` it. Unapproved overrides emit a build-time warning but still apply. | ✓ done |
| **4.** `ask.js` CLI commands write to the DB. `--add-override match / no-match / segment` and `--remove-override` all read/write `event_analysis_overrides` directly (year-scoped by env vars; pass `--global` to scope NULL/NULL). New rows are tagged `created_by='cli'`. `--remove-override` is a soft delete (`active = 0`) so the audit trail survives. `--suggest-overrides` reads the DB to de-dup against existing overrides instead of the (now retired) JSON file. | ✓ done |
| **5.** `--approve <sid>` / `--unapprove <sid>` CLI commands. Approve flips `approved=1` + `approval_state='approved'` + `approved_by` + `approved_at`, and captures `event_signature_{baseline,analysis}` snapshots of the current event state. Unapprove clears the approval columns + signatures (keeps `approved_by`/`approved_at` for audit). Build's unapproved-warning falls silent once a row is approved. | ✓ done |
| **6.** Stale-approval detection at build time. `apply_overrides()` recomputes event signatures and compares to the stored snapshot; on drift it flags `applied[].stale = true`, returns the override id in `stale_ids`, and the build calls `mark_overrides_stale()` to flip `approval_state='stale'` in the DB. Build emits a per-row `⚠ [stale approval]` warning showing what drifted (`baseline "Old"→"New"`). `--list-overrides` renders stale rows with `⚠ stale`. Re-approve via `--approve` refreshes the signature; unapprove clears it. | ✓ done |
| **7.** Minimal Express server (`server_event_analysis_8016.js` at the repo root alongside the other `server_*.js` services, default port 8016) with read-only endpoints: `GET /api/status`, `GET /api/overrides` (year-scoped via query params or env), `GET /api/events?year=YYYY` (with optional `&include=excluded`). HTML index at `/` lists endpoints with `curl` examples. Static-serves `output/` so `dashboard.html` is reachable at `/output/dashboard.html`. CORS enabled. Smoke-tested in `tests/server.test.js`. Menu option 19. | ✓ done |
| **8.** Write endpoints — `POST /api/overrides` (typed dispatch over force_match / force_no_match / force_segment), `DELETE /api/overrides/:sid` (soft-delete), `POST /api/approve/:sid`, `POST /api/unapprove/:sid`. All wrap the existing `cmd_*` functions; tagged `created_by='server'` so HTTP writes are distinguishable from CLI writes. Stale Override Manager panel removed from `dashboard.html` — interactive editor lands in Step 9 on top of these endpoints. 16 new write tests in `tests/server.test.js` (validation + happy paths + DB-state assertions). | ✓ done |
| **9.** Interactive override editor — two surfaces sharing the Step 8 API. (a) Standalone SPA at `src/event_analysis/public/{index.html,editor.css,editor.js}`, served at `/editor/`. (b) **Dashboard-integrated panel** embedded in `dashboard.html` itself, below the event roster — a new "Override" column shows status per event, clicking a row focuses the editor + pre-fills the sid, plus a sticky "rebuild needed" banner that fires after any edit. **Step 9.5: `GET /api/build`** streams a `build_all.js` run over Server-Sent Events; the dashboard's "Rebuild now" button reads the stream and reloads on success. Concurrent builds blocked. ~10 new tests in `tests/server.test.js` covering dashboard panel markers, the SSE stream, and the build-lock. | ✓ done |

The DB is now the single source of truth for overrides. `data/overrides.json` is no longer read or written by the runtime — only the one-time migration script touches it, and it renames the file to `overrides.json.migrated` once entries are imported. You should never need to edit JSON by hand again.

#### Run the JSON → DB migration manually

The build does this automatically, but you can also invoke it standalone:

```bash
# Apply (default behaviour) — inserts active entries and renames the JSON
node src/event_analysis/utilities/migrate_overrides_to_db.js

# Dry-run — report what would happen, no DB writes, no rename
node src/event_analysis/utilities/migrate_overrides_to_db.js --dry-run

# Apply but leave the JSON file in place (no rename)
node src/event_analysis/utilities/migrate_overrides_to_db.js --no-rename
```

The automatic matching algorithm gets ~85–90% of events right, but some cases require human judgment:

- An event with a completely different name year-over-year (e.g., sponsor name change, rebranding)
- A fuzzy match that is actually two separate events
- An event you want to classify differently than the algorithm decided

Edit `data/overrides.json` to add overrides. **Remove the leading `_` from keys to activate an entry** (keys starting with `_` are treated as comments and ignored). Run `node build_all.js` to apply.

### Override types

**`force_match`** — force two specific events to be matched:
```json
{
  "sid_baseline": "310628-Adult Race",
  "sid_analysis": "352469-Adult Race",
  "note": "Name changed between years — confirmed same event series"
}
```
Result: classified as **Retained** (if same month) or **Shifted** (if different month).

**`force_no_match`** — unlink a matched pair (requires both sids):
```json
{ "sid_baseline": "311157-Adult Race", "sid_analysis": "354307-Adult Race", "note": "Not actually the same event" }
```
Result: baseline event → **Lost** (default), analysis event → **New** (default). Override per-side segments with `segment_baseline` / `segment_analysis`.

**`force_segment`** — override a segment classification on any event:
```json
{
  "sid_baseline": "310379-Adult Race",
  "segment": "Lost",
  "note": "Algorithm fuzzy-matched incorrectly"
}
```
Valid segments: `Retained`, `Shifted`, `Lost`, `New`, `Recovered`, `Tried to Return`

### Managing overrides from the command line

Every override CLI command reads and writes the `event_analysis_overrides` MySQL table directly. There is no JSON file to edit.

```bash
# See all active overrides (year-scoped: current pair + globals)
node ask.js --list-overrides

# Force two events to match (→ Retained if same month, Shifted if different)
node ask.js --add-override match <sid_baseline> <sid_analysis> "optional note"

# Prevent an event from matching (→ Lost for baseline event, New for analysis event)
node ask.js --add-override no-match baseline <sid> "optional note"
node ask.js --add-override no-match analysis <sid> "optional note"
# Legacy aliases 25/26 are still accepted: --add-override no-match 25 <sid>

# Override a segment classification
node ask.js --add-override segment baseline <sid> Lost "optional note"
node ask.js --add-override segment analysis <sid> New "optional note"

# Soft-delete all active overrides for a sanction ID (sets active = 0;
# audit trail in the table is preserved)
node ask.js --remove-override <sid>

# Approve all active overrides for a sanction ID. Silences the build's
# unapproved-warning and captures event signatures for stale detection.
node ask.js --approve <sid>

# Clear approval state + captured signatures (audit fields preserved)
node ask.js --unapprove <sid>

# Ask Claude to suggest likely missed matches (AI-powered, streaming).
# Already-overridden sanction IDs are filtered out by reading the DB.
node ask.js --suggest-overrides
```

After any change run `node build_all.js` to apply. Partial segment names are accepted (`lost`, `Lost` both work).

#### Year scoping at the CLI

By default, new overrides are scoped to the active comparison — `BASELINE_YEAR` / `ANALYSIS_YEAR` env vars if set, otherwise current calendar year vs prior year. Only that specific year-pair (plus any global rows) will see the override.

To create a global override that applies to **every** year comparison, append `--global` (the flag can appear anywhere after the subcommand):

```bash
# Scoped to current pair only
node ask.js --add-override match 310628-Adult\ Race 352469-Adult\ Race "name change"

# Global — applies to any year pair (baseline_year/analysis_year both NULL)
node ask.js --add-override match 310628-Adult\ Race 352469-Adult\ Race "name change" --global

# Explicit scope for a historical comparison
ANALYSIS_YEAR=2025 BASELINE_YEAR=2024 node ask.js --add-override no-match baseline 287011-Adult\ Race "permanently cancelled"
```

`--remove-override` always operates within the active year scope plus globals — it's a soft delete (sets `active = 0`), so removed rows remain in the table for audit. Same row can be re-added; the duplicate-guard only fires on `active = 1` rows.

#### Provenance

Every new row records who wrote it via `created_by`: `cli` for `ask.js` commands, `json_migration` for the one-time JSON import, `test_suite` for `tests/overrides.test.js` (cleaned up automatically). Useful for audit queries.

### Approval workflow

Newly-added overrides start un-approved. The build still applies them, but emits a warning:

```
⚠ 3 override(s) are unapproved (still applied; approve via ask.js).
```

To silence the warning, approve the override:

```bash
node ask.js --approve <sid>
```

Approve does three things atomically:

1. Sets `approved = 1`, `approval_state = 'approved'`, `approved_by = 'cli'`, `approved_at = NOW()`.
2. Fetches the current event(s) for `sid_baseline` and/or `sid_analysis` from `usat_sales_db`.
3. Captures a signature of the current event state into `event_signature_baseline` / `event_signature_analysis`. Format: `{name}|{month}|{type}|{status}`.

To withdraw approval (e.g. before re-running the matcher):

```bash
node ask.js --unapprove <sid>
```

Unapprove clears the approval columns and signatures. The audit fields `approved_by` and `approved_at` are kept so you can see who last touched the row and when.

### Stale-approval detection (Step 6)

The signatures captured at approval time let the build detect when the underlying events have drifted since approval. On every build, `apply_overrides()` recomputes each event's signature from the current `usat_sales_db` data and compares to the stored snapshot.

If they differ, the build emits:

```
⚠ [stale approval] override #42 (310628-Adult Race) is stale: baseline "Old Name|7|Adult Race|Active" → "New Name|7|Adult Race|Active"
```

…and flips `approval_state` to `'stale'` in the DB. `--list-overrides` renders these rows with a `⚠ stale` badge instead of `✓ approved`. Until the analyst either re-approves (refreshes the signature) or removes the override, the warning keeps firing on every build.

What counts as "drift": any change in **name**, **start month**, **event type**, or **status** of either event. Renaming a clinic, changing its month, or marking it `CANCELLED` will all trigger stale state.

What doesn't count: changes to fields outside the signature (registration URL, organiser, race count). These can churn without triggering re-approval.

### Override lifecycle

```
[ add (unapproved) ]           --add-override ...
        │ build emits ⚠ unapproved warning
        ▼
[ approve (snapshots captured) ] --approve <sid>
        │ build is quiet
        ▼
[ event drifts upstream ]
        │ build emits ⚠ stale approval warning
        │ DB row flipped to approval_state='stale'
        ▼
[ re-approve OR remove ]       --approve <sid>  (or --remove-override <sid>)
        │
        ▼
[ approved again | inactive ]
```

### AI-powered suggestions

`--suggest-overrides` sends all unmatched prior-year and current-year events to Claude Sonnet and returns ranked suggestions with confidence levels and reasons. You can accept all High-confidence suggestions with a single `y` or add them individually. You can also ask targeted questions:

```bash
node ask.js "Which 2025 lost Adult Race events in June most likely match a 2026 event under a different name?"
node ask.js "Are there any 2026 new events that look like renamed 2025 events?"
```

### Tracking overrides

All applied overrides are recorded in `output/analysis_results.json` under the `overrides` key and displayed in the `step_4_event_detail` tab with `conf = Override`. The `ask.js` context automatically includes active override information so Claude is aware of manual decisions when answering questions.

---

## Output files

### Excel workbook — 12 tabs

| Tab | Contents |
|---|---|
| executive_summary | 4-step briefing + Slack bullets (all dynamic, editorial voice) |
| step_0_calendar_structure | Side-by-side BASELINE_YEAR/ANALYSIS_YEAR calendar grids (holiday cells highlighted in amber with hover-tooltip showing holiday name; per-month holiday list in Notes column) |
| step_1_event_type_by_month | Raw delta by type × month |
| step_2_calendar_impact | Weekend-day shift analysis + KEY FINDINGS (dynamic) |
| step_3_organic_performance | Calendar-adjusted organic delta (month + type insights dynamic) |
| step_4_event_detail | Full event roster (16 cols incl. Day of Week + Status) |
| step_4a_segment_by_month | Two-table segment summary (by ANALYSIS_YEAR month + by BASELINE_YEAR month) |
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
| 3 | 1 | Monthly Breakdown — {worst_month_1} & {worst_month_2} Drive the Declines |
| 4 | 2 | Is This a Calendar Effect? No — Not for {worst_month_1} or {worst_month_2} |
| 5 | 3 | Organic Performance — True Signal After Removing Calendar Noise |
| 6 | 4 | Did We Really Lose Events? Event-Level Disposition |
| 7 | 5 | Application Pipeline — Who Is Filing, When, and Where the Opportunities Are |
| 8 | 6 | {worst_month_1} & {worst_month_2}: Organic Churn and the Win-Back Opportunity |

Speaker notes for every slide are 150–300 words with structured sections (Context / Key message / Headline numbers / By type / Methodology / Key findings / Talking point / Two-speed action plan / Holiday lists on slide 4).

### JSON files

- **`analysis_results.json`** — top-line summary: totals, segments, by-type, monthly deltas, organic performance, shift flow, calendar impact, overrides. Read by the diff report and by Excel/PPT builders.
- **`analysis_state.json`** — full state snapshot (~500 KB): every event with sanction ID/name/type/month/status, every segment match record (both sides), per-month per-type counts, segment counts by month×type, 12×12 shift flow matrix, raw creation pipeline rows, build metadata. **Read by `ask.js` so every Q&A answer is consistent with the deck by construction.** Written atomically.
- **`commentary.json`** — all generated text for PowerPoint and Excel, with `mode` indicator (`ai_claude` or `rule_based`) and a `_ai_generated` boolean.

---

## Archiving

> Auto-runs on every `node build_all.js` (menu option **1**)

Every build moves the prior run's xlsx + pptx into `output/archive/<YYYY-MM-DD_HH-MM-SS>/` and copies the prior `commentary.json`, `analysis_results.json`, `analysis_state.json`, and `dashboard.html` into the same folder.

**Only the immediately prior build is kept.** Older archive folders (anything matching the timestamp pattern) are auto-pruned. Folders with non-timestamp names (e.g. `manual_save/`) are left untouched so manual snapshots survive.

The retained sidecar JSONs let the diff report (`changes.txt` / `node ask.js --what-changed`) compare the new build against the prior one. Without them, diffs would be skipped.

End state of `output/` after every build:

```
output/
  <year>_event_calendar_analysis_<NEW>.xlsx     ← just-built
  <year>_event_trends_summary_<NEW>.pptx        ← just-built
  analysis_results.json
  analysis_state.json
  commentary.json
  dashboard.html
  archive/
    <PRIOR_TS>/
      ...prior xlsx, pptx, and all four JSON/html sidecars...
```

To keep more history, raise the `keep_last_n` parameter in `archive_outputs()` from `1` to your preferred number.

---

## Data health check — check.js

> **Menu:** option **2** — or run directly:

```bash
node check.js       # validate data + DB connectivity before building
npm run check       # same via npm
```

Runs the same DB pipeline as `build_all.js` (fetches events from `usat_sales_db.event_data_metrics`, applies the active/excluded filter, then runs validation checks). Useful when you want to surface issues before committing to a full build.

Checks performed:
- **Duplicate sanction IDs** within each year
- **Unexpected status values** (e.g., `DRAFT`, `ADDITIONAL_ITEMS_NEEDED` — worth investigating)
- **Unexpected event type values** (anything outside the 4 known types)
- **Missing months** — calendar months with zero events in either year
- **Suspiciously large count changes** year-over-year (>30% swing triggers a warning)
- **Override conflicts** — sanction IDs in `overrides.json` not found in the active event list
- **Invalid segment names** in force_segment overrides
- **Cross-override conflicts** — same sanction ID in multiple override types

Exits with status 1 if errors are found (stopping a `check.js && build_all.js` pipeline). Warnings are informational — review and proceed if they're expected.

---

## Test suite — tests/

> **Menu:** options **25–33** (all / overrides / server / menu / smoke / glossary / downloads / build / roster) — or run directly:

```bash
node --test tests/                  # run every *.test.js
node --test tests/overrides.test.js # run one file
node --test tests/menu.test.js      # cheap: <1s, no DB needed
node --test tests/smoke.test.js     # cheap: <1s, parses every source file
```

Uses Node's built-in `node:test` runner (Node 18+) — no extra dependencies. Output is TAP-style: green `ok` lines for passes, red `not ok` with a stack trace for failures. The runner exits non-zero on any failure, so it composes cleanly with `&&` or CI.

### Files in tests/

| File | What it covers | DB needed? | Speed |
|---|---|---|---|
| `overrides.test.js` | Schema, migration, year scoping, apply, approve, stale (Steps 1 → 6 of the overrides ladder) | yes | seconds |
| `server.test.js` | Local server read + write endpoints, `/editor/` static files, dashboard integration, `/api/build` SSE (Steps 7 → 9.5) | yes (server boot reads it) | seconds |
| `menu.test.js` | Every menu item has id + label + action; ids are unique; actions are unique; the canonical action list is present; test-runner items point at real `tests/*.test.js` files | no | <1s |
| `smoke.test.js` | Parse-check every major source file (CJS `vm.Script` — same engine as `node --check`), require-check each module's exports, sanity-check pure helpers | no | <1s |
| `glossary.test.js` | Bottom-of-dashboard glossary is a default-closed `<details>` element and contains every required term (6 segments + 5 confidence values + calendar / organic + 7 other terms). Reads the most recent built `dashboard.html`. | no (reads built file) | <1s |
| `downloads.test.js` | The dashboard's Excel + PowerPoint Download buttons point at files that actually exist in the output dir, are same-directory paths (`./filename`), and follow the `<year>_event_calendar_analysis_*.xlsx` / `<year>_event_trends_summary_*.pptx` naming pattern. Also guards against the legacy `_v9f.xlsx` / `_v3.pptx` hardcoded names sneaking back in. | no (reads built file) | <1s |
| `build.test.js` | Commentary cache logic: hash stability (same input → same hash), sensitivity to whitelisted fields (segments / by-type / monthly / organic / calendar / override count / year scope / NO_AI flag), insensitivity to non-whitelisted fields (event names / sanction IDs / confidence / day-of-week / timestamps), cache loader behavior (missing file, valid JSON, malformed JSON). Also covers Slack-message formatters: success path labels (cache_hit / ai_fresh / rule_based / unknown), net sign handling (+/-/zero), missing-totals fallback, failure-message truncation (multi-line → first line only, 200-char cap). Pure functions only — doesn't call Claude, doesn't hit Slack, doesn't run a real build. | no | <1s |
| `roster.test.js` | Per-build roster snapshot. Pure-function tests for `build_roster_rows` (row count per match record, NULL handling on Lost/New single-sided rows, build_at + year scope on every row, 21-column tuple shape). DB-backed tests for `ensure_roster_table` idempotence, `insert_roster_snapshot` insert + count, two-build distinct-partition behaviour, and `prune_roster_table` keeping recent rows intact. DB tests use sentinel `baseline_year=1999 / analysis_year=2000` so test rows never collide with production data, and `before()`/`after()` scrub them. Skips gracefully if MySQL is unreachable. | yes (DB-backed half) | seconds |

The `menu.test.js` and `smoke.test.js` files are intentionally cheap — no DB, no network, no API key. Run them after any structural change (renaming a file, splitting a module, refactoring exports) to catch the easy regressions before the slow tests fire.

### What's covered

`tests/overrides.test.js` exercises the JSON-to-DB overrides chain (Steps 1 → 3 from the [Manual Event Overrides](#manual-event-overrides) section):

| Group | What it verifies |
|---|---|
| **Step 1 — schema** | `event_analysis_overrides` exists in `usat_sales_db`; all required columns present (`sid_baseline`, `sid_analysis`, `baseline_year`, `analysis_year`, `approved`, `approval_state`, lifecycle + audit fields); `idx_year_pair` index exists; legacy `sid_25` / `sid_26` columns are gone. |
| **Step 1 — `ensure_overrides_table()`** | Idempotent — a second call reports "already exists" and returns `false` (no fresh CREATE). |
| **Step 2 — `migrate_overrides_to_db()`** | `--dry-run` does not insert rows or rename the JSON file. |
| **Step 3 — `load_overrides()` year scoping** | Scoped rows return for matching year pair; excluded for mismatched year pair; global rows (`NULL`/`NULL`) return for every year pair; `stats` counts split globals vs scoped correctly; `active=0` rows are excluded; `approved` flag surfaces as a boolean. |
| **Step 3 — `apply_overrides()`** | `force_match` same month → `Retained`; different month → `Shifted`. `force_no_match` requires both sids — unlinks the pair with per-side segments (defaults: baseline → `Lost`, analysis → `New`). `force_segment` moves a record between segment arrays. Invalid segment names produce a warning. `null` overrides argument is handled gracefully. |
| **Step 3 — `summarise_overrides()`** | Returns `null` when there's nothing to report; returns a populated summary with `stats` when given input. |

### Database safety

Tests that need DB rows insert them with `created_by = 'test_suite'`. `before()` and `after()` both run `DELETE FROM event_analysis_overrides WHERE created_by = 'test_suite'`, so:

- A previous crashed run leaves no debris — the next run cleans up first.
- Real rows (with any other `created_by`) are never touched.
- The table is in the same state after the suite as before.

The suite needs a working `local_usat_sales_db_config()` — same credentials as `build_all.js`. If the DB isn't reachable, every test in the schema group fails fast with a clear MySQL error.

### When to run it

- After every change to `src/overrides.js`, `src/analysis.js`, `utilities/ensure_overrides_table.js`, or `utilities/migrate_overrides_to_db.js`.
- Before committing changes to `query_create_event_analysis_overrides_table.js`.
- As a smoke test after pulling new changes from another developer.

### Adding new tests

Drop additional `*.test.js` files into `tests/`. `node --test tests/` discovers them automatically. The existing file is the template — each `describe(...)` block groups related assertions, and `node:assert/strict` provides `equal`, `deepEqual`, `match`, `ok`, etc.

---

## Local server — server_event_analysis_8016.js

> **Menu:** option **19** — or run directly from the repo root:

```bash
cd /path/to/sql_programs                          # repo root
node server_event_analysis_8016.js                # default port 8016
npm run event_analysis_server                     # equivalent npm script
PORT=9000 node server_event_analysis_8016.js      # custom port via env
```

A minimal Express server exposing read + write endpoints for the event_analysis pipeline, plus the interactive override editor SPA. Lives at the repo root alongside the other `server_*.js` services for naming consistency — port 8016 follows the sequence (8014 = auto_renew, 8015 = scraper). Starts in the foreground; `Ctrl-C` stops it cleanly. **Visit `/editor/` for the interactive UI.**

### Read endpoints

| Endpoint | Returns |
|---|---|
| `GET /` | HTML index — lists endpoints, shows `curl` examples, links to the dashboard |
| `GET /api/status` | `{ ok, baseline_year, analysis_year, output_dir, time }` — health check |
| `GET /api/overrides` | `{ scope, force_match[], force_no_match[], force_segment[], stats }` — current-scope + global overrides. Honours `?baseline_year=YYYY&analysis_year=YYYY` query params; defaults to env vars. **Each row is enriched with `name_baseline`, `name_analysis`, `month_baseline`, `month_analysis`** by joining `event_data_metrics` for the (sid, year) pair — `null` if the underlying event was deleted from source data. |
| `GET /api/events?year=YYYY` | `{ year, count, total_in_year, include_excluded, events[] }` — events from `usat_sales_db.event_data_metrics`. Returns 400 if `year` is missing or out of range. Add `&include=excluded` to include CANCELLED/DECLINED/DELETED rows. |
| `GET /output/<file>` | Static-serves files from the analysis output directory (`dashboard.html`, `analysis_results.json`, `analysis_state.json`, `commentary.json`, the archive folder, etc.) |
| (any other path) | `404 { error: 'not found', path }` |

### Write endpoints (Step 8)

All write endpoints wrap the existing `cmd_*` functions in `ask.js` — same DB writes, same idempotent guards, same year-scope logic. Rows are tagged `created_by='server'` so you can tell from the DB which writes came in via HTTP vs CLI vs JSON migration. Validation runs before the wrapped `cmd_*` is invoked, so a 400 response never reaches the underlying function.

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/overrides` | `{ type, sid_baseline?, sid_analysis?, side?, segment?, note?, global? }` | 201 with `{ ok, type, status: 'inserted', id }` on insert, 200 with `status: 'exists' / 'updated'` on idempotent re-write, 400 on validation failure |
| `DELETE /api/overrides/:sid` | — | 200 with `{ ok, sid, removed }` (count) or 404 if nothing matched the current scope |
| `POST /api/approve/:sid` | optional `{ approved_by }` | 200 with `{ ok, sid, approved, missing_events }` — captures event signatures at approval time. 404 if no active override for the sid. |
| `POST /api/unapprove/:sid` | — | 200 with `{ ok, sid, unapproved }` — clears `approval_state` and signatures, keeps audit fields. 404 if no active override. |

**Type dispatch on `POST /api/overrides`:**

| `type` | Required body fields | Wraps |
|---|---|---|
| `force_match` | `sid_baseline`, `sid_analysis` | `cmd_add_match` |
| `force_no_match` | `sid_baseline`, `sid_analysis`; optional `segment_baseline` (default Lost), `segment_analysis` (default New) | `cmd_add_no_match` |
| `force_segment` | `side`, `sid_<side>`, `segment` (one of `Retained`, `Shifted`, `Lost`, `New`, `Recovered`, `Tried to Return`) | `cmd_add_segment` |

`note` and `global` are optional on every type. `global: true` writes `baseline_year` / `analysis_year` as `NULL` so the override applies across every year comparison.

**Curl examples:**

```bash
# Add a force-match override
curl -X POST http://localhost:8016/api/overrides \
  -H 'Content-Type: application/json' \
  -d '{"type":"force_match","sid_baseline":"311655-Adult Race","sid_analysis":"354307-Adult Race","note":"renamed"}'

# Mark a 2025 event as Lost (no 2026 equivalent)
curl -X POST http://localhost:8016/api/overrides \
  -H 'Content-Type: application/json' \
  -d '{"type":"force_no_match","sid_baseline":"311157-Adult Race","sid_analysis":"354307-Adult Race","note":"confirmed not same event"}'

# Force a segment label
curl -X POST http://localhost:8016/api/overrides \
  -H 'Content-Type: application/json' \
  -d '{"type":"force_segment","side":"baseline","sid_baseline":"310379-Adult Race","segment":"Lost"}'

# Approve + unapprove
curl -X POST http://localhost:8016/api/approve/311655-Adult%20Race
curl -X POST http://localhost:8016/api/approve/311655-Adult%20Race \
  -H 'Content-Type: application/json' \
  -d '{"approved_by":"skip@example.com"}'
curl -X POST http://localhost:8016/api/unapprove/311655-Adult%20Race

# Soft-delete (sets active=0)
curl -X DELETE http://localhost:8016/api/overrides/311655-Adult%20Race
```

### Try it

```bash
# In one terminal (from sql_programs/):
node server_event_analysis_8016.js

# In another:
curl http://localhost:8016/api/status
curl http://localhost:8016/api/overrides
curl "http://localhost:8016/api/overrides?baseline_year=2024&analysis_year=2025"
curl "http://localhost:8016/api/events?year=2026"
curl "http://localhost:8016/api/events?year=2026&include=excluded" | jq '.count'

# Open the dashboard through the server (works even from file://-blocked browsers):
open http://localhost:8016/output/dashboard.html       # macOS
xdg-open http://localhost:8016/output/dashboard.html   # Linux
start http://localhost:8016/output/dashboard.html      # Windows
```

### Year scoping

By default, `/api/status` and `/api/overrides` operate on the active year scope: `BASELINE_YEAR` / `ANALYSIS_YEAR` env vars if set, otherwise current calendar year vs prior year — same convention as `ask.js` and `build_all.js`. Per-request scoping is supported via query params on `/api/overrides` (useful for the dashboard to switch year pairs without restarting the server).

### CORS

CORS is enabled (`*`) so a future dashboard served from another origin (`file://`, a different port, etc.) can hit the API directly. Tighten this when production hosting becomes relevant.

### Override editor — two surfaces, one API

The editor exists in two places, both backed by the Step 8 API:

1. **Dashboard-integrated panel (default)** — embedded directly in `output/dashboard.html`. A new "Override" column in the event roster shows live status per event; clicking a row focuses the editor panel below the table and pre-fills the sanction ID. A sticky "rebuild needed" banner appears after any edit, with a "Rebuild now" button that streams `build_all.js` output and reloads on success.
2. **Standalone SPA at `/editor/`** — same logic, on its own page. Useful as a power-user view for scanning all overrides without scrolling through the roster, or when the build-time dashboard is stale.

Both surfaces talk to the same write endpoints, so you can mix-and-match: edit in the dashboard, verify in `/editor/`, or vice versa.

**Event names alongside sanction IDs.** Every override row in both surfaces shows the human-readable event name under each sid pill (e.g. `311655-Adult Race · Alpha Win Sarasota FL`). The names come from a server-side join in `/api/overrides` against `event_data_metrics` — when the underlying event has been deleted from source data, the UI shows `(event no longer in DB)` rather than hiding the row. No client-side state to keep in sync, no `/api/events` round-trip from the panel.

#### `/editor/` standalone SPA

A small vanilla-JS UI for managing overrides in the browser. Visit `http://localhost:8016/editor/` while the server is running.

What it shows:
- **Status bar** — current year scope, total override count, server-connection indicator, refresh button
- **Active overrides table** — type pill (match / no-match / segment), sanction IDs, scope (global or scoped), approval state (`◦ unapproved`, `✓ approved`, `⚠ stale`), action buttons
- **Action buttons per row** — `✓ Approve` / `↶ Unapprove` (mutually exclusive based on state) and `✕ Delete` (soft-delete via `DELETE /api/overrides/:sid`)
- **Add override form** — type selector with dynamic fields:
  - `force_match` → both sanction IDs required
  - `force_no_match` → both sanction IDs required + per-side segment dropdowns (baseline → Lost, analysis → New defaults)
  - `force_segment` → side + sanction ID + segment selector
  - Optional note and a `Global (any year pair)` checkbox (writes NULL/NULL year scope)
- **Toast notifications** for every action's success or error
- **Auto-refresh** after any mutation — the table always reflects current DB state

Architecture: 3 files in `src/event_analysis/public/` (`index.html`, `editor.css`, `editor.js`), static-served by the local server at `/editor/`. No build step, no framework, no client-side dependencies — just `fetch()` against the same-origin write endpoints from Step 8.

What's deliberately out of scope (punted to Step 10 or beyond):
- Event search / browse from the standalone SPA — find sanction IDs by name. Use the CLI (`node ask.js --list-overrides`) or the dashboard's roster filter (search box + Segment/Type/Month/Status dropdowns) for now.
- Bulk approve / bulk delete
- History or audit-trail UI
- Authentication (server is bound to localhost; not safe to expose)

#### Dashboard-integrated panel

The build-time dashboard (`output/dashboard.html`) ships with the same editor embedded below the event roster. Things to know:

- **Year-dynamic column headers.** All paired-year column labels (`Mo`, `Sanction ID`, `Date`, `Day`, `Event Name`, `Status`) and chart dataset labels are rendered from the `ya` / `yb` template variables, which come from `results.years.BASELINE_YEAR` / `results.years.ANALYSIS_YEAR`. The Download buttons read their target filenames from `results.downloads.xlsx` / `results.downloads.pptx`, populated by `build_all.js` with the actual timestamped basenames it writes, so the links always point at files that exist. When the analysis years roll over (e.g. 2026 vs 2027), the dashboard adjusts automatically — no source edits required.
- **Column order per year:** `Mo · Sanction ID · Date · Day · Event Name · Status`. Date and Day sit adjacent so the weekday context is right next to the date.
- **New "Override" column** in the roster. Shows `—` for events without overrides, or `match` / `no-match` / `seg` pill plus `✓ approved` / `◦ unapproved` / `⚠ stale` state. Populated by a `GET /api/overrides` call on page load; updates after every mutation.
- **Roster filters.** Above the table: a search box (matches name OR sanction ID across either year, so a paste like `311655-Adult Race` or just `311655` works), plus four multi-select dropdowns — Segment, Type, Month, **Status** — that chip-render into a "Filters:" row below the toolbar. The Status dropdown is populated dynamically from the unique `Status YA` / `Status YB` values present in the roster. A Reset button next to the search clears everything.
- **Three chip bars** above the table (Segment / Type / Month) with show/hide toggles. Each chip shows count + `% of N shown`, and clicking a chip toggles the matching dropdown filter. All percentages recompute against the visible total whenever the table is filtered — so the chips always describe what's actually in front of you. Month chips count a row once for the baseline month and once more for the analysis month only if the two months differ (shifted events get a foot in two months). A small **Show:** row of toggle pills above the bars lets you hide any of the three; defaults are **Segments + Types visible, Months hidden**. Choice persists in `localStorage` so the page remembers your preference.
- **KPI cards in row 2** show count, percentage, AND the denominator (e.g. "of 1,178 2025 events") as an italic caption. Each card divides by its appropriate year total — `n_baseline` for Retained / Shifted / Lost / Tried to Return, `n_analysis` for New / Recovered.
- **📖 Glossary card at the bottom of the page**, default-collapsed. Click to expand for plain-English definitions of every term the dashboard uses: the six segments, the five confidence values (Exact / Exact-Shifted / Cross / Override / N/A) with examples, calendar-expected vs organic delta (with a worked weekend-days example), plus net change, sanction ID, active event, override lifecycle (approved / unapproved / stale), and worst month. Aimed at readers who didn't build the model. Audited by `tests/glossary.test.js` (menu option **26**), so adding a new term means updating both the dashboard and the test's `REQUIRED_TERMS` list — a regression in either direction trips the test.
- **Override editor is collapsible** — the whole editor panel sits inside a native `<details>` element. Default = **closed** for first-time visitors (the editor is a power-user tool; most viewers don't need it open). Open/closed state persists across page reloads via `localStorage('dash_ov_editor_open')`. The server-status pill (`● checking server… / ● connected / ● error`) stays in the summary bar so the connection state is visible even when the editor is collapsed. Roster-row clicks auto-expand it so the focus-an-event flow still works.
- **Override list filters** — above the "Active overrides" list, a compact row of three controls: a free-text **search** input that matches across `sid_baseline`, `sid_analysis`, event names, and the note; a **type** dropdown (`All types / force_match / force_no_match / force_segment`); and a **status** dropdown with four non-overlapping buckets — `Approved` (approved AND not stale), `Unapproved`, `Stale` (approved AND staleness flag set), and `All`. Filters combine with AND semantics. When any filter is active, the summary line prefixes with "Showing X of Y" and an `× clear` link appears that resets all three to defaults. Filter state persists across page reloads via `localStorage('dash_ov_list_filters')`. The filtering logic lives in the pure `dash_ov_apply_list_filters(items, filters)` helper so it can be unit-tested directly.
- **Add-override form validates client-side before POSTing** — three checks run in order: (1) **required fields by type** — `force_match` and `force_no_match` both need a baseline AND an analysis sid, `force_segment` needs the sid matching the Side dropdown; (2) **SID exists in the right pool** — at boot the page builds `BASELINE_SIDS` and `ANALYSIS_SIDS` from the rendered `ROSTER`; if a submitted sid is in the OTHER pool the error says "'354307-Adult Race' is an analysis-year sid; move it to the Analysis box", and if it's in neither pool the message is "doesn't match any event in the current roster"; (3) **same sid in both boxes** is rejected as a self-link. Bad inputs get a red border, aggregated messages appear in `#dash-ov-form-err` below the Add button, and editing any flagged field drops its border (and clears the message div when no fields remain flagged). The submit is blocked when validation fails. Validation lives in the pure `dash_ov_validate_add_form({fields})` helper so the rules can be unit-tested without driving the DOM.
- **Click any row** → highlights it, scrolls the editor panel into view, pre-fills the sanction ID(s) in the add-override form. Click the row again (or the "clear" link in the focused-event card) to deselect.
- **Sticky "rebuild needed" banner** appears at the top of the page after any edit, since the charts/KPIs/segment counts are computed from `ROSTER` at build time and don't reflect new overrides until you rebuild. The banner has a **Rebuild now** button that streams `build_all.js` output into a collapsible log and auto-reloads the page on success.
- **Ad-hoc year rebuild** — at the bottom of the rebuild card, a collapsed `⚙ Rebuild with custom years (ad hoc)` section expands to reveal two number inputs (baseline + analysis year) and a "Rebuild with these years" button. Sends the year pair to `/api/build?baseline_year=YYYY&analysis_year=YYYY`, which forwards them as CLI flags to the child process. No `.env` changes — subsequent default rebuilds revert to the project-wide scope. **Client-side validation** refuses to fire the request when both years are blank, when either value isn't a 4-digit integer, or when either is outside `[2000, current_year + 5]`. An inline error appears under the inputs and the error clears as soon as you start editing — this stops bad input from getting to the backend (where it would only surface as a vague 500 in the streaming log).
- **Reviewed? checkbox** at **column 3** (right after Conf — the first action column). Quick way to mark a match (or non-match) as reviewed-and-correct. Creates an approved override in `event_analysis_overrides` tagged `created_by = dashboard:review`. Picks the right override type for each row: `force_match` for matched pairs (Retained / Shifted / Tried to Return / Recovered), `force_segment` with the row's existing segment for single-sided rows (Lost → `force_segment` with `segment=Lost`; New → `force_segment` with `segment=New`). Unchecking soft-deletes the override and clears `approved` + `approval_state` in the same UPDATE — the invariant `active=0 ⇒ approved=0` is enforced both on the soft-delete write path and via an idempotent backfill in `ensure_overrides_table` that runs on every build. The Reviewed? column is also sortable: click the header to bring reviewed rows to top (descending) or unreviewed to top (ascending).
- **Optional Override + override-info columns** (toggle from ⊞ Columns, with **All / None** buttons at the top of the dropdown): "Override" (the pill), "Override type", "Approved", "Override note" all sit between Reviewed? and Type when enabled. Override and the three info columns all sort via the `_dash_ov_lookup` bridge — Approved sort bucketed `stale → unapproved → approved → no-override` so trouble surfaces first.
- **Optional Event Created columns** (toggle from ⊞ Columns): "Created YA" and "Created YB" show the source-system creation date for each side. The "Events by creation month" chart in the row above is sourced from the same data.
- **Date + Event Created cells render in combined `Mon., YYYY-MM-DD` format** via a `fmt_date_with_day(day, date)` helper, with the standalone Day column dropped. Day-of-week is pre-computed at roster build time using UTC parsing + `getUTCDay()` so weekdays don't shift by viewer timezone.
- **Month columns sort chronologically** (Jan → Dec) instead of alphabetically (Apr / Aug / Dec / …) — special-case in the comparator that uses month-index instead of string compare.

#### Dashboard analytics — creation-timing chart family

Three related charts sit in the dashboard's chart rows. All three power the same question: **how are events created over time, and is that pace changing year-over-year?**

1. **Events by creation month** (stacked bars). For events that started in the selected year, bars show the creation-month volume stacked by event type. Year picker + single-type filter dropdown sit in the chart's subtitle. Tooltip shows per-type counts plus a **Total** footer line. Inline data labels render inside each stacked segment when there's vertical room. Full action-button strip (⤢ Expand · ⬇ PNG · ⬇ CSV · ⇄ Table).

2. **Creation pace** (cumulative-% line chart). Two curves — baseline year (blue) and analysis year (orange) — both indexed by lead time in days (event start minus creation date, capped at 365). At each X, the line shows the cumulative % of events created with ≤ X days of lead time. Below the chart: a **live hover readout** that updates as you move across the curve, and a **median-based conclusion** line that reads "Median lead time: 2025 = 90d · 2026 = 75d → 2026 is pacing BEHIND by 15 days (creating events closer to start)." A flatter-on-the-left curve means events booked further ahead; a steeper-on-the-left curve means more last-minute bookings.

3. **Creation timing — relative to event year** (grouped bars). For each relative-month offset, two bars — one per event year. The offset convention skips zero: **+1 to +12 = Jan to Dec of the event year**; **−1 = December of the prior year**, **−2 = November of prior**, down to **−24 = January two years prior**. This means "Mar 2025 for 2025 events" and "Mar 2026 for 2026 events" both land at **+3** — a direct YoY comparison at the same calendar position relative to event year. Year filter (Both / baseline / analysis) + single-type filter sit in the subtitle. Tooltip shows per-year count plus Total. Full action-button strip.

All three charts register in `CHARTS` and `CHART_SNAP` so the expand-modal, PNG, CSV, and table-flip buttons work identically to the other dashboard charts.

The integrated panel only activates when the dashboard is opened *through the server* (`http://localhost:8016/output/dashboard.html`). Opening as `file://` shows the panel but with a "server offline" hint in the status chip; you can still see the build-time data, just no live editing.

#### Step 9.5: `GET /api/build` — Server-Sent Events build stream

Powers the dashboard's "Rebuild now" button. Spawns `node src/event_analysis/build_all.js`, streams stdout/stderr line-by-line as SSE events, and sends a final `done` event with the exit code.

```
event: out
data: Fetching events from usat_sales_db...

event: out
data:   2025 rows fetched: 1178  |  2026 rows fetched: 1166

event: done
data: 0
```

Client usage:

```js
const es = new EventSource('/api/build');
es.addEventListener('out',  e => log.append(e.data + '\n'));
es.addEventListener('err',  e => log.append('[err] ' + e.data + '\n'));
es.addEventListener('done', e => {
  if (e.data === '0') location.reload();
  es.close();
});
```

Concurrent build attempts return `409 Conflict`. The lock releases when the build finishes (or the client disconnects mid-build — the server kills the child process).

What's deliberately out of scope (punted to Step 10 or beyond):
- Bulk approve / bulk delete from the UI (CLI `--approve` / `--unapprove` still works for one at a time).
- Bulk approve / bulk delete
- History or audit-trail UI
- Authentication (server is bound to localhost; not safe to expose)

Cascade rules (pattern-based overrides like "every Adult Clinic in May named X → Lost") are Step 10.

---

## Scheduled builds — utilities/cron_get_event_analysis_build/

A thin cron-style wrapper that triggers the build on a schedule by calling the local server. Two files, mirroring the `cron_get_auto_renew` / `cron_get_events_data` / etc. pattern used by the other automation jobs in this repo:

```
utilities/cron_get_event_analysis_build/
├── run_script.sh    # Detects OS user, resolves node + script paths, runs script.js, prints timing
└── script.js        # fetch('http://localhost:8016/api/build') and log the response
```

**How it works.** `/api/build` is a Server-Sent Events endpoint — the server streams build-log lines over an open HTTP connection while `build_all.js` runs, then closes the connection when the build finishes (~80s with AI, ~7s cached or rule-based). The cron's `response.text()` patiently reads everything that streamed and resolves with the full log only when the server closes the stream. Net effect: **the cron blocks for the duration of the build, then logs and exits.** Exactly the semantics you'd want from a scheduled job.

**Requires the server to be running.** Same prerequisite as the dashboard's "Rebuild now" button — `/api/build` is a server endpoint, not a direct invocation of `build_all.js`. Pair the cron with whatever launches `server_event_analysis_8016.js` on the target host (pm2, systemd, Task Scheduler with auto-start, etc.).

**Registration.** Same as the other crons in `utilities/cron_*/`. On Linux: a crontab entry pointing at `run_script.sh`. On Windows: a Task Scheduler task pointing at `run_script.sh` (Git Bash) or a thin `.bat` wrapper. The shell script auto-detects the OS user (`steve-calla` / `usat-server` / `calla`) and picks the right node path + JS-file path. No code changes required between hosts.

**The success/failure Slack notification fires from inside the build itself** (see "Slack notification on build complete" above), so the cron doesn't need any additional notification wiring — the existing build pipeline handles it. You'll see a `:white_check_mark: event_analysis build · …` (or `:x: … FAILED`) message in `#steve_calla_slack_channel` once the cron-triggered build completes.

---

## Restricting access — `ALLOWED_IPS` middleware

A single env var gates the local server with an IP allowlist. **Dormant by default** — when `ALLOWED_IPS` is empty or unset, the middleware is a no-op and every request proceeds (current behaviour, no regression).

**Activate:**

```bash
# .env (or set in the shell before launching the server)
ALLOWED_IPS=127.0.0.1,192.168.1.50
```

Restart the server. Now only those IPs reach any route on the server — `/api/*`, the dashboard, the editor SPA, everything. Other clients get `403 Forbidden` with a JSON body containing the rejected IP for debugging.

**Implementation:**

- Middleware lives at the top of `create_app()` in `server_event_analysis_8016.js` and runs before any route handler.
- Reads `process.env.ALLOWED_IPS` once at app construction. Comma-separated list.
- Normalises IPv6-mapped IPv4 (`::ffff:127.0.0.1` → `127.0.0.1`) so plain dotted-quad addresses match localhost connections.
- Logs each rejection: `[allowlist] 403 — rejected <ip> for <METHOD> <path>`.
- A one-time activation log fires at server startup: `IP allowlist ACTIVE — N address(es) allowed: ...`.

**Looker Studio + production privacy:**

For real production privacy, the recommended approach is **Cloudflare** at the edge — IP allowlist, Cloudflare Access policies, service tokens, etc. The Node server's `ALLOWED_IPS` is a backstop / dev-mode lever, not the main fence.

For Looker Studio specifically, Google publishes the IP ranges its connectors operate from. Either:
- Allow those ranges at the Cloudflare WAF level (recommended — Cloudflare auto-updates its understanding of Google ranges)
- OR add Cloudflare's egress IP to `ALLOWED_IPS` on the Node server (so Looker → Cloudflare → origin succeeds even with the allowlist active)

Either way, the server only needs to know about Cloudflare's IP (or your office's, etc.) — Cloudflare handles the upstream filtering.

**Disable:** delete the `ALLOWED_IPS` line from `.env` (or `unset ALLOWED_IPS`) and restart. The middleware becomes a no-op again.

---

## Historical roster snapshots — `event_analysis_roster` table

Every build writes its full event roster to a MySQL table in `usat_sales_db`. Same shape as `dashboard.html`'s inlined `ROSTER` constant and the xlsx `step_4_event_detail` tab — one row per event, tagged with the build's timestamp. The table accumulates across builds so you can query trends, diff two consecutive builds in SQL, or feed BI tools (Tableau / Looker / Metabase) without parsing JSON files in the archive folder.

**Schema** (21 columns, `event_analysis_roster`):

| Column | Type | Purpose |
|---|---|---|
| `id` | BIGINT AUTO_INCREMENT PK | row id |
| `build_at` | DATETIME | which build wrote this row (the partition key) |
| `baseline_year` / `analysis_year` | SMALLINT | year scope at build time |
| `seg` | ENUM | Retained / Shifted / Lost / New / Recovered / Tried to Return |
| `conf` | VARCHAR(30) | Exact / Exact-Shifted / Cross / Override / N/A |
| `type` | VARCHAR(20) | Adult Race / Youth Race / Adult Clinic / Youth Clinic |
| `override_id` | INT NULL | FK → `event_analysis_overrides.id` when an override produced this row |
| `sid_baseline` / `name_baseline` / `month_baseline` / `date_baseline` / `day_baseline` / `status_baseline` | VARCHAR / DATE | baseline-year event fields, NULL on New/single-sided rows |
| `sid_analysis` / `name_analysis` / `month_analysis` / `date_analysis` / `day_analysis` / `status_analysis` | VARCHAR / DATE | analysis-year event fields, NULL on Lost/single-sided rows |
| `schema_version` | TINYINT | starts at 1; bumped on column additions |
| `extras_json` | JSON NULL | parks experimental fields without a migration |
| `created_at` | TIMESTAMP | row write time |

Indexes on `build_at`, `(baseline_year, analysis_year, build_at)`, and `(seg, build_at)`.

**Write path.** At the top of `build_all.js`, `utilities/ensure_roster_table.js` creates the table if missing (idempotent — no-op on every subsequent build). After `run_analysis()` completes, `utilities/insert_roster_snapshot.js` bulk-inserts the full roster with the current `build_at`. Wrapped defensively — a DB outage logs a warning but doesn't fail the build, since the snapshot is a secondary historical record and the build's primary outputs (HTML / xlsx / pptx) don't depend on it.

**Skip the DB write entirely** by passing `--no-db-roster` (menu option **4** "Build (skip roster DB write)" wires this for you). The build runs exactly the same — same Excel, same PowerPoint, same dashboard, same Slack notification — but the `INSERT` + retention prune are bypassed and replaced with a single log line. Useful when you're iterating locally and don't want every test build to land in the historical record.

**Tiered retention.** `utilities/prune_roster_table.js` runs after the insert and applies a four-tier retention policy so the table stays bounded over years of daily builds:

| Age window | Granularity kept | Rationale |
|---|---|---|
| Last 48 hours | every build | Full fidelity during active iteration — captures override-tweak spikes (10+ builds in one afternoon) |
| 48 hours – 30 days | one build per day (latest of each day) | Day-level snapshot once iteration cooled off |
| 30 – 90 days | one build per week (latest of each ISO week) | Medium-term trend granularity |
| Older than 90 days | one build per month (first of each month) | Permanent monthly archive |

Steady-state size is **~150–200K rows**, regardless of how many years the table has been accumulating. The SQL uses `ROW_NUMBER() OVER (PARTITION BY ...)` per tier to compute the keep-set, then `DELETE` rows whose `build_at` isn't in it. Idempotent — re-running 5 seconds later is a no-op.

**No read path yet.** Nothing in the dashboard or API queries this table. It's parked for future use:

- Ad-hoc SQL trend queries (`SELECT seg, COUNT(*), build_at FROM event_analysis_roster GROUP BY ...`)
- BI-tool integration (point Tableau / Looker at the table directly)
- A future "compare two builds" UI that joins on `build_at` self-joins
- Diff queries — "which events flipped segments since last week's build?"

Building any of these is a separate, deferred step. For now the table is write-only; reads are SQL ad-hoc.

**Tests** — see `tests/roster.test.js` (menu option **33**). Pure-function tests cover row construction without touching the DB; integration tests use a sentinel year (1999/2000) so fixture rows never collide with production data and get scrubbed by `before()`/`after()` hooks.

---

## HTML Dashboard — output/dashboard.html

> **Menu:** option **3** (opens in browser automatically) — or open the file manually:
> `output/dashboard.html`

Every build generates a self-contained HTML dashboard you can open in any browser — no PowerPoint, no Excel needed. Useful for sharing a quick visual overview with people who don't need the full workbook.

**Charts included:**
- Monthly event delta (raw Δ bar + organic Δ line overlay)
- Segment breakdown donut (Retained / Shifted / Lost / New / Recovered)
- Event counts by type — grouped bar comparing both years
- Calendar expected vs organic delta scatter (labelled by month)
- Key findings summary bullets (from commentary engine)

**KPI header cards:** net change, current-year total, lost count, new events added, retention rate.

The dashboard shows a warning badge if manual overrides are active, and labels the commentary mode (AI or rule-based).

---

## Diff report — output/changes.txt

> **Menu:** option **16** to view  |  option **15** for AI summary (`node ask.js --what-changed`)

Every build that has a prior run in `output/archive/` generates a `changes.txt` comparing:
- Key metric changes (total events, segments, net)
- Narrative changes (what text changed in each slide narrative)
- Commentary mode changes (rule-based → AI or vice versa)
- Active overrides applied

Useful for: reviewing what changed after re-running mid-cycle, verifying that override changes had the expected effect, or documenting analysis decisions over time.

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

Segments: `Retained` | `Shifted` | `Lost` | `Tried to Return` | `Recovered` | `New`

Match confidence: ~85–90% at event level. Remaining mismatches c
# AI "Ask Your Data" — Design (race_results_transform)

Status: BUILDING (Step 2). 2.1 approved.

## Build progress
- [x] 2.2 `ask/db.js` — read-only pool (prefers ASK_DB_* creds, else local config) + catalog/allowlist (events table only).
- [x] 2.3 `ask/sql_guard.js` — hardened SELECT-only guard (strip comments/strings, block writes/DDL/DoS, single-statement, table allowlist, LIMIT inject/clamp). Tests: `tests/ask_db.test.js`, `tests/ask_guard.test.js` (describe-wrapped). Plus `ask/demo_guard.js` (hands-on ACCEPT/REJECT review) + menu items (AI-ask tests & guard demo).
- [x] 2.4 `ask/context/events_context.yaml` + `ask/context.js` (grounding: rules, event glossary, metric defs, example questions; plan/answer prompts).
- [x] 2.5 `ask/tools.js` (get_schema_text + run_query: guard+execute+row-cap+truncated, injectable pool) + `ask/providers/{openai,anthropic}.js` (uniform chat()).
- [x] 2.6 `ask/ask.js` — plan -> guard -> run -> repair once on error -> synthesize. OpenAI/Claude selectable. provider+pool+schema injectable.
- [x] 2.7 tests: `tests/ask_context.test.js` + `tests/ask_pipeline.test.js` (mock provider+pool; happy/repair/give-up/truncation). Plus CLI `cli.js ask` + menu "AI — ask your data" section.
- NOTE: v1 uses a SIMPLE plan->guard->run->repair->answer pipeline (one table, full schema in the prompt). The full agentic tool-loop (chatgpt_like) is reserved for when the catalog grows to many tables (see §16G); it would slot in behind the same ask() interface.

## 1. Goal
Let a user ask a plain-English question and get a grounded, accurate answer from the
usage-analytics data — exposed on two self-contained surfaces:
- the `/metrics` dashboard (an "ask" box), and
- the CLI (`cli.js ask "<question>"`).
The user can choose the model: **ChatGPT (OpenAI)** or **Claude (Anthropic)**.

## 2. Facts that shaped this design
- The **local MySQL is the source** that BigQuery is shipped from (same data + more
  preliminary tables), so we query MySQL directly — not a downgrade from BigQuery.
- The reference bot **`bot_analyst_chatgpt_like`** answers substantially better than
  `bot_analyst` because of: (a) an **agentic tool-loop** (discover source -> inspect
  schema -> run query -> refine), (b) a **rich context yaml**, (c) a **hardened SQL guard**.
  We port that one.
- Surfaces are **self-contained** (dashboard + CLI), so the agent must run its own
  reasoning loop. MCP (where the *client* runs the loop) is an OPTIONAL later surface.

## 3. Architecture
```
  CLI  ───┐                         ┌── providers/openai.js   (responses + tools)
          ├──>  ask(question,opts) ─┤
  /metrics ┘        (the "brain")   └── providers/anthropic.js (messages + tools)
                         │
                         ├── tool-loop (MAX_STEPS cap)
                         │
                         ▼
                 core tools (plain functions)
                 list_tables · suggest_tables · get_schema · run_query
                         │
                         ▼
                 sql_guard  ->  read-only MySQL pool  (table allowlist)
```
Build the **core tool layer once**; the loop + providers sit above it; surfaces sit above that.
MCP later = register the same core tools in an MCP server (client provides the loop).

## 4. Module layout (proposed)
```
src/race_results_transform/metrics/ask/
  ask.js                 # entry: ask(question, { provider, model, max_steps }) -> result
  loop.js                # provider-agnostic tool loop
  providers/
    openai.js            # OpenAI /v1/responses + tools  (port from chatgpt_like)
    anthropic.js         # @anthropic-ai/sdk messages + tools (mirror event_analysis/ask.js)
  tools.js               # list_tables / suggest_tables / get_schema / run_query
  sql_guard.js           # hardened MySQL SELECT guard
  db.js                  # read-only mysql2 pool (own creds) + catalog/allowlist
  context/
    events_context.yaml  # grounding (field hints, metric defs, narrative guardrails)
  tests/                 # guard + loop(mocked LLM) + catalog tests
```

## 5. The `ask()` interface
```
ask(question, {
  provider = 'openai' | 'anthropic',
  model    = '<provider model id>',
  max_steps = 6,
}) -> {
  answer,        // final natural-language answer
  sql,           // the SELECT that produced it (last run)
  rows,          // result rows (capped)
  steps,         // tool-call trace (for transparency / debugging)
  provider, model
}
```

## 5b. Two answer modes
- **Data question** -> plan a SELECT -> guard -> run -> synthesize from rows.
- **Definition question** ("what does scorecard_band mean?") -> the planner replies `NO_SQL` -> we answer
  straight from the grounding context (no DB query). Keeps meaning-of-the-data questions from forcing an
  empty SQL result.

## 6. Core tools (MySQL versions of the chatgpt_like tools)
- **list_tables()** — the allowlisted catalog (starts with `race_results_transform_events`).
- **suggest_tables(question)** — rank catalog tables for the question (keyword/intent).
- **get_schema(table)** — columns + types from `information_schema` (+ context hints).
- **run_query(sql)** — guard -> execute read-only -> return capped rows.

## 7. SQL guard (hardened, MySQL)
Reuse chatgpt_like's comment/string-stripping scan, plus MySQL specifics:
- SELECT / WITH only; block INSERT/UPDATE/DELETE/DDL/etc.
- **Single statement** — reject `;`-separated multi-statements.
- **Enforce LIMIT** — inject/clamp a max (e.g. 1000) if absent.
- **Table allowlist** — query may only reference catalog tables.
- Strip comments + string literals before keyword scanning (can't hide `DROP` in a string).
- Defense-in-depth: the DB user is **read-only** regardless.

## 8. Providers + model selection
- **OpenAI** (`providers/openai.js`): raw `fetch` to `/v1/responses` with `tools` (port of
  chatgpt_like). Default model from `OPENAI_MODEL`.
- **Anthropic** (`providers/anthropic.js`): `@anthropic-ai/sdk` `messages.create` with `tools`
  (mirrors `src/event_analysis/ask.js`). Default `claude-sonnet-4-6` (haiku = cheap option).
- Selection: CLI `--provider/--model`, dashboard dropdown. Shared loop; only request/response
  shaping differs per adapter.
- Build order: **OpenAI first (proven), then Anthropic** so quality doesn't regress.

## 9. Context grounding (`events_context.yaml`) — the accuracy lever
Mirrors the chatgpt_like 448-line yaml, adapted to the events schema. Sections:
- **glossary** — what each `event_name` means (page_view, file_uploaded,
  conversion_completed, download, split_download_used, start_over, theme_changed, ...).
- **table_field_hints** — per-column meaning + gotchas (e.g. use `created_at_mtn` for
  Mountain-time reporting; `visitor_id` = anonymous per-browser; `page_path` = which page).
- **metric_conventions / metrics** — definitions lifted from `metrics_report.js`
  (visits = page_view, conversions = conversion_completed, completion rate, auto-map %, etc.).
- **narrative_guardrails** — answer in aggregate; never imply identity from `visitor_id`;
  say "not observed" when data is missing.
- **sql_guardrails** — MySQL date handling, prefer `created_at_mtn`, always aggregate.

## 10. Safety model
- **Comprehensiveness vs LIMIT:** answers come from AGGREGATION (COUNT/SUM/GROUP BY) computed over the
  WHOLE table -> tiny result; `LIMIT` only caps rows RETURNED, so aggregate answers are complete even on
  huge tables. The context yaml instructs "always aggregate, never raw-row dumps".
- **Truncation transparency (2.5):** `run_query` returns `{ rows, row_count, truncated, applied_limit }`;
  when the cap is hit, `truncated=true` and the system prompt makes the model say "showing first N of more".
  The agent may also run a `COUNT(*)` first to reason about completeness. Cap is configurable.
- Read-only DB user + table allowlist + guard + enforced LIMIT + row cap + `max_steps` cap.
- Dashboard route is auth-gated (reuses the `mx_session` auth from #7).
- Privacy: events are already anonymous (no PII); guardrails forbid identity claims.
- Cost: each question = multiple LLM calls (the loop); cap steps; show the trace.

## 11. Surfaces
- **#8 CLI**: `cli.js ask "<q>" [--provider --model]` + a menu item; prints answer + SQL + table.
- **#9 dashboard**: auth-gated `POST /api/metrics-ask` + an ask box + provider/model dropdown,
  rendering answer + the SQL + a small result table; reuses the same `ask()` brain.
- **#5 MCP (optional, later)**: an MCP server registering the core tools; Claude/Cowork drives
  the loop. Same `db.js` + `tools.js` + `sql_guard.js`, no rework.

## 12. Tests (no live LLM in the suite)
- guard: rejects writes / multi-statement / missing-LIMIT; allows valid SELECT; allowlist.
- loop: a mocked provider returns a canned tool-call then answer; asserts the loop runs tools.
- catalog/schema: get_schema returns the events columns; allowlist enforced.

## 13. What I can build vs what I need from you
**I can draft autonomously (strong first pass):**
- All code (tools, guard, loop, both providers, CLI + dashboard wiring, tests).
- A solid `events_context.yaml` built from the table DDL + the business logic already
  encoded in `metrics_report.js` (so metric definitions match the dashboard exactly).

**I need from you:**
1. **Read-only DB user** on the Linux server for this brain (or OK to reuse the existing
   local analytics creds — read-only strongly preferred). Provide host/user/pass/db via `.env`.
2. **Model defaults**: confirm `OPENAI_MODEL`, and the default Claude model (`claude-sonnet-4-6`?).
3. **Scope**: v1 = `race_results_transform_events` only? (recommended) Any other tables for v1?
4. **Domain polish for the context yaml** (iterative): 5-10 real questions you'd actually ask,
   plus any business definitions/gotchas not visible in the code. I draft from code first; you refine.
5. Confirm OK for me to read `src/event_analysis/ask.js` closely when building the Anthropic adapter.

## 14. Build sequence
2.2 db.js (read-only pool + catalog) -> 2.3 sql_guard.js -> 2.4 events_context.yaml ->
2.5 tools.js -> 2.6 providers + loop + ask.js -> 2.7 tests -> #8 CLI (done) -> #9 dashboard ask box (DONE: auth-gated POST /api/metrics-ask + GET /api/metrics-ask-models, '#ask-panel' on /metrics) -> Step 5 (optional): MCP server (wrap the same db/tools/guard so Claude/Cowork can drive the loop).

## 15. Open decisions to confirm
- Default provider (OpenAI or Claude)?
- `max_steps` cap (default 6) and row/LIMIT caps (default 1000)?
- Module location: `src/race_results_transform/metrics/ask/` (proposed) — ok?

## 15c. Polish batch 1 (done)
- UX: textarea (autofocus, Enter/Shift+Enter, x-clear, clears + shows question above answer), Sign-out link, model dropdown.
- Answer guardrails: Mountain Time only (created_at_mtn, never UTC); report only what rows show (no fabricated clauses/reasons; empty -> "no matching rows"); dashboard_view client fields are NULL by design (server-logged).
- Example question added: most-recent activity per visitor.

## 15d. Polish batch 1b (done)
- Ask box restyled as an auto-growing composer textarea (grows as the question wraps; removed the manual resize handle); question is NOT cleared after asking; output scrolls horizontally instead of stretching.
- Sign-out is in-page (fetch + toast) instead of navigating to a generic page.
- Dates/times now returned as Mountain-Time STRINGS via DATE_FORMAT(created_at_mtn, ...) (fixes UTC `...Z` values in result rows).
- Aggregation rule softened: list/recent/"in a table" requests are allowed as small ORDER BY ... LIMIT listings, so models no longer refuse them (fixes one model answering, another refusing).

## 15e. Polish batch 2 (done)
- Ask box restructured: full-width auto-growing textarea on top, model/clear/Ask in a row beneath (composer layout).
- Suggested-question chips (A5); markdown rendering of answers incl. tables (A6).
- Response format guardrail: lead with the bold headline number, table for multi-row (E1).
- Listings allowed for list/recent/table requests (E2); dates as MT strings via DATE_FORMAT (E4); no fabricated reasons (E3); NULL client-field note (I1); user-activity excludes dashboard_view (E5).
- Injection test suite `tests/ask_injection.test.js` + guard hardened (blocks load_file) (D1); ask-box UX e2e (D2).
- Audit log (C1): every dashboard ask is appended to `metrics/ask/ask_log.jsonl` (gitignored, no PII); view via `node src/cli.js ask:log` or the menu.

## 15f. Batch A-E (done)
- A: audit log moved to MySQL (`race_results_transform_ask_log`); removed the jsonl text file; CLI asks logged too.
- B: ask results collapse + clear controls. C: default model remembered (localStorage).
- D: out-of-scope questions declined via an OUT_OF_SCOPE marker (not substituted).
- E: **true logout** — `/metrics` now uses a login form + session cookie (no HTTP Basic); `/metrics/logout` forces re-login. e2e updated to form login.

## 15g. Charts, vertical scroll, raw-SQL mode (#64-66)
- #64 Vertical scroll: ask result tables are capped (`max-height` + `overflow:auto`, sticky header) so long results scroll inside the panel.
- #65 Charts: `ANSWER_SYSTEM` instructs the model to append a `` ```chart {"type","x","y"} ``` `` hint for chartable results; `ask.js:extract_chart()` parses + validates it against the actual columns (drops bad hints, needs >=2 rows) and returns `chart` separately so the answer text stays clean. The dashboard draws it with the already-loaded Chart.js and offers a chart/table toggle. CLI stays text/table.
- #66 Raw-SQL mode: an opt-in `SQL` toggle (and `ask_sql()` / `POST {mode:'sql'}` / `ask:sql` CLI) runs user SQL directly through the same read-only guard (SELECT-only, table allowlist, enforced LIMIT) -- no LLM. Logged with surface `dashboard-sql`/`cli-sql`.

## 16. Future recommendations & hardening (AFTER Step 2; not in scope now)
v1 (Step 2) uses the **current local credentials** with read-only stressed to the model
(system prompt + context guardrails) and enforced by the SQL guard. The items below harden
it for broader/production use and are explicitly **future work**, not part of Step 2.

**A. Dedicated read-only DB user (do this before production / before widening scope).**
The strongest guarantee is a DB user that physically cannot write. Create one and point the
ask brain at it (falling back to current creds only if unset):
```sql
-- run as an admin on the local MySQL
CREATE USER 'rrt_ask_ro'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT SELECT ON `<database>`.`race_results_transform_events` TO 'rrt_ask_ro'@'localhost';
-- (grant SELECT on additional tables only as the catalog deliberately expands)
FLUSH PRIVILEGES;
```
Then add to `.env` and have `db.js` prefer these, else fall back:
```
ASK_DB_HOST=localhost
ASK_DB_USER=rrt_ask_ro
ASK_DB_PASSWORD=<strong-password>
ASK_DB_NAME=<database>
```

**B. Query execution limits.** Per-query statement timeout (mysql2 `timeout` / MySQL
`max_execution_time`) + a hard row cap, so a heavy/expensive query can't hang or scan huge data.

**C. Dashboard endpoint protection.** Rate-limit `POST /api/metrics-ask`, keep it behind the
`mx_session` auth (#7), and cap request body size.

**D. Audit log.** Record question + chosen SQL + provider/model + row count (no PII) for
review and debugging — helps tune the context yaml from real failures.

**E. Cost controls.** Cap `max_steps`; set provider token limits; consider a cheap model
(haiku / gpt-mini) for routing/inspection steps and a richer model for final synthesis.

**F. Caching.** Cache schema/catalog with a TTL (the reference bot uses `AGENT_CATALOG_CACHE_MS`).

**G. Expanding scope.** When adding tables to the allowlist, regenerate context grounding for
them; keep the allowlist explicit (never "all tables").

**H. MCP surface (#5).** Once #8/#9 are stable, expose the same core tools as an MCP server so
Claude/Cowork can drive the loop — no rework of `db.js` / `tools.js` / `sql_guard.js`.

**I. Provider fallback.** If one provider errors or times out, optionally retry with the other.

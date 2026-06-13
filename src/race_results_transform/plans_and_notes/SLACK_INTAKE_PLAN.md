# Plan — Slack channel intake (pull spreadsheet attachments by date range)

Living plan + progress tracker. **No code until approved.** Goal: pull **Excel/CSV attachments out of a
specific Slack channel** for a **From/To date range** and run them through the SAME Files queue
(convert / review / download) as the Salesforce + Folder intakes. This fills in the **Slack Ironman** tab
(currently an under-construction placeholder).

Status legend: ⬜ not started · 🟡 in progress · ✅ done.

---

## Overview / how it slots in

Nothing about the existing flow changes — Slack is a **fourth intake** that feeds the SAME engine, exactly
like the SF Email Queue was a second Salesforce source. The **Slack Ironman** tab becomes functional:

```
Get Race Results card
  ├─ SF Upload Queue   (Salesforce: Race Results Doc files)        [done]
  ├─ SF Email Queue    (Salesforce: Email-to-Case attachments)     [done]
  ├─ From Folder       (local folder pick)                          [done]
  └─ Slack Ironman     (Slack channel attachments)   ← THIS PLAN
```

The Slack tab reuses the shared `#sfTable` (a Slack column set), the From/To date picker, the Max cap,
the Files queue, and the download bar — same as the other tabs. PII/token safety: **the Slack token never
leaves the server**; files are streamed **in-memory** to the browser (never written to server disk), the
same model as `sf/sf_fetch.js`.

**Test now, swap later:** point the token + channel at one of your existing Slack connections / a test
channel via env vars now; flip the env to the real channel later — **no code change**.

---

## Progress tracker

- ⬜ Phase 0 — Discovery (token/scopes/channel; verify which API surfaces the attachments + date filter)
- ⬜ Phase 1 — `slack/` engine + unit tests (mock client, no network)
- ⬜ Phase 2 — Server routes (`/api/slack/*`, mx_session) + CLI + menu ("Slack" section + how-to runbook)
- ⬜ Phase 3 — Browser: make the Slack Ironman tab functional (channel picker + copy chip) + `source='slack'`
- ⬜ Phase 4 — Tests (ui + e2e) + docs
- ✅ Phase 5 — Intake-by-tab analytics: SF source split into `sf_upload_queue`/`sf_email_queue` (via
  `sf_queue_source`), `metrics:backfill-source` (idempotent legacy `salesforce` → `sf_upload_queue`),
  `by_source` report aggregation + dashboard **"Intake by tab"** chart (`chart_source`) + Ask-data chip.
  (Fixed the source-rename fallout: `sf_can_reload` + the sanction chip now use `!== 'folder'` /
  `is_sf_download_source`.)

---

## Decisions — RESOLVED (2026-06-13)

| # | Decision | Resolution |
|---|---|---|
| 1 | **Token type** | ✅ **Bot token (`xoxb-…`)** — belongs to the app's bot user, scoped, server-side only, survives staff changes; the bot must be **invited to the channel**. (A user token `xoxp-` acts as the installing person and breaks if their account is disabled — only used if a bot can't be added; not needed here.) |
| 2 | **Channel visibility** | ✅ **Support BOTH public and private** with one code path. App carries both read scopes; engine **auto-detects** via `conversations.info` (`is_private`) and a `SLACK_CHANNEL_VISIBILITY=auto\|public\|private` override flag. `files.list` + `files:read` returns the channel's files either way once the bot is a member. |
| 3 | **Download model** | ✅ **Same process as the other tabs.** Once files are pulled from Slack they flow into the SAME Files queue → convert → review → download. Bytes come via the server (token-gated), so it reuses the SF download bar (`.sf-dl-server`) — no Slack-specific download UI. |
| 4 | **Tab label** | Keep **Slack Ironman** (channel is env-driven; the engine is a generic channel pull). |
| 5 | **Columns** | Start with `Date (MT) · Uploader · File name · Type`; add a message permalink later if useful. |
| 6 | **Channel selection** | ✅ **Fully self-service — no admin/env config.** The Slack tab shows a **Channel dropdown auto-populated from the channels the bot is a member of** (Slack `users.conversations`, public + private) + a **↻ Refresh** button, and also accepts a typed/pasted `#name`/`C…` id resolved against that same list. The workflow is: anyone runs **`/invite @membership-sales-bot`** in their channel → it appears in the list automatically (next load / Refresh) — no `.env` edit, no asking the developer. `SLACK_CHANNEL_ID` is only an optional default pre-selection (+ CLI fallback). **Limit (Slack-enforced, not ours):** the bot can only read channels it's been invited to, so a typed channel the bot isn't in shows a friendly "invite `@membership-sales-bot` to that channel first" instead of erroring. |

### Test target (confirmed 2026-06-13)
- **Workspace:** USA Triathlon. **Host app:** "Membership Sales" (App ID `A08311A9MED`) — we add bot read
  scopes to this existing app (its current repo use is a send-only **incoming webhook**, which can't read
  files, so this is additive).
- **Bot user:** display name **`membership-sales-bot`**, username **`membershipsalesbot`** — already
  **added to `#test_bot`** ✅.
- **Test channel:** **`#test_bot`** — a **private** channel, so the **`groups:*`** scopes are the relevant
  ones. Drop a couple of sample `.xlsx`/`.csv` files in it.

### Still needed from you (for Phase 0)
- ✅ Bot Token Scopes added (`files:read`, `channels:read`+`channels:history`, `groups:read`+`groups:history`,
  `users:read`) and app installed — confirmed from the OAuth & Permissions screen.
- Put the **Bot User OAuth Token** (`xoxb-…`) in `.env` as `SLACK_BOT_TOKEN` (don't share the value — it stays
  local). Then say go for Phase 0.

> Note: the existing **incoming webhook** Slack integration (metrics digest, `slack_message_api` →
> `SLACK_WEBHOOK_…_URL`) is **send-only** and cannot list/download files, so it can't be reused here — this
> feature needs the bot token above.

---

## Access model & external Slack setup (one-time, outside this repo)

**Whose access governs it?** With a **bot token**, access is the **bot user's**, not the developer's. The
server reads whatever channel the **bot is a member of** (the `SLACK_CHANNEL_ID`). Steve (or any dev running
this) does **not** need personal access to that channel — only the bot does. Any channel member/admin runs
`/invite @your-app` once. (A user token would instead be scoped to the installing person's access — not used.)

**One-time Slack-side setup (api.slack.com → your app):**
1. **OAuth & Permissions → Bot Token Scopes**: add `files:read`, `channels:read`, `channels:history`,
   `groups:read`, `groups:history`, `users:read`.
2. **(Re)install the app** to the workspace (adding scopes requires a reinstall) → copy the **Bot User OAuth
   Token** (`xoxb-…`) → `.env` `SLACK_BOT_TOKEN`.
3. **Invite the bot** to the target channel: `/invite @your-app`.

**Not needed:** Event Subscriptions, slash commands, interactivity, a public URL / ngrok, or a Marketplace
listing — **Slack never calls us; we call Slack's Web API on demand** with the static bot token. The only
in-repo config is the env vars (token + channel id). Swap channels later by changing `SLACK_CHANNEL_ID` (and
inviting the bot to the new channel) — no code change.

---

## Verified API approach (to re-confirm in Phase 0 against the real channel)

Two candidate methods — same pattern as "SOSL vs SOQL" on the SF side, where we verified which one actually
surfaces the records:

- **Primary candidate — `files.list`** (`channel`, `ts_from`, `ts_to`, `types`, paginated): returns file
  objects **directly** for a channel + date range — the most direct map to this feature. Scope: `files:read`.
- **Fallback — `conversations.history`** (`channel`, `oldest`/`latest` ts, `inclusive`, cursor paging):
  walk messages and collect `message.files[]`. Catches files we might miss, but ⚠️ **as of May 29 2025,
  newly-created apps are rate-limited to ~1 request/minute with a max page of 15** — so for a brand-new app
  this is slow to paginate. Another reason to prefer `files.list`. (Thread-only attachments may need
  `conversations.replies` — verify in Phase 0.)

**Download:** each file object exposes `url_private_download`; fetch it with header
`Authorization: Bearer <token>` (needs `files:read`). The token-bearing request returns the raw bytes; we
stream them **in-memory** to the browser. (Both `url_private` and `url_private_download` require the auth
header; the older public `url`/`url_download` are deprecated.)

**Date math:** Slack timestamps are Unix seconds (float). Reuse the SF Mountain-Time From/To → epoch
conversion (`slack_dates.js`, mirroring `sf/sf_dates.js`).

**Filter:** keep only `.xlsx / .xls / .csv` (by `filetype` / `mimetype` / name extension), dedupe by file id,
newest-first.

---

## Architecture (mirrors `sf/`)

### Engine — new `slack/` dir (Node-only, no DOM, injectable client for unit tests)
- `slack_config.js` — env: `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` (**optional default** channel — the UI
  picker overrides it per-pull; required only for the headless CLI when `--channel` isn't passed),
  `SLACK_CHANNEL_VISIBILITY=auto|public|private` (default `auto`), `SLACK_API_BASE`
  (default `https://slack.com/api`), file-type allowlist, `is_test`. (Optionally `SLACK_PROD_*`/`SLACK_DEV_*`
  like `sf_config`.)
- `slack_client.js` — thin Web API wrapper with an **injectable** transport (so tests use a mock, no network):
  `list_channel_files(conn, { channel, start_ts, end_ts, limit })` → normalized records
  `{ file_id, name, filetype, size, uploader_id, uploader_name, created_utc, created_mtn, url_private_download,
  channel_id, is_private }`, deduped, newest-first. Handles **public + private** the same way (one `files.list`
  path); `conversations.info` resolves `is_private`/channel name when `SLACK_CHANNEL_VISIBILITY=auto`.
  Best-effort resolves uploader display names via `users.info`/`users.list`. Also exposes
  **`list_member_channels(conn)`** → Slack `users.conversations` (public + private, paginated) returning
  `[{ id, name, is_private }]` — the channels the bot is a member of, for the UI's channel picker.
- `slack_dates.js` — Mountain-Time today/specific/range → Unix ts (reuse the `sf_dates` patterns + the same
  `SF_MIN_DATE`/14-day-style guards if we want them).
- `slack_fetch.js` — one file → in-memory Buffer via `url_private_download` + Bearer token (never disk).
- `slack_naming.js` — snake_case download name `<channel>_<uploader>_<name>_<fileid>.ext` (mirrors `sf_naming`).
- `slack_routes.js` — `mount_slack_routes(app, require_auth)`: `GET /api/slack/channels` (the bot's channels
  for the picker), `GET /api/slack/files` (validates the requested `channel` is one the bot is a member of —
  so a user can't probe arbitrary channels), `GET /api/slack/file/:id`.
- `index.js` — exports.

### Server (`server_…8018.js`)
- `mount_slack_routes(app, require_dash_auth)` — gated by the SAME `mx_session` auth as `/metrics` + `/api/sf/*`.
  Lazy-required; returns **503 when `SLACK_*` env is missing** (server still boots). `/api/slack/file/:id`
  streams bytes in-memory (no persistence).

### Browser (`app.js`, the Slack Ironman tab)
- `S.sf_source === 'slack'` joins the existing 4-way `sf_set_source`. Show a **Channel** dropdown
  (`#sfSlackChannel`, populated from `GET /api/slack/channels` when the tab opens / after sign-in;
  pre-selected from `SLACK_CHANNEL_ID` if set), the **From/To + List** controls (add `slack` to
  `.sf-query-only`, or a `.sf-slack-query` family), the **Max** cap (`.sf-cap-only` already covers it), and
  the **SF download bar** (`.sf-dl-server`). Hide the SF-only Broaden/Status + the folder picker. The chosen
  channel id flows into `sf_query_params` → `/api/slack/files?channel=…`; remember the last pick in prefs.
- **Self-service instructions (in the tab, always visible):** a short helper line next to the picker —
  *"Don't see your channel? In Slack, type `/invite @membership-sales-bot` in that channel, then click ↻ Refresh."*
  The invite command is shown in a small **code chip with a 📋 copy icon** (click → copies
  `/invite @membership-sales-bot` to the clipboard, with a brief "Copied!" confirmation) so the user can paste
  it straight into Slack — no retyping. When the bot is in **no** channels yet, the dropdown shows an
  **empty state** with the same instruction + copy chip (and the bot's exact `@handle` is rendered from the
  server so both the text and the copied command always match the real bot). A short `?`/tooltip repeats it.
  This is the only "how do I add a channel" guidance a user needs — no docs, no developer involvement.
- `sf_columns()` gains a **slack set**: `Date (MT) · Uploader · File name · Type`. Records carry
  `content_version_id = file_id` so the shared sort/search/select/Max all work unchanged.
- `sf_query_params` → `{ start, end }` ts; `sf_list` endpoint `/api/slack/files`; download via
  `/api/slack/file/:id` (like `/api/sf/file/:id`). Selected files flow into the SAME Files queue with
  `source: 'slack'`.

### Metrics — intake-by-tab breakdown (so we can see which tab users use)
**Goal:** understand which intake the activity comes from — **manual upload vs SF Upload Queue vs SF Email
Queue vs From Folder vs Slack** — in the DB, the `/metrics` report, and the dashboard.

- **Refine the existing `source` column** (no new column / no schema change — reuse the column already wired
  through DDL + `metrics_config.COLUMNS` + the `public/js/metrics.js` allow-list + the `ensure_columns`
  migration; it's a free-text column so it just takes new values). Values going forward:
  - `upload` — manual drag-drop (unchanged)
  - `try_me` — built-in sample (unchanged)
  - **`sf_upload_queue`** — SF Upload Queue tab  *(was lumped as `salesforce`)*
  - **`sf_email_queue`** — SF Email Queue tab  *(was lumped as `salesforce`)*
  - `folder` — From Folder tab (unchanged)
  - `slack` — Slack Ironman tab (new, this plan)
- **Where it's set:** `app.js` `track()` / `open_queue_file` derive `S.source` from `S.sf_source`
  (`upload→sf_upload_queue`, `email→sf_email_queue`), `folder`, `slack`; manual dropzone stays `upload`.
- **Backfill historical rows (one-time, idempotent):** the SF Email Queue only just shipped, so **every prior
  `source='salesforce'` row was the upload queue** → `UPDATE <events table> SET source='sf_upload_queue' WHERE
  source='salesforce'`. After it, the column holds only the 6 clean values — no "pre-split" bucket needed.
  - **How you run it: a guided menu.js item** (recommended) backed by the `metrics:backfill-source` CLI. The
    flow is **dry-run → confirm → execute → report**: it first prints `COUNT(*) WHERE source='salesforce'` (how
    many rows will change), asks to confirm (like `purge-all`), runs the UPDATE, then reports rows changed.
    **Idempotent** — re-running changes 0 rows.
  - **Scope/safety:** touches only `source='salesforce'`; `is_test`/`is_demo` and all other values are
    untouched. The `/metrics` SQL box can't do it (hardened read-only, writes blocked) — by design.
  - **Timing:** run it when the new `sf_upload_queue`/`sf_email_queue` source values deploy. Effectively
    one-directional (once new upload-queue rows also write `sf_upload_queue`, legacy and new are
    indistinguishable — which is correct, they're the same thing).
- **Report (`metrics_report.build_report`):** add a **`by_source`** aggregation — uploads / conversions /
  downloads grouped by `source` (friendly labels: Manual upload · SF Upload Queue · SF Email Queue · Folder ·
  Slack · Try Me).
- **Dashboard:** a new **"Intake by tab"** chart (`chart_source`, a bar/stacked panel like the others, with the
  same Expand/PNG/CSV/Table toolbar) **plus an Ask-data suggestion chip** (e.g. *"Which intake tab is used most
  this week?"* / *"Uploads by tab, in a table"*) seeding the existing ask path — no engine change, it's just a
  `GROUP BY source`.
- **Tests/docs:** `metrics_report.test.js` asserts the `by_source` shape; `sf_ui.test.js`/track wiring asserts
  the new `source` values per tab; a dashboard chip/chart-present check; CLAUDE + README + ANALYTICS_PLAN notes.

### CLI + menu
- **CLI commands** (mirror `sf:*`):
  - `slack:probe` — read-only Phase-0 check: token valid, bot identity (`auth.test`), which channels it's in,
    which list method returns the attachments, and that `url_private_download` returns real bytes.
  - `slack:channels` — list the bot's channels + ids.
  - `slack:list [--channel <id|name>] [--start/--end|--today] [--limit] [--test]` — list spreadsheet
    attachments for a date range (`--channel` overrides the env default).
  - `slack:pull <opts> -o <dir>` — download them to a folder.
  - `metrics:backfill-source` — the one-time idempotent `salesforce → sf_upload_queue` UPDATE (counts/reports
    rows changed; safe to re-run).
- **menu.js — a new "Slack" section** (sequential ids, guarded by `tests/menu_ids.test.js`) with items for:
  **probe connection** · **list bot channels** · **list files (date range)** (prompts channel + dates +
  prod/test) · **pull files to a folder** · **run Slack tests** (`node --test tests/slack_*.test.js`) · and a
  **"Slack setup / how-to (future self)"** item that prints the concise runbook (below). Plus, under the
  existing metrics section, a **"Backfill source (salesforce → sf_upload_queue)"** item.
- **Future-self runbook** (printed by the menu how-to item + kept in this doc): the one-time Slack-app setup
  (scopes + reinstall + `xoxb` token → `.env`), the **self-service channel flow** (`/invite
  @membership-sales-bot` → ↻ Refresh → it appears), how to point at a different/real channel (just invite the
  bot there — no config), and the test/probe commands. So six months from now anyone can re-run or extend this
  without rediscovering it.

### Env (`.env`)
- `SLACK_BOT_TOKEN=xoxb-…`
- `SLACK_CHANNEL_ID=C…`  ← **optional** default pre-selection; the UI channel dropdown overrides it per-pull
- (optional) `SLACK_API_BASE`, `SLACK_DEV_*`/`SLACK_PROD_*`, `SLACK_FILE_TYPES=xlsx,xls,csv`
- No new scope needed for the picker — `users.conversations` uses the same `channels:read`/`groups:read`
  already required.

---

## Build phases

### Phase 0 — Discovery (no app code; a throwaway script or `slack:probe`)
- Confirm token type + scopes; **invite the bot to the test channel**.
- Verify **which method** (`files.list` vs `conversations.history`) reliably returns the spreadsheet
  attachments for a date range on the real channel (incl. thread replies); note rate limits.
- Confirm `url_private_download` + `Authorization: Bearer` returns real bytes (not an HTML login page — a
  known gotcha when the token/scope is wrong or the bot isn't in the channel).
- Decide `files.list` vs `conversations.history` as primary based on what we see (document it like
  `SEARCH_NOTES.md`).

### Phase 1 — Engine `slack/` + unit tests (mock client, no network)
`slack_config` · `slack_dates` · `slack_client` · `slack_fetch` · `slack_naming` · `slack_routes` · `index`,
with `tests/slack_client.test.js` + `tests/slack_dates.test.js` (mock transport).

### Phase 2 — Server routes + CLI + menu
`mount_slack_routes` behind `require_dash_auth`; `slack:list`/`slack:pull`/`slack:probe`; menu "Slack" section.

### Phase 3 — Browser: Slack Ironman tab functional + metrics
`sf_set_source` slack branch, slack `sf_columns`, query params + endpoints, Files queue `source='slack'`,
`source` enum gains `'slack'`.

### Phase 4 — Tests + docs
`tests/slack_ui.test.js` (markup + app.js wiring + source flag), opt-in `e2e/slack_flow.spec.js` (stub
`/api/slack/*`, like `sf_flow`), and docs (README "Pull from Slack", CLAUDE intake-tab + new `slack/`
section, `.env`, e2e README, this plan's tracker).

### Phase 5 — Intake-by-tab analytics
Set the precise `source` per tab in `app.js` (`sf_upload_queue`/`sf_email_queue`/`folder`/`slack`); add
`metrics:backfill-source` (one-time `salesforce → sf_upload_queue`) + its menu item; add the `by_source`
aggregation to `metrics_report.build_report`; add the **"Intake by tab"** dashboard chart + the Ask-data
suggestion chip; tests (`metrics_report.test.js` `by_source` shape, source-value wiring) + docs
(CLAUDE/README/ANALYTICS_PLAN). Can run independently of the Slack tab, but shares the `source='slack'` value.

---

## Risks / open questions
- **`conversations.history` rate limit (May 2025)** — ~1 req/min, 15/page for new apps. Prefer `files.list`;
  if we must walk history, paginate slowly + cache. Confirm your app's rate tier in Phase 0.
- **Thread-only attachments** may not appear in `conversations.history` (need `conversations.replies`);
  `files.list` may or may not include them — verify.
- **Bot membership** — `url_private_download` returns an HTML login page (not bytes) if the token/scope is
  wrong or the bot isn't in the channel. Phase 0 guards against shipping that confusion (friendly error like
  the SF `.xls`/unreadable message).
- **Private channel** needs `groups:history`/`groups:read` + bot invited.
- **Token security** — server-side only, never sent to the browser; bytes streamed in-memory (no disk),
  mirroring `sf_fetch`. Keep the public `/api/event` ingest untouched; Slack routes are auth-gated.
- **`files.list` pagination** is older (page/count based) vs cursor — handle whichever the chosen method uses.

---

## Reuse map (what we copy vs build)
- **Copy the shape of** `sf/` (config/dates/client/fetch/naming/routes/index) and its tests → `slack/`.
- **Reuse unchanged**: the `#sfTable` render/sort/search/select, the Max cap, the Files queue (`build_queue`),
  the SF download bar, the mx_session auth, the in-memory streaming pattern.
- **Build new**: the Slack Web API calls + the slack column set + the `source='slack'` value + the Slack tab
  wiring + the env/CLI/menu entries.

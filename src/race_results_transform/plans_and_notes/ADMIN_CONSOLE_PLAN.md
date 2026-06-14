# Plan — /admin ops console (run menu.js operations from the browser)

Goal: do as much as possible from `/admin` instead of SSH-ing to the box — run tests, probes, metrics ops,
SF/Slack list/probe, AI ask, etc., and watch their output live. Mirror `menu.js` exactly so the two never
drift, and surface a Logs/pm2 panel so the server's console feedback is visible in the browser.

## Layout (blend) — wireframe
Left nav rail (from layout B) + dense, scannable pages (from layout A). A rich, clickable mockup of this is
saved next to this doc at `admin_console_mockup.html` (open it in a browser).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ⚙️  Race Results Spreadsheet Converter — Admin        [☾ Dark] [↩ Sign out]│
├────────────┬───────────────────────────────────────────────────────────────┤
│ Admin      │  LOGS & PROCESS                                    ● live      │
│            │  ┌pm2─────┬uptime─┬restart┬cpu──┬mem───┐                       │
│ ▸ Overview │  │ online │ 6d 4h │  2    │0.4% │118MB │   (greys out if not   │
│ ▸ Mainten. │  └────────┴───────┴───────┴─────┴──────┘    running under pm2) │
│ ▸ Settings │  ┌console tail────────────────────────────────────────────┐   │
│ ▸ Access   │  │10:42 [env] .env loaded   POST /api/event 200 …          │   │
│ ▸ OPERATNS │  │10:43 [sf] list 14 files  GET /metrics 200 dashboard_view│   │
│ ▸ LOGS  ◄  │  └─────────────────────────────────────────────────────────┘   │
│ ▸ Referenc │  ┌Operations — curated menu.js commands────────────────────┐   │
│            │  │ [sf:probe] [slack:probe] [metrics:size] [stats] [tests] │   │
│            │  │ [⚠ purge (confirm)]    (terminal-only items greyed out) │   │
│            │  │ $ node src/cli.js sf:probe                              │   │
│            │  │ login ok · 14 files visible        done in 1.4s ✓       │   │
│            │  └─────────────────────────────────────────────────────────┘   │
└────────────┴───────────────────────────────────────────────────────────────┘
```
Operations mirrors the menu sections from the registry (same labels/descriptions, show/hide `$ …` toggle):
`run` items have a Run button; `form` items expand inline inputs; `terminal`/`menu` items are greyed with a
note; `destruct` items require a typed confirm. Output streams into the dark console box (SSE) with a Kill
button + a small run history.

## Single source of truth — `admin/console_registry.js`
One snake_case catalog both `menu.js` (terminal) and `/admin` (web) read, so a command added once shows up in
both. Each item:
```
{ id, section, label, desc, cli,            // catalog/display (cli is the shown "$ …" line)
  web: 'run' | 'form' | 'terminal' | 'menu',// how /admin treats it
  klass: 'read' | 'mutate' | 'destruct' | 'test' | 'na',
  bin: 'node' | 'npm',                       // executable (no shell ever)
  argv: [...],                               // base args; params append to this
  params: [ { name, label, type, options?, default?, required?, flag?, position? } ],
  note }                                     // why a terminal/menu item is greyed on web
```
- `web:'run'` — no input, spawn + stream (stats, metrics:size, sf:list --today, tests, …).
- `web:'form'` — render the registry `params` as inline inputs, then spawn (sf:list recent, ask, ask:sql,
  slack:list, pulls).
- `web:'terminal'` — shown but **greyed** on web with `note` (server start, open browser, e2e:headed/step,
  convert/inspect/batch — local file paths; the converter UI already does those).
- `web:'menu'` — menu-only controls (show/hide CLI, quit) — not shown on web.
- `menu.js` builds its banner/list from the registry (keeps its rich interactive `handle()` prompts); the
  `menu_ids` test still guards sequential ids 1..N.

## Server (all `require_admin_auth`)
- `GET  /api/admin-console/commands` — the registry minus anything secret (it has none); drives the UI.
- `POST /api/admin-console/run` — `{ id, params, confirm? }`. Look up the id in the registry (reject unknown);
  validate each param against its declared `type`/`options` (enum must match; int is numeric; date is
  `YYYY-MM-DD`; path is repo/data-dir-relative with no `..`); **assemble argv server-side** from
  `argv` + params (the client never sends a command string) and `spawn(bin, argv, { shell:false })`. Returns a
  `run_id`. `destruct` commands require a `confirm` token equal to the command id (typed-confirm).
- `GET  /api/admin-console/stream/:run_id` — SSE; pushes `{stdout|stderr line}` events as they arrive, then
  `{exit, code}`. Output is capped (ring) to avoid runaway memory.
- `POST /api/admin-console/kill/:run_id` — SIGTERM the child.
- In-memory run table `{ run_id -> { child, buffer, subscribers, started, status } }`; per-run timeout;
  small concurrency cap; an audit line per run (command id + sanitized params + exit) — no secrets.

## Logs + pm2
- Ring buffer: wrap `console.log/err` at startup to also push into a ~500-line in-memory ring; gated
  `GET /api/admin-logs` returns it, with an SSE tail for live view. Works in dev and prod.
- pm2: gated `GET /api/admin-pm2` runs `pm2 jlist` (argv spawn, no shell), finds this process by name
  (`usat_race_results_transform`), returns status/uptime/restarts/cpu/mem. Degrades to
  `{ under_pm2:false }` when not running under pm2 (e.g. `node server…` in dev) so the panel says so.

## UI — blend layout (`metrics/admin.html`)
Left rail (Overview · Maintenance · Settings · Access · Operations · Logs · Reference) + dense Overview.

REQUIREMENTS (locked):
- **Overview = the dense "Option A" single page** — the status KPI tile strip up top, Maintenance actions and
  a Settings preview side-by-side, plus the System reference teaser, all on the landing page (not just a couple
  of tiles). The rail's other items are focused deep-dives of the same sections.
- **Every side panel is as rich as possible** — real controls, not static text: Settings = Slack channel
  dropdown + file-type checkboxes + SF object (Advanced); Access = users table + role badges + add/remove form;
  Operations = inline param dropdowns/inputs per command (env, status, count, channel, strategy, …); Maintenance
  = live counts + typed-confirm. Reuse the existing `/css/app.css` controls so it matches `/` and `/metrics`.
- **Operations** mirrors the menu sections from the registry, with the same labels/descriptions and a
  show/hide CLI toggle (like the menu). `run` items have a Run button; `form` items expand inline inputs;
  `terminal`/greyed items show the `note`; `destruct` items prompt for the typed confirm. Output streams into a
  dark console box (SSE) with a Kill button + a small run history.
- **Logs** — pm2 stat tiles (when present) + the live console tail.
- **Reference** — Program object (Sanction ID source), live APIs, DB/tables, key env vars, the auth model.
- Settings keeps the channel dropdown + file-type checkboxes; the SF program object moves under Advanced next
  to its reference blurb.

## Safety
Admin-gated · allowlist by id · argv assembled server-side, `shell:false` (no injection) · param type/options
validation · path params blocked from escaping the repo/data dir · `ask:sql` still goes through the read-only
guard · destructive `purge-all` behind typed-confirm · per-run timeout + output cap + audit log.

## What can't run from the browser (shown greyed, `web:'terminal'`)
Start the server (you're already in it) · Open in browser · `e2e:headed`/`e2e:step` (need a visible desktop) ·
`convert`/`inspect`/`batch` (local file paths — use the converter UI).

## Phases
1. `console_registry.js` + refactor `menu.js` to consume it (+ menu_ids/lint green). ← start here
2. Server run/stream/kill endpoints + audit + validation.
3. Logs ring buffer + pm2 endpoint.
4. `/admin` blend UI (nav + Operations + Logs + Reference).
5. Tests + docs (registry/guard/auth) + CLAUDE/README + this doc.

## Progress — ✅ all phases built
- ✅ **1** `admin/console_registry.js` (54 commands, single source of truth); `menu.js` builds its menu from it
  (`menu_ids` passes). One inert `DEAD_INLINE_SECTIONS` stub remains in menu.js for a trivial clean-checkout
  delete (Unicode in the old literal resists exact-match deletion over the OneDrive mount).
- ✅ **2** `admin/console_runner.js` (allowlist + param validation + argv assembly, shell:false; run/SSE/kill
  registry, output cap, 15-min timeout, audit) + gated routes `/api/admin-console/commands|run|stream|kill`.
- ✅ **3** `admin/log_ring.js` (console ring + `pm2 jlist`) + gated `/api/admin-logs`, `/api/admin-logs/stream`,
  `/api/admin-pm2`.
- ✅ **4** `metrics/admin.html` rewritten to the blend layout: left rail, dense Overview, Operations (live SSE
  output + Kill + per-command param forms + greyed terminal-only + typed-confirm destructive), Logs (pm2 tiles +
  live tail), Settings, Access, Reference.
- ✅ **5** `tests/admin_console.test.js` (12 tests: registry shape + argv-assembly/guards — all pass) +
  ops-console assertions added to `tests/admin_auth.test.js`; CLAUDE.md updated.
- NOTE: the OneDrive mount serves truncated copies of freshly-edited files to the bash sandbox, so the full
  `node --test tests/*.test.js` + lint must be run on the dev machine to confirm green end-to-end.

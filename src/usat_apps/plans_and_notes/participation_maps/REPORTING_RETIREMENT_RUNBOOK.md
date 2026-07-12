# Runbook — Retire `/reporting` (server 8021)

_The participation-maps app has been folded into usat_apps as the **`participation_maps` module**. This runbook retires the standalone `/reporting` app. The **repo cleanup is done** (staged with the retirement commit); the remaining steps run on the production server. Reversible until the code is deleted + committed. Last updated: 2026-07-12._

## Precondition — the go/no-go
Verify parity on your box **before** stopping 8021:
- Build + boot usat_apps; open the participation-maps page.
- Confirm the map, KPIs, tabs, and Reference match `/reporting`, incl. the headline **CA 33,236 / US 292,675**.
- Run with `REPORTING_STRICT_DB=1` so column drift surfaces instead of a silent fixture fallback.

If the numbers match, proceed. If not, **do not retire**.

## Already done (in the repo, staged with step 2)
- **Proxy:** `/reporting` was already commented out in `utilities/proxy/proxy_routes.js` — not publicly routed.
- **`package.json`:** removed all 20 `reporting_*` / `*_reporting` scripts. Also fixed two bugs: `delete_usat_apps` / `show_usat_apps` were targeting `usat_reporting` -> now `usat_apps`.
- **VS Code task json:** removed the `20 REPORTING (logs)` + `(shell)` tasks, the `Reporting (split)` compound, and its entries in the master "start-all" tasks — in **both `.vscode/tasks.json` and `.vscode/tasks_backup.json`** (both re-validated as JSON, 0 reporting refs remaining).

## Ops panel — no change needed (self-clears)
- **Server cards** read live `pm2 jlist` -> `usat_reporting` disappears the moment the process is deleted.
- **Backends** read `proxy_routes.js` -> `/reporting` already commented, so already absent.
- No hardcoded reporting/8021 list exists in the ops module.

## SQL DB — drop the events table
Decision: **delete** the reporting-owned usage table (not archive). New usage writes `usat_apps_events`.
```
DROP TABLE IF EXISTS reporting_events;
```
Participation data tables (`region_data`, `zip_lat_lng_reference`, `census_state_population`, participation summary/flows/events) are **shared** — built by `src/participation_data`, read by usat_apps — they **stay**.

## Steps you run

**1. Stop the process (production host `usat-server`):**
```
npx pm2 stop usat_reporting
npx pm2 delete usat_reporting
npx pm2 save
```
`/reporting` isn't proxied, so nothing routes to it — low risk. (The old `stop_reporting`/`delete_reporting` npm scripts are gone; use pm2 directly.)

**2. Delete the code + record it** — run in your terminal (the desktop bridge can't delete). Do these one at a time; each block below is a single command.

_Windows PowerShell (your dev box) — run from the repo root:_

2a — delete the reporting app folder:
```
Remove-Item -Recurse -Force .\src\reporting
```
2b — delete the reporting server file:
```
Remove-Item -Force .\server_reporting_8021.js
```
2c — delete the e2e build artifact:
```
Remove-Item -Recurse -Force .\.reporting_e2e_dist
```
2d — stage everything (the deletions + this session's package.json / .vscode cleanup):
```
git add -A
```
2e — commit:
```
git commit -m "Retire /reporting (8021): folded into usat_apps participation_maps module"
```
_On the Linux prod host you don't delete by hand — `git pull` (step 5) removes the tracked files. To clear the leftover build artifact there:_ `rm -rf .reporting_e2e_dist`

- **Keep `src/participation_data/`** — that's the ETL the maps still consume; it does NOT move.
- `src/reporting` is ~209MB (its `node_modules`), so the delete takes a moment.
- Recoverable with `git checkout -- src/reporting server_reporting_8021.js` until you commit; after commit, via git history.
- **Verified 2026-07-12 (full-repo scan):** those three paths are the *complete* delete set — nothing else needs removing. No module imports or requires them; the salesforce_merge e2e config's `:8021` is its own throwaway test port (`MERGE_PORT=8021` launching `server_salesforce_merge_8020.js`), unrelated to reporting. The only leftover mentions are cosmetic `// Copied from src/reporting/…` header comments in the ported usat_apps files — harmless, safe to leave.

**3. Drop the events table (MySQL, once after cutover):**
```
DROP TABLE IF EXISTS reporting_events;
```

**4. `.env` cleanup (production):** remove `REPORTING_ADMIN_USER`, `REPORTING_ADMIN_PASS`, `REPORTING_SESSION_SECRET`, `REPORTING_PORT`, `REPORTING_NGROK`. **Keep `LOCAL_MYSQL_*`** (shared).

**5. Deploy:** `git pull` on production. usat_apps already serves the app; nothing to restart for reporting.

## Rollback (reversible until step 2 is pushed / step 3 is run)
- **Process:** `npx pm2 start /home/usat-server/development/usat/sql_programs/server_reporting_8021.js --name usat_reporting --no-autorestart --max-memory-restart 4G --node-args="--expose-gc"` (the old `pm2_start_reporting`, recorded here since it's removed from package.json).
- **Proxy:** the `/reporting` line still exists (commented) in `proxy_routes.js` — uncomment + `npm run pm2_reload_proxy` to route again.
- **Code:** `git revert` the step-2 commit (or `git checkout -- <paths>` before committing).
- **Table:** once step 3 runs, `reporting_events` history is gone (no backup) — export it first if you might want it.

## Notes / gotchas
- The mount VM's git may report `index uses ??? extension, which we do not understand` — that's a git **version mismatch** (Windows git wrote a newer index), **not corruption**; `git status` in your own terminal is fine.
- Guardrail: `/merge` (8020), `usat_apps` (8022), and every other service are untouched throughout.

# Runbook — Retire `/merge` (server 8020)

_The Salesforce Merge app is now the usat_apps **`salesforce_merge` module** (`/apps/salesforce/merge`), with production writes isolated in the **merge worker** (`server_salesforce_merge_worker_8021.js`, pm2 `salesforce_merge_worker`). This retires the standalone monolith `/merge` (port 8020, pm2 `usat_salesforce_merge`). Adapted from `participation_maps/REPORTING_RETIREMENT_RUNBOOK.md`. Reversible until the code delete is committed + pushed. Each command is its own copyable block — do them one at a time. Last updated: 2026-07-13._

---

## ⚠️ What STAYS — do NOT touch (the big difference vs the reporting retirement)

- **The worker:** `server_salesforce_merge_worker_8021.js` + `src/salesforce_merge_worker/` + pm2 `salesforce_merge_worker` and all `*_salesforce_merge_worker*` scripts. This is the new executor — the point of the port.
- **`src/salesforce_duplicates/`** — the detection/ETL the tool consumes (merge's equivalent of `participation_data`).
- **`salesforce_merge_events`** — the usat_apps SF Merge panel writes to it. **Do NOT drop it** (unlike `reporting_events`).
- **All `salesforce_merge_*` data tables** (`queue`, `run`, `history`, `premerge_snapshot`) — shared; the module owns them.
- **`.env`:** keep all `SF_*` creds, `MERGE_ENABLE_EXECUTION`, `LOCAL_MYSQL_*`.

---

## Precondition — go/no-go (this path does destructive SF writes)

Before stopping 8020, verify the **new write path** end-to-end:

- Render + data parity at `/apps/salesforce/merge` (dashboard, duplicates, merge-id, select, process, restore, tuning).
- A real **Execute** merge on a small **sandbox** set through the module → worker: run reaches `done`, counts match, history + snapshot written, losers in Recycle Bin with `MasterRecordId` set.
- A **restore** of that set completes (`done → restored`).
- Worker-down: a new run stays `queued` + banner shows; starting the worker drains it.

If all pass, proceed. If not, **do not retire** — 8020 is the rollback.

---

## Already done in the repo (this session — uncommitted, reversible via `git checkout`)

- **`package.json`:** removed the 17 standalone `salesforce_merge_*` / `pm2_*_salesforce_merge` scripts (worker scripts kept); `pm2_run_all_servers` renumbered to 20 (worker is now `20 of 20`).
- **Proxy:** `/merge` line commented out in `utilities/proxy/proxy_routes.js`.

These land with the delete commit (step 5) or revert with:
```
git checkout -- package.json utilities/proxy/proxy_routes.js
```

---

## Step 1 — VS Code tasks (dev-only, optional now)

`.vscode/tasks.json` still has a `19 SALESFORCE MERGE (logs)/(shell)` group + `Salesforce Merge (split)` compound pointing at the removed `pm2_logs_salesforce_merge` — harmless (only fails if run). Remove those two tasks + the split compound (keep the `20 SALESFORCE MERGE WORKER` group) and re-validate the JSON when convenient.

## Step 2 — Reload the proxy (drops the `/merge` route)
```
npm run pm2_reload_proxy
```

## Step 3 — Stop the monolith (host `usat-server`)

Stop it:
```
npx pm2 stop usat_salesforce_merge
```
Delete it:
```
npx pm2 delete usat_salesforce_merge
```
Save the pm2 list:
```
npx pm2 save
```

## Step 4 — Delete the code (your dev box; the bridge can't delete)

_Windows PowerShell, from the repo root._ Delete the app folder:
```
Remove-Item -Recurse -Force .\src\salesforce_merge
```
Delete the server file:
```
Remove-Item -Force .\server_salesforce_merge_8020.js
```
Do **NOT** delete `server_salesforce_merge_worker_8021.js`, `src/salesforce_merge_worker/`, or `src/salesforce_duplicates/`.

## Step 5 — Commit (bundles the package.json + proxy cleanup with the delete)

Stage everything:
```
git add -A
```
Commit:
```
git commit -m "Retire /merge (8020): folded into usat_apps salesforce_merge module; writes via the merge worker (8021)"
```

## Step 6 — `.env` cleanup (production)

**Optional tidy-up — not required** (these are harmless if left; nothing reads them once 8020 is gone). Remove the monolith's auth/server vars: `MERGE_ADMIN_USER`, `MERGE_ADMIN_PASS`, `MERGE_SESSION_SECRET`, `MERGE_PORT`, `MERGE_NGROK`. **Keep** `SF_*`, `MERGE_ENABLE_EXECUTION`, `LOCAL_MYSQL_*`.

> These are **not replaced by new vars.** Only the standalone 8020 read them. usat_apps auth uses `USATAPPS_ADMIN_USER/PASS` (already set) and an **auto-generated** `session_secret` persisted in the gitignored `auth.json` *outside* the repo (`<OS data path>/usat_apps/auth.json`) — it signs the single `usat_apps_session` cookie that now gates the merge module. Removing `MERGE_SESSION_SECRET` does **not** log anyone out of usat_apps. Do this only **after** step 3 (while 8020 still runs it needs the var).

## Step 7 — Deploy
```
git pull
```
usat_apps (8022) already serves the app and the worker (8021) keeps running — nothing to restart for the retired monolith.

---

## SQL — nothing to drop
`salesforce_merge_events` and the queue/run/history/snapshot tables are all in use by the module + worker. **No `DROP` in this retirement.**

## Rollback (until step 5 is pushed)

Restore the repo cleanup:
```
git checkout -- package.json utilities/proxy/proxy_routes.js
```
Re-route the proxy (after un-commenting `/merge`):
```
npm run pm2_reload_proxy
```
Restart the monolith (the old `pm2_start_salesforce_merge`, removed from package.json):
```
npx pm2 start /home/usat-server/development/usat/sql_programs/server_salesforce_merge_8020.js --name usat_salesforce_merge --no-autorestart --max-memory-restart 4G --node-args="--expose-gc"
```
Undo the delete commit:
```
git revert <step-5-commit-sha>
```

## Notes
- Before committing, confirm nothing under `src/usat_apps/**` or `src/salesforce_merge_worker/**` still `require`s `../salesforce_merge/...` (the module has its own `store/*`).
- Port 8020 is freed; 8021 (worker) + 8022 (usat_apps) keep running.
- Guardrail: usat_apps, the merge worker, `salesforce_duplicates`, and every other service are untouched.

## Ops panel
Data-driven, no hardcoded list. **Backends** reads `proxy_routes.js` → `/merge` (8020) drops out (already commented). **Server cards** read live `pm2 jlist` → `usat_salesforce_merge` disappears on `pm2 delete`, and `salesforce_merge_worker` (8021) already shows. Added: the worker is now an explicit **internal-service health entry** in `modules/ops/api.js` (`(internal) salesforce_merge_worker` → `:8021/api/status`) so 8021 shows in the Backends health pane too (needs an 8022 restart).

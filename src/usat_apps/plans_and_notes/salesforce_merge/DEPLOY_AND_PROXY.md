# Deploy + proxy notes — Salesforce Merge tool (usat-app)

How the merge tool is served behind the proxy, how to run it on kidderwise, and the VS Code
`tasks.json` snippets (that file is protected, so they're recorded here to paste manually).

## Hosts + ports

- `:8020` — the merge server (`server_salesforce_merge_8020.js`): Express API + the built React app.
- `:5173` — Vite dev server (hot reload). **Dev only**, served at root (`/`), proxies `/api` to `:8020`.
- `:8000` — the reverse proxy (`server_proxy_8000.js`). Fronts everything.
- `usat-api.kidderwise.org` → `:8000` — the API services (path prefixes, unchanged).
- `usat-app.kidderwise.org` → `:8000` — the React apps. Merge lives at `usat-app.kidderwise.org/merge`.

Both hostnames point at the **same** proxy (`:8000`); the proxy routes `/merge → :8020` and strips the
prefix. No second proxy needed.

## Which URL when

- **Coding** → `:5173` (hot reload, app at root). Not exposed publicly.
- **Proxy/prod rehearsal** → `:8000/merge/` (or ngrok → `:8000`, then `/merge/`). This serves the
  **built** app (rebuild to see changes), exactly what kidderwise serves.

## Path-aware build (required for /merge)

A React SPA under a path must be built aware of it. Driven by `import.meta.env.BASE_URL`:

- `npm run salesforce_merge_build`        → base `/` (served at root :8020 / dev).
- `npm run salesforce_merge_build_proxy`  → base `/merge/` (served behind the proxy at /merge).

The proxy build makes assets load from `/merge/assets`, the router run under `/merge`, API calls go to
`/merge/api/...`, and the favicon to `/merge/favicon.svg`. The proxy strips `/merge` so `:8020` serves
it all at root. (A `--base=/merge/` build opened **directly** at `:8020/` looks broken — reach it
through the proxy / `:8000/merge`.)

## proxy_routes.js

Already added (in `utilities/proxy/proxy_routes.js`):

```js
'/merge': { target: 'http://127.0.0.1:8020', health: '/api/status' },
```

This auto-wires forwarding, the `/api/health` aggregator, and the `/admin` console (they all read the
routes map). Restart the proxy to pick it up: `npm run restart_proxy` (or `pm2 reload usat_proxy`).

## Launch on kidderwise (server runbook)

```bash
git pull
npm install
npm run salesforce_merge_build_proxy        # build dist with base /merge/
# .env must have: MERGE_ADMIN_USER, MERGE_ADMIN_PASS, MERGE_SESSION_SECRET (+ DB creds), optional MERGE_PORT=8020
npm run pm2_start_salesforce_merge          # start :8020 under pm2
npm run restart_proxy                        # proxy picks up the /merge route
pm2 save                                      # persist across reboots
```

`pm2_start_salesforce_merge` is also included in `pm2_run_all_servers` now, so a full fleet start
includes the merge server.

### Cloudflare (done in the dashboard / tunnel config, not in this repo)

Add a public hostname to the tunnel:

- `usat-app.kidderwise.org`  →  service `http://localhost:8000`

Then test: `https://usat-app.kidderwise.org/merge/`.

Local checks before Cloudflare: `:8000/merge/` (path routing works on any host), then ngrok → `:8000`,
open `https://<ngrok>/merge/`.

## Local proxy test via the menu

`npm run salesforce_merge_menu` →  5 (build for /merge) → 6 (start :8020) → 7 (start proxy :8000) →
12 (open :8000/merge/). Run each long-running one in its own terminal.

## VS Code tasks.json snippets (paste manually — `.vscode/` is protected)

**1. Log/shell pair** — after the `"18 SALESFORCE DUPLICATES (shell)"` task:

```jsonc
    {
      "label": "19 SALESFORCE MERGE (logs)",
      "type": "shell",
      "command": "npm run pm2_logs_salesforce_merge",
      "isBackground": true,
      "problemMatcher": [],
      "options": { "cwd": "${workspaceFolder}" },
      "presentation": { "reveal": "always", "panel": "shared", "group": "grp-salesforce-merge", "focus": true }
    },
    {
      "label": "19 SALESFORCE MERGE (shell)",
      "type": "shell",
      "command": "bash -lc \"echo -e '\\n\\033[1;34mREADY: SALESFORCE MERGE\\033[0m\\n'; exec bash\"",
      "isBackground": true,
      "problemMatcher": [],
      "options": { "cwd": "${workspaceFolder}" },
      "presentation": { "reveal": "always", "panel": "shared", "group": "grp-salesforce-merge", "focus": false }
    },
```

**2. Split group** — after the `"Salesforce Duplicates (split)"` task:

```jsonc
    {
      "label": "Salesforce Merge (split)",
      "dependsOn": [
        "19 SALESFORCE MERGE (logs)",
        "19 SALESFORCE MERGE (shell)"
      ],
      "dependsOrder": "parallel"
    },
```

**3. Umbrella tasks** — in the `dependsOn` of both `"All Logs (19 groups)"` and `"Test"`, add after
`"Salesforce Duplicates (split)",`:

```jsonc
        "Salesforce Merge (split)",
```

Optionally rename `"All Logs (19 groups)"` → `"All Logs (20 groups)"`.

> These tasks only **tail logs** — they don't start servers. The merge server must already be running
> under pm2 (`npm run pm2_start_salesforce_merge`) for the pane to show output.

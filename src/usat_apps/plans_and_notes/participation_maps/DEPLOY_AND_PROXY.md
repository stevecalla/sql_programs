# Deploy & proxy — reporting app go-live

The reporting app runs on port **8021** behind the `:8000` proxy at `/reporting`, exactly like the
merge app runs at `/merge` on 8020. Go-live is intentionally a **manual one-command step** — an agent
never restarts the live proxy.

## 1. Add the `reporting_*` npm scripts (root `package.json`)

These mirror the `salesforce_merge_*` scripts. Paste into `"scripts"` (NOT auto-added, to avoid
editing the large package.json blindly):

```jsonc
"reporting_menu":         "node src/reporting/menu.js",
"reporting_server":       "node server_reporting_8021.js",
"reporting_dev":          "nodemon --watch server_reporting_8021.js --watch src/reporting --ext js server_reporting_8021.js",
"reporting_web":          "npm --prefix src/reporting/web run dev",
"reporting_dev_all":      "concurrently -k -n api,web -c blue,green \"npm run reporting_dev\" \"npm run reporting_web\"",
"reporting_build":        "npm --prefix src/reporting/web install && npm --prefix src/reporting/web run build",
"reporting_build_proxy":  "npm --prefix src/reporting/web install && npm --prefix src/reporting/web run build -- --base=/reporting/",
"reporting_test":         "node --test src/reporting/tests",
"pm2_start_reporting":    "npx pm2 start server_reporting_8021.js --name usat_reporting --node-args=\"--max-old-space-size=2048\"",
"restart_reporting":      "npx pm2 restart usat_reporting",
"stop_reporting":         "npx pm2 stop usat_reporting",
"pm2_logs_reporting":     "npx pm2 logs usat_reporting",
"reporting_deploy":       "npm run reporting_build_proxy && (npm run restart_reporting || npm run pm2_start_reporting) && npm run pm2_reload_proxy && npx pm2 save"
```

These match the launcher menu (`node src/reporting/menu.js`) item-for-item, mirroring the merge
tool's `salesforce_merge_*` scripts + `salesforce_merge_menu`.

## 2. Environment (`.env` at repo root)

```
REPORTING_ADMIN_USER=<login>
REPORTING_ADMIN_PASS=<password>
# REPORTING_SESSION_SECRET=<optional fixed secret>
# LOCAL_MYSQL_* already present
```

## 3. Build the SPA (path-aware for the proxy)

```
npm run reporting_build_proxy     # Vite base '/reporting/'
```

## 4. Start the service

```
npm run pm2_start_reporting       # or: node server_reporting_8021.js
```

Verify: `http://localhost:8021/api/status` → `{ ok: true, app: "reporting" }`.

## 5. Turn on the proxy route (the actual go-live)

Uncomment one line in `utilities/proxy/proxy_routes.js`:

```js
'/reporting':             { target: 'http://127.0.0.1:8021', health: '/api/status' },
```

Then reload the proxy:

```
npm run pm2_reload_proxy          # or restart the usat_proxy process
```

Cloudflare already points `usat-app.kidderwise.org` → `:8000` (same host as `/merge`), so
`https://usat-app.kidderwise.org/reporting/participation-maps` is live.

## Rollback
Re-comment the `/reporting` line + reload the proxy, and `npm run stop_reporting`. Nothing else is
affected — merge and every other service are untouched.

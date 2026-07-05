# USAT Reporting

A React SPA + small Express host for USAT reports, served behind the `:8000` proxy at `/reporting`.
First page: **participation maps** (interactive state/region/flow dashboard). Mirrors the Salesforce
Merge app (`src/salesforce_merge`) so conventions match across the codebase.

- **Server:** `server_reporting_8021.js` (repo root), port **8021**, PM2 name `usat_reporting`.
- **URL:** `/reporting/participation-maps` (behind the proxy).
- **Data:** local MySQL `usat_sales_db`, read-only. No BigQuery.

## Run locally

```
# 1. API server
node server_reporting_8021.js            # http://localhost:8021/api/status

# 2. Web (dev, proxies /api -> :8021)
cd src/reporting/web && npm install && npm run dev     # http://localhost:5174

# 3. Web (prod build the Express server serves)
cd src/reporting/web && npm run build
```

## Environment (`.env` at repo root)

```
REPORTING_ADMIN_USER=...        # recovery admin login
REPORTING_ADMIN_PASS=...
REPORTING_SESSION_SECRET=...    # optional; else auto-generated + persisted
# LOCAL_MYSQL_* already present (shared with other services)
```

## Data note

`store/participation_read.js` builds the `/api/bootstrap` payload from MySQL. Until the query is
finished (Phase 1) it falls back to a fixture so the app runs — seed it once with:

```
node src/reporting/store/make_fixture.js "<path-to>/usat_participation_dashboard_LATEST.html"
```

See `plans_and_notes/` for the phase plan, deploy steps, metrics/admin overlap, and current status.

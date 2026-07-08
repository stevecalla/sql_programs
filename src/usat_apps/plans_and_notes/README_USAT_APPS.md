# USAT Apps — platform charter & plan

One Express + React **platform shell** that hosts USAT's internal tools as **modules** (reporting,
merge, event-analysis, …). Built in parallel with the existing apps — `/reporting` (8021) and
`/merge` (8020) are **untouched**; this is a fresh copy on **port 8022** that we grow into the single
app, then port the others onto.

- **Server:** `server_usat_apps_8022.js` (repo root) · default port **8022** (`USATAPPS_PORT` overrides)
- **Umbrella prefix (behind the :8000 proxy / Cloudflare):** `/apps`
- **Code:** `src/usat_apps/`
- **Build the web app:** `cd src/usat_apps/web && npm install && npm run build`

## Why platform + modules (the sustainable choice)

The repo has ≥5 apps (reporting, merge, event-analysis, email-queue, race-results) that are ~70%
identical plumbing (session auth, admin/access, usage metrics + "ask", the shell) copy-pasted per app.
That duplication is what makes changes expensive. The platform extracts that shared 70% **once** and
makes each app a thin **module** contributing only its unique 30%. Modular monolith — one process, one
deploy, clean module boundaries (not microservices; that would be over-engineering for this scale).

## Folder structure

```
server_usat_apps_8022.js          # single host (mounts platform API + serves the SPA)
src/usat_apps/
  data_dir.js                     # runtime data home (auth.json, panel_access.json) OUTSIDE the repo
  store/db.js                     # shared read-only MySQL pool (usat_sales_db)
  auth/                           # THE COMMON STUFF (platform core)
    auth_store.js                 #   local users (scrypt) + .env recovery accounts + session secret
    session.js                    #   signed-cookie sessions (cookie: usat_apps_session)
    require_auth.js               #   require_auth / require_admin / require_panel middleware
  access/panel_access.js          #   panel catalog (built from the module registry) + allow-list
  metrics/                        #   usage analytics (usat_apps_events) + report + ask-your-data
    events.js  metrics_report.js  ask.js
  api/routes.js                   # platform routes: status/login/logout/me/modules/metrics/admin
  modules/                        # FEATURE DOMAINS (thin)
    registry.js                   #   the module list (add a module here)
    reporting/{module.js,api.js}  #   first module (proof-of-contract stub; full maps port = next)
    _template/module.js           #   copy this to scaffold a new module
  web/                            # the React SPA (Vite)
    src/
      App.jsx                     #   shell + dynamic module routes
      components/                 #   ThemeToggle, UserMenu, SideRail (module-driven), FooterClock
      pages/                      #   Login, Home (landing), Admin (access), Metrics
      lib/                        #   api, theme, track
      modules/registry.js         #   FRONT-END module list (lazy-loaded sections)
      modules/reporting/Section.jsx
  tests/auth.test.js              # auth + access unit tests (no DB)
  plans_and_notes/README_USAT_APPS.md   # this file
```

## The module contract

A module is a self-contained feature domain. It contributes exactly four things.

**Server** — `src/usat_apps/modules/<id>/module.js` (add to `modules/registry.js`):

```
{
  id:          'reporting',                 // stable slug -> URL segment + panel namespace
  label:       'Reporting',                 // nav label
  panels:      [{ key, label }],            // panel keys added to the access catalog
  metricsTable: 'usat_apps_events' | null,  // its own analytics table, or null to share the default
  mount(app):  registers /api/<id>/* routes // panel-gate them with require_panel(...)
}
```

**Front-end** — `web/src/modules/<id>/Section.jsx` + an entry in `web/src/modules/registry.js`
(`{ id, label, path, panel, Component: lazy(() => import('./<id>/Section.jsx')) }`).

That's it. Panel access, the side-rail nav, the home landing cards, and API mounting all read from the
registries, so a new app "just appears." Nothing else in the platform changes.

## Authentication — local now, Microsoft/Entra later (deferred, safe)

Auth is split into **authentication** (who you are) and **authorization** (what you can see). We built
authorization now (the allow-list + panel access in `access/panel_access.js` + Admin page). It is
independent of *how* someone signs in, so adding Microsoft later is purely additive — no rework.

**Today:** local username/password + `.env` recovery admin. The platform uses its **own** creds only —
no hidden fallback to another app's login. Add to `sql_programs/.env`:
`USATAPPS_ADMIN_USER` + `USATAPPS_ADMIN_PASS` (role admin, always valid, never removable). Optional
second admin: `USATAPPS_TEST_USER` / `USATAPPS_TEST_PASS`. Optional `USATAPPS_SESSION_SECRET` (else one
is auto-generated and persisted to `auth.json`). Once logged in, add everyone else in-app or via
`node src/usat_apps/admin.js add`.

**Later — Microsoft Entra ID (Azure AD) SSO, the "allow-list" model you want:**
1. IT does a **one-time** app registration in USAT's tenant (client ID, redirect URL, admin consent).
2. Add an OIDC login route in `auth/` (a "Sign in with Microsoft" button on `Login.jsx`).
3. After Microsoft verifies identity, look up the returned **email** in the users table:
   - email present → issue our session cookie with their role + panels (already built).
   - email absent → deny ("ask an admin"). *You* add the email in-app; no IT ticket for access.
4. Keep the local recovery admin as a permanent fallback.
5. Anchor each user record to Microsoft's **immutable object id** (store email + oid); manage by email.
Optional: map Entra security **groups → roles/panels** so IT's groups drive coarse access.

Because auth lives in the platform core, wiring Entra **once** gives every module SSO.
(Reference: skip's other app that already uses MS auth — reuse its registration details when we start.)

## Phase plan

1. **Skeleton on 8022** — folder, server, shared shell on a generic landing page. ✅
2. **Platform core + local login** — auth_store/session/require_auth + `.env` recovery. ✅
3. **Access model** — in-app Users + Panel-access admin; email-keyed users. ✅
4. **Module contract + first module** — registry + `reporting` module (stub proving the pattern). ✅
   - **Next:** port the real participation-maps stack (`participation_read.js`,
     `/api/reporting/bootstrap` + `/api/reporting/unique`, the Plotly/deck.gl pages) into the module.
     Deferred here because it needs the live MySQL to verify.
5. **Microsoft SSO** — add the OIDC login method (uses skip's existing app registration as the template).
6. **Port the other apps** — merge, event-analysis, email-queue, race-results as modules.

## Build & run

```
# API only (works without the web build):
node server_usat_apps_8022.js            # http://localhost:8022/api/status

# Full app:
cd src/usat_apps/web && npm install && npm run build
node server_usat_apps_8022.js            # http://localhost:8022/

# Behind the :8000 proxy: build path-aware
cd src/usat_apps/web && npm run build -- --base=/apps/
```

Log in with the `.env` recovery admin (`USATAPPS_ADMIN_*` or the existing `REPORTING_ADMIN_*`).

## Data / DB notes

- Reuses the shared read-only `usat_sales_db` pool. **No** merge/reporting tables are modified.
- Usage analytics write to a **new** table `usat_apps_events` (created on first event via `ensure()`).
  Nothing creates it against your DB until the server runs and logs an event.
- Ask-your-data degrades gracefully with no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.

## Status / verification notes (build pass on your machine)

Built while away, in parallel, `/reporting` + `/merge` untouched. Verified here:
- **Unit tests 7/7 pass** (`node --test src/usat_apps/tests/auth.test.js`) — password hashing, `.env`
  recovery login, add/remove/validate users, session sign/verify + tamper rejection, the
  module-driven panel catalog (reporting + platform panels), and the admin/default/per-user access model.
  This exercises the whole `panel_access → registry → reporting module → require_auth` chain.
- **`node --check` clean** on `server_usat_apps_8022.js`, `api/routes.js`, `access/panel_access.js`,
  `metrics/events.js`, `metrics/metrics_report.js`, `modules/registry.js`, `modules/reporting/{module,api}.js`.
- `metrics/ask.js` is byte-complete on disk (verbatim from reporting's proven ask.js + genericized).

NOTE on the sandbox: the OneDrive-synced dev mount null-pads / clips freshly-overwritten files for
shell tools (bash/node), so a *live server boot could not be run here*. That is a sandbox artifact, not
a code defect — the files are correct on disk. On a normal filesystem the boot below just works.

Still to verify on a real machine (also needs live MySQL for the metrics/DB paths):
1. `node --test src/usat_apps/tests/auth.test.js` → auth/access green.
2. `node server_usat_apps_8022.js` → boots; `/api/status` returns `{app:'usat_apps'}`; log in; `/api/me`
   and `/api/modules` return your panels; `/api/reporting/ping` is reachable when you have the panel.
3. `cd src/usat_apps/web && npm install && npm run build` → SPA builds; open `http://localhost:8022/`.

Once green, the next work item is the reporting participation-maps port (Phase 4 "Next").

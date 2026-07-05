# Metrics & admin — how reporting overlaps with the merge app

Question: reporting will want usage **metrics** and an **admin** (users + access), like merge has.
Should those be shared with merge or separate? This is the decision and the reasoning.

## Decision: mirror merge's pattern as reporting's own, share the database

The codebase convention is **per-app auth**: every UI service (email-queue, merge, …) has its own
signed-cookie session (own cookie name), its own user store, and its own env recovery accounts. We
follow that — reporting has its own `reporting_session` cookie, `REPORTING_*` env, and
`usat_reporting/auth.json` store. This keeps apps independent and matches everything else in the repo.

What we **share** is the infrastructure underneath, not the login:

- **Database** — reporting reads the same local `usat_sales_db` via the same `utilities/config` pool.
- **Metrics store** — usage events go to a `reporting_events` table stamped `app='reporting'`, the
  same shape as merge's events. A single metrics view can later `UNION` merge + reporting by `app`.
- **Env admin account (optional)** — you can set `REPORTING_ADMIN_*` to the same values as
  `MERGE_ADMIN_*` if you want one recovery login across both, but they remain independent settings.

## What this means concretely

- **Auth:** independent per app. A merge login is not automatically a reporting login (per convention).
- **Admin:** each app manages its own stored users + panel access (`/api/admin/*`, mirrored from
  merge). No shared admin surface today.
- **Metrics:** independent capture, shared table + schema, so cross-app reporting is easy later.

## If you later want a single sign-on across the suite (a deliberate deviation)

Two clean options, both future work:
1. **Shared session** — have reporting and merge read the *same* cookie name + `*_SESSION_SECRET* and
   the same user store. One login works everywhere. Small change, but a departure from the current
   per-app isolation.
2. **Proxy-level identity** — move authentication to the `:8000` proxy (SSO/OIDC, e.g. Salesforce or
   Google/Azure), which injects a verified identity header to each app. Apps stop doing their own
   login and just read the header + enforce panel/role. This is the cleanest long-term "one login,
   many apps" model and the natural place to add role→app authorization.

Recommendation: ship per-app now (matches conventions, zero risk to merge); revisit proxy-level SSO
when a third app appears or when non-admin users need governed access across reports.

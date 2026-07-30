# Email Queue fold-in — STATUS & phase table

Living status for the salesforce_email_queue → usat_apps port. Full detail: `BUILD_PLAN.md` (phases),
`EMAIL_QUEUE_FOLDIN_PLAN.md` (architecture), `PORT_INVENTORY.md` (file map).

Last updated: 2026-07-30

## Locked information architecture (URLs + panels)

| Surface | Path | Panel key | Group |
|---|---|---|---|
| Operator app | `/salesforce/email-queue` | `email-queue` | Salesforce |
| Metrics dashboards | `/metrics/sf-email-queue` | `email-queue-metrics` | Metrics |
| Domain settings (SF env, AI models/pricing, banner, queue access) | in-module `/salesforce/email-queue/settings` (default) | `email-queue` | — |
| Platform admin/ops (shared, NOT re-ported) | `/admin/*`, `/ops/*` | `admin` / `ops` | — |

Host: `usat-app.kidderwise.org` (served at root, no `/apps` prefix). Old `usat-email.kidderwise.org` →
retire at cutover, optional Cloudflare redirect to the new path.

## Phase table

| Ph | Focus | Key outputs | New server? | Gate | Status |
|----|-------|-------------|-------------|------|--------|
| 0 | Scaffold + decisions | `services/` + module folders; decisions locked | no | skeleton reviewed; 8022 unchanged | ✅ done |
| 1 | Shared services (brain) | `services/{ai,knowledge,corrections,salesforce}` + tests | no | services tests green (`run_tests.js`) | 🔄 in progress |
| 2 | Module API + SF read | `modules/salesforce_email_queue/api.js`, `sf/`; registered → mounts into 8022 | no | routes tests green; endpoints behind proxy | ⬜ |
| 3 | Operator UI (React) | `Section.jsx` + pages at `/salesforce/email-queue` | no | Playwright E2E + side-by-side vs 8019 | ⬜ |
| 4 | Admin + metrics | Settings, queue access, dashboards at `/metrics/sf-email-queue` | no | admin/metrics tests green | ⬜ |
| 5 | Cutover + retire 8019 | corrections import, retire runbook, package/tasks/proxy cleanup, redirect | removes 8019 | full suite + UAT; **no data loss** | ⬜ |
| 6 | Chatbot (separate plan) | 2nd consumer of services + public server (`externalApi`) + GTM widget | **yes** (public) | its own | ⬜ (unblocked after Ph 1–2) |

## Phase 1 detail (current work)

| Step | Item | Status |
|---|---|---|
| 1a | `services/ai` core (providers, models[config-decoupled], prompt, context, spam, extract) + `services/text_clean` | ✅ 16 tests green |
| 1b | `respond` / `triage` / `ask` — port decoupled from `sf` (data-in) + tests | ⬜ next |
| 1c | `services/knowledge` — from `faq.js`, scope-generalized (`_global`\|queue\|embed-key), file-backed + test | ⬜ |
| 1d | `services/corrections` — DB table `salesforce_email_queue_corrections` + injectable conn (fake-DB test) | ⬜ |
| 1e | `services/salesforce` — adopt `utilities/salesforce/salesforce_connect.js` (role-aware) as shared client | ⬜ |
| 1f | full `services/` suite green (Phase 1 gate) | ⬜ |

## Locked decisions
- Top-level `src/usat_apps/services/` seam. ✅
- Operator corrections → DB; knowledge/context files stay file-based (share 8019's folder for zero-loss). ✅
- No new server (mounts into 8022); no worker. ✅
- Keep current defaults (OpenAI default provider; shared `salesforce_email_queue_events` table, `is_test` for test runs). ✅

## Guardrails
- Additive only — leave 8019 + `src/salesforce_email_queue_proof_of_concept` running & untouched until cutover.
- No data loss at cutover: shared context folder; import `corrections.json` → DB **after** 8019 stops; keep JSON backup.
- Public chatbot never touches member PII (curated knowledge only).

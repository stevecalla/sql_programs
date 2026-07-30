# salesforce_email_queue module (scaffold)

Server-side scaffold for the email-queue fold-in. **Not registered yet** — adding it to
`modules/registry.js` is the final flip (Phase 2). Plan + inventory live in
`plans_and_notes/salesforce_email_queue/`.

Ports here:
- `api.js`   <- email-queue `web/routes.js` (JSON API, `/api/salesforce-email-queue/*`)
- `sf/`      <- email-queue `sf/` (Salesforce read layer; read-only)
- `store/`   <- email-queue `store/queue_access.js`
- `menu.js`  <- CLI entry (optional)

Extracted UP to `src/usat_apps/services/` (shared with the chatbot): the AI layer, the knowledge
loader, and operator corrections.

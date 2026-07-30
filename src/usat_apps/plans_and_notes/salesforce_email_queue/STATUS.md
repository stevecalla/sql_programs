# Email Queue fold-in — status

Living status for the salesforce_email_queue → usat_apps port. See `EMAIL_QUEUE_FOLDIN_PLAN.md`
for the full plan and `PORT_INVENTORY.md` for the file-by-file mapping.

## Now
- **Phase 0 — Scaffold: in progress.** Module + services folder skeleton created (un-registered),
  plans folder written. Platform unchanged.

## Phase status
- [~] Phase 0 — Scaffold (module/services/plans folders, this doc)
- [ ] Phase 1 — Shared brain (`services/ai`, `services/knowledge`, `services/corrections`) + tests
- [ ] Phase 2 — Module API + SF read (`api.js`, `sf/`), register in server registry
- [ ] Phase 3 — Operator UI React rebuild (`Section.jsx` + pages), register in web registry
- [ ] Phase 4 — Parity pass + platform metrics/Ask
- [ ] Phase 5 — Chatbot module can begin (separate plan; consumes shared services)
- [ ] Phase 6 — Retire standalone 8019 (runbook, pm2 stop/delete, cleanup; keep SF creds + events table)

## Key facts (ground-truthed 2026-07-30)
- Source: `src/salesforce_email_queue_proof_of_concept`, standalone Express on **port 8019**,
  pm2 `usat_salesforce_email_queue`.
- **Read-only** against Salesforce — no writes, no worker, no execution surface.
- UI is **vanilla** (890-line `index.html`), not React → rebuild.
- Backend brain (`ai/`, `sf/`, `store/`) is clean and ports nearly verbatim.

## Decisions pending (see plan §9)
1. Introduce top-level `src/usat_apps/services/` seam? (recommend yes)
2. Corrections/knowledge → DB in Phase 1, or file-backed first?
3. Default AI provider: keep OpenAI or standardize on Anthropic?
4. Phase 3 UI: full parity or MVP-first?
5. Names: id `salesforce_email_queue`, URL `/email-queue`, panel `email-queue`?

## Guardrails (carry from chatbot plan)
- Public chatbot **never** touches member PII: consumes only `services/knowledge` (curated/derived) +
  `services/ai`; has no route into `sf/` or raw cases.
- On 8019 retirement: keep all `SF_*` creds and the `salesforce_email_queue_events` table.

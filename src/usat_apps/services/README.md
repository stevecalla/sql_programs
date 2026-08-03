# usat_apps shared services

Module-agnostic building blocks shared across modules. Introduced for the email-queue fold-in so the
Team USA chatbot can reuse the same brain instead of copying it.

- `ai/`          <- email-queue `ai/` (providers OpenAI+Anthropic, respond/triage/ask/extract, prompt)
- `knowledge/`   <- email-queue `ai/faq.js`, generalized: scope key = _global | <queue_slug> | <embed_key>
- `corrections/` <- email-queue `store/corrections.js`, generalized + DB-backed (Track C)

PII boundary: `knowledge/` and `corrections/` return only curated / derived content. Raw cases and
sender history are NOT reachable through these services — they stay behind the email-queue module's
authenticated `sf/` read path. The public chatbot consumes only `ai/` + `knowledge/`.

See plans_and_notes/salesforce_email_queue/EMAIL_QUEUE_FOLDIN_PLAN.md (section 5).

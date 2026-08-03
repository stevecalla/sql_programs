# Path to Production — Salesforce Email Queue Assistant

Sequenced plan to take the read-only POC to a writing, multi-user production app. Each track is
independent enough to schedule on its own; dependencies are noted. Nothing here is built yet except
where marked DONE. Keep this current as tracks land.

## Prerequisites (before ANY real member data flows)
- Signed **DPA + Zero-Data-Retention (ZDR)** with the AI vendor (OpenAI and/or Anthropic). See README
  "Data handling" and the team .docx brief.
- All write paths tested in a **Salesforce sandbox** first.
- Keep the human-in-the-loop review; never auto-send without a person approving.

---

## Track A — Salesforce writes (status + send)   [effort: status ~hours, send ~1 day]

### A1. Update Case status (easy)
- Replace the mock in the thread-header status control with a real update.
- Files: `web/routes.js` (new `POST /api/case-status` -> `conn.sobject('Case').update({ Id, Status })`),
  `web/public/index.html` (wire `hdrStatus` change -> call the route + confirm dialog).
- Add an audit row (see Track C: `eq_audit`).

### A2. Send a reply (moderate)
- Replace the `POST /api/send` 403 stub with a real send.
- Mechanism (pick one): create an `EmailMessage` on the Case (`ParentId`, `Incoming=false`,
  `ToAddress`, `Subject`, `TextBody`/`HtmlBody`) and send; or call the email action.
- **Threading**: set In-Reply-To/References (or reuse the thread subject token) so it stays in the
  same email thread.
- Add idempotency (no double-send), audit (`eq_sends`), error/retry, and turn the UI "Send" live.
- Files: `web/routes.js` (`/api/send`), `sf/` (new `sf_writes.js` for the insert/send), `web/public/index.html`.

---

## Track B — Per-user Salesforce identity (Connected App / OAuth)   [effort: several days]

Goal: replies come from the actual staff member, not the integration user.
- Create a **Connected App** (OAuth 2.0) with a callback URL (see `salesforce_api_requirements.md` §11
  and the team brief).
- Add an **OAuth web flow**: each user authorizes once; store + refresh their token; API calls run as them.
- Map the app login (`SF_EMAIL_QUEUE_*` / stored users, with the `role` already plumbed) to the SF identity.
- Files: `auth/` (OAuth flow + token store), `web/routes.js` (callback + token use), `sf/` (per-user conn),
  `data_dir.js`/DB for token storage (encrypted).
- Middle path to ship sooner: send via an **Org-Wide Email Address** (shared queue address) and record
  "drafted by <app user>"; add true per-user identity later.

---

## Track C — Persistence backend (move file/in-memory stores to the DB)   [effort: 2-4 days, mostly mechanical]

Use the existing transform DB convention: `mysql2` pool via `utilities/config`, `ensure_table` /
`ensure_columns`, DDL in `src/queries/create_drop_db_table/`. Stores are already isolated modules, so
swap the backing store behind the same function APIs (routes/UI unchanged).

Tables to add (names indicative):
- `eq_corrections`  — replaces `store/corrections.js` JSON (now stored externally at
  `<base>/usat_email_queue/corrections.json`; move to this table). Cols: id, created_at, active, scope,
  author, queue, case_id, question, note.
- `eq_ask_history`  — persist Q&A per case + user (currently in-memory only).
- `eq_context_files`— metadata (name, scope, queue, size, ext, uploaded_by, uploaded_at); bytes stay on
  the external context folder (Track done below) or move to object storage.
- `eq_audit` / `eq_sends` — every status change / send (who, when, case, body hash) — required once
  Track A is on.
- `eq_triage_cache` (optional) — per-case AI status + timestamp so it survives refresh and saves AI calls.

Files: `store/*` (swap JSON->DB behind same API), `src/queries/create_drop_db_table/*` (DDL),
`web/routes.js` (unchanged signatures). Data privacy once PII persists: access control, encryption at
rest, retention policy.

Dependency: per-user history (ask/sends tied to identity) needs Track B.

---

## Vision (image context) — DONE
- `complete()` is multimodal (OpenAI + Anthropic); `faq.load_context_images()` sends png/jpeg/gif/webp
  from the context folder (<=4 images, <=4MB each) as grounding on draft/ask. Other image types are
  stored/listed only. Next: optionally feed image *email attachments* to vision too.

## Track D — AI tools / actions (function-calling)   [effort: framework ~2-3 days; +0.5-1 day per tool]

Why: many emails can't be answered from the thread + static context alone - they need a LOOKUP. Real
example (Coaching queue, Mike Barro): "I finished Level 1 - how do I do the required background check?
The site says it's not required. Also I'm stuck in a SafeSport Terms-and-Conditions loop (screenshot
attached)." Answering well needs: (a) the current coaching certification policy/steps, (b) this member's
cert level + background-check status, (c) a known-issues/KB lookup for the SafeSport loop, and (d)
reading the screenshot (vision - DONE).

Approach: use the providers' native **function-calling / tool-use** (OpenAI tools, Anthropic tool-use).
Define a small set of **read-only** tools the model may call; the engine executes them (SOQL / external
API), returns JSON, and the model grounds its draft on the results. Keep the same guardrails (no SF
writes, NEED_INFO when a tool can't confirm).

Candidate tools (all read-only first):
- `lookup_member(email|name)` -> Account/Contact summary (membership status, expiry).
- `get_coach_certification(member)` -> level(s), issue/expiry, background-check status, SafeSport status.
- `search_knowledge(query)` -> top KB / policy snippets (certification steps, "required?" answer,
  known SafeSport T&C-loop fix). Backed by the context folder now; a real KB/vector index later.
- `get_case_history(account)` -> prior cases/resolutions for this member.
- (write tools later, gated: `add_case_comment`, `update_case_status`, `send_reply` - Track A.)

Files: new `ai/tools/` (one module per tool + a registry with JSON schemas), `ai/providers.js`
(advertise tools + handle tool-call/-result round-trips), `ai/respond.js`/`ask.js` (tool loop), and
`web/routes.js` (unchanged surface). Tools that hit Salesforce reuse the read-only `conn`. See also
`salesforce_api_requirements.md` §12 (AI tools) which sketched this.

Sequencing: land the tool framework once, then add tools incrementally. `search_knowledge` over the
context folder is the cheapest first tool and immediately improves answers like the example above.

## Context storage — DONE (this round)
- User context now lives OUTSIDE the repo via the shared utility pattern: `data_dir.js` ->
  `utilities/determineOSPath()` -> `<base>/usat_email_queue/context/` (cross-platform). Mirrors
  `src/race_results_transform/src/data_dir.js`.
- Reads/writes/CLI/web all resolve there; overrides `EQ_CONTEXT_DIR` (point at any local folder),
  `EQ_DATA_DIR` (project root), `EQ_FAQ_DIR` (curated FAQ, still in-app/version-controlled).
- A SAMPLE grounding file is seeded into the external `_global` folder on first run (never overwrites).
- Next: when Track C lands, add `eq_context_files` metadata + (optional) object storage for the bytes.

## Suggested sequence
1. Track A1 (status) — quick win.
2. Track C corrections + ask-history + audit tables — unblocks real history.
3. Track A2 (send) with audit.
4. Track B (per-user identity) — the big one; or ship the org-wide-address middle path first.

---

## Track E — Salesforce environment: sandbox vs production (admin)   [revisit later]

Goal: run/test against a Salesforce **sandbox** safely and reach **production** only deliberately - so a
test instance can never accidentally write to prod once Track A (writes) is on.

Mechanics (plumbing already exists): sandbox uses `test.salesforce.com`, prod uses `login.salesforce.com`;
the shared `race_results_transform/sf` config has an `is_test` hook. Keep two credential sets in `.env`:
`SF_PROD_*` and `SF_SANDBOX_*` (sandbox usernames look like `you@org.sandboxName`).

Recommended model (hybrid):
- **Default every instance to SANDBOX.** Production is reached only by explicit config.
- **Env-locked per instance (primary):** `EQ_SF_ENV=sandbox|prod`. Run two instances like the other
  `server_*` services - e.g. `usat-email-sandbox.kidderwise.org` (sandbox) and
  `usat-email.kidderwise.org` (prod) - so there's no in-UI way to fat-finger prod.
- **Optional admin override:** an `admin`-role-gated toggle (uses the existing role) stored in the
  external `config.json`, which resets the cached SF connection on change. Switching to prod requires a
  confirm.
- **Writes rule:** status/send (Track A) only allowed when `org === prod AND writes explicitly enabled`
  (and in sandbox freely for testing).

Bake in regardless of model:
- **Active-org banner** in the header - amber "SANDBOX" / red "PRODUCTION" - always visible.
- **Namespace external data per org**: store context/corrections/auth/audit under
  `usat_email_queue/<org>/...` (one-line change in `data_dir.js`) since Case/record IDs differ between
  orgs - keeps sandbox and prod knowledge/corrections from mixing.

Files when we build it: `.env` (cred sets), `sf/` connection (select prod vs sandbox cfg), `data_dir.js`
(per-org subfolder), `web/routes.js` + `public/index.html` (admin toggle + banner), and the env-locked
default. Belongs in the admin console plan too.

---

## Track F — Salesforce platform changes to watch (2025-26)

External announcements that affect this plan (verify specifics/dates with the SF admin; summarized from
TDX / Salesforce security updates).

**Headless 360 (API-first platform + MCP tools + Agentforce)** - opportunity, not a blocker.
- Doesn't change anything already built (we're API-based).
- Track D (AI tools): evaluate calling Salesforce-exposed **MCP tools / APIs** instead of hand-rolled
  SOQL for lookups like `get_coach_certification` - could be faster + more maintainable.
- Native-vs-build (brief): add Agentforce/Headless 360 as a stronger "native" contender to weigh; our
  differentiators still hold (own grounding/guardrails, model choice incl. ZDR, the queue-triage UX).

**API Access Control ("Use Any API Client" / blocked-by-default) - the big one.**
- If the org enables API Access Control, unvetted/uninstalled connected apps are BLOCKED - this can block
  even our READ-ONLY integration user, not just future writes.
- Effect: the **Connected App (Track B) becomes a prerequisite for API access itself**, not only for
  per-user identity/writes. Need an installed + allowlisted Connected App, correct OAuth scopes, and the
  integration user permissioned to use it. Do this per org (sandbox + prod; ties to Track E).
- ACTION: confirm whether API Access Control is enabled on the org today (decides if the Connected App
  is needed NOW for reads vs later for writes).
- STATUS (confirmed): the POC reads from the org successfully today (queues/threads/attachments load),
  so API Access Control is NOT blocking the integration currently. The "API Access Control" Setup page
  was not visible to admin search (likely not enforced, or limited admin perms). Therefore the Connected
  App stays scheduled for the WRITES / per-user identity phase, not as a blocker for current reads. Still
  worth a one-line confirm from the full org admin before enabling writes.

**Spring '26: new orgs can't self-create connected apps** without a manual override / Salesforce Support
approval. ACTION: if the org is affected, budget time to request the override before creating the app.

**Legacy API retirement (v21.0-v30.0).** We use jsforce on a modern version, so likely fine. ACTION:
confirm the connection isn't pinned to an old API version (target a current vXX.0).

**Bottom line:** nothing built breaks today, but the **Connected App likely moves earlier** (possibly
required for current reads if API Access Control is on), and Headless 360 gives better tool backends for
Track D. Re-check the team brief's native-vs-build section.

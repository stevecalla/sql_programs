# Salesforce API Requirements — Email Queue POC

Scope of this doc: exactly what the Salesforce side must do to support the
email-queue assistant, what we already have (and can reuse verbatim) from
`race_results_transform/sf`, and the specific gaps we need to build. Write-back
to Salesforce is **wired but disabled** per decision — see section 5.

---

## 0. What already exists (reuse, don't rebuild)

The `race_results_transform/sf/` module is a clean, injectable, unit-tested
jsforce layer. We reuse most of it as-is:

| File | Gives us | Reuse for POC |
| --- | --- | --- |
| `sf_config.js` | prod/sandbox creds from `.env`, `check_sf_config()` | as-is (extend defaults) |
| `sf_client.js` | `make_connection()`, `run_soql()`, `describe_object()`, `query_in_batches()` (100-id batching) | as-is |
| `sf_fetch.js` | `fetch_content_version_bytes()` — download attachment bytes to memory | as-is |
| `sf_dates.js` | Mountain-Time filters/formatting | as-is |
| `sf_email.js` | Group(Queue) → Case → EmailMessage → ContentDocumentLink → ContentVersion chain | **pattern to extend** (today it only pulls *attachments* off open Rankings cases) |
| `sf_naming.js` | snake_case download naming | as-is |

Auth today is **username + password + security token** (`SF_PROD_*` /
`SF_DEV_*`), jsforce `conn.login()`, API `v64.0`. That is sufficient for the
read-only POC.

Queues already discovered (from `notes.txt`), all `Group` with `Type='Queue'`:
Clubs, Coaching, Event Services, HS Clubs, National Events, Rankings,
Results Only, Safe Sport Support, Service, System Admin Queue, Team USA.

---

## 1. Queue discovery  (READ — new, small)

Generalize the queue lookup that `sf_email.js` already does for one queue.

- **Need:** `list_queues(conn)` → `[{ id, name, developer_name }]`
- **SOQL:** `SELECT Id, Name, DeveloperName FROM Group WHERE Type = 'Queue' ORDER BY Name`
- **Optional count enrichment:** open-case count per queue
  `SELECT OwnerId, COUNT(Id) c FROM Case WHERE OwnerId IN (:queueIds) AND IsClosed = false GROUP BY OwnerId`
- Permissions: integration user must be able to see the `Group` and `Case`
  objects. Already proven by the Rankings path.

## 2. Email list for a selected queue + date range  (READ — extend existing)

`sf_email.js` filters to `HasAttachment = true`. The POC needs **all** emails,
attachments optional.

- **Need:** `list_queue_cases(conn, { queue, status, filter })` and
  `list_case_emails(conn, caseIds)`.
- **Cases SOQL:** `SELECT Id, CaseNumber, Subject, Status, IsClosed, Priority, ContactId, AccountId, OwnerId, CreatedDate, LastModifiedDate FROM Case WHERE OwnerId = :queueId [AND IsClosed = false] ORDER BY LastModifiedDate DESC`
- **Email headers SOQL (list view):** `SELECT Id, ParentId, Subject, FromAddress, FromName, ToAddress, Incoming, Status, MessageDate, HasAttachment FROM EmailMessage WHERE ParentId IN (:caseIds) ORDER BY MessageDate`
- Status/date filtering reuses `make_date_filter` + the `IsClosed` mapping
  already in `sf_email.js` (`not_closed` / `closed` / `all`).
- List rows show: Case #, Subject, Status, sender, last message date.

## 3. Full email thread + attachments for the selected email  (READ — new fields)

This is the biggest read gap: today we never pull message **bodies**.

- **Need:** `get_email_thread(conn, caseId)` returning every EmailMessage on the
  Case in chronological order, with bodies.
- **SOQL:** `SELECT Id, ParentId, Subject, FromAddress, FromName, ToAddress, CcAddress, BccAddress, Incoming, Status, MessageDate, HasAttachment, TextBody, HtmlBody, Headers FROM EmailMessage WHERE ParentId = :caseId ORDER BY MessageDate ASC`
  - Prefer `TextBody`; fall back to stripped `HtmlBody`.
  - `Incoming = true` → from the customer; `false` → outbound/agent reply.
- **Attachments:** reuse the `ContentDocumentLink → ContentVersion` hop from
  `sf_email.js`, then `fetch_content_version_bytes()` to pull bytes. Add light
  text extraction (xlsx/csv via existing repo libs; pdf/docx via the `pdf`/
  `docx` skills or a parser) so the AI can read attachment content.
- **Case detail:** `SELECT Id, CaseNumber, Subject, Description, Status, Priority, ContactId, AccountId, Contact.Name, Contact.Email, Account.Name FROM Case WHERE Id = :caseId`.

## 4. Context lookups for the AI  (READ — new)

Per `notes.txt`: AI may use this user's history + the last ~3 months of the
queue, but must not inject other users' PII.

- **This contact's history (scoped, safe to quote):**
  resolve the sender to a `Contact`/`Account`, then
  `SELECT Id, CaseNumber, Subject, Status, CreatedDate FROM Case WHERE ContactId = :contactId ORDER BY CreatedDate DESC` and their EmailMessages.
  Match by `ContactId` when known, else by `FromAddress`/`ToAddress` equality.
- **Queue-wide history (learn-from, do-not-quote):** last N months of
  EmailMessages in the queue, fed to the model as *style/pattern* grounding
  only. Enforce in the prompt + a guardrail that no PII or specific facts from
  other contacts appear in the draft.
- **Domain content folder:** FAQs / canned knowledge per queue, stored locally
  (`data/<queue>/content/` or MySQL), not in Salesforce. No SF API needed.

## 5. Write-back to Salesforce  (WRITE — build wiring, keep DISABLED)

Decision: **do not enable any write to Salesforce.** Build the functions and
the UI/CLI path, but gate every one behind a hard `SF_WRITE_ENABLED` flag that
defaults off, and surface a clear "Sending to Salesforce is not enabled in this
build" message to the user instead of calling the API.

Functions to stub/wire now (no-op + clear message until enabled):

- **Send a reply to the originator.** Two viable mechanisms, decide at enable
  time:
  1. REST Email action `POST /services/data/v64.0/actions/standard/emailSimple`
     (or `sendEmail`) — sends and logs the EmailMessage on the Case.
  2. `conn.sobject('EmailMessage').create({ ParentId, ToAddress, Subject, TextBody, Status:'3' })` then trigger send — more control, more setup.
- **Update Case stage/status/owner:** `conn.sobject('Case').update({ Id, Status, ... })`.
- **Post an internal note** (optional): Chatter `FeedItem` or Case Comment.

Until enabled these must: validate inputs, build the exact payload, log what
*would* be sent, and return `{ enabled:false, would_send:{...} }`. This lets us
demo and test the full pipeline with zero prod risk.

## 5a. Sender identity — who the reply appears to come from

When a reply is eventually sent (Email-to-Case via the `emailSimple`/`sendEmail`
action, or an `EmailMessage` record), the "from" identity is governed by the
**sender type** plus a hard rule that the From address must be a verified one.

Sender type options:

- **Current User** — attributed to whoever the API call is authenticated as. If
  the call acts as Carlie, Salesforce stamps Carlie as the sender (her name /
  her configured email).
- **Org-Wide Email Address (OWEA)** — a shared, verified address (e.g.
  `rankings@usatriathlon.org`). Comes from the *team*, not a person.
- **Default Workflow User** — a fixed system identity.

Hard rule: Salesforce only sends from (a) the running user's own verified email,
or (b) a verified OWEA that user is permitted to use. You cannot set an
arbitrary From address.

This forces an org decision that drives the auth design — **decide before
enabling sends**:

| Goal | Mechanism | Auth implication |
| --- | --- | --- |
| Reply truly attributed to the app user (Carlie sends as Carlie) | sender type = **Current User**, acting in that user's SF identity | A single shared integration user **cannot** do this. Need **per-user OAuth** (each app user authorizes against their own SF account) **or OAuth JWT-bearer impersonation** (a pre-authorized Connected App requests a token *for* a specific username, no password). App login must map to the user's SF identity. |
| Replies come from a shared queue mailbox | sender type = **Org-Wide Email Address** | A shared integration user is fine. Optionally set display name + sign the body "— Carlie" for cosmetic attribution, but the real sender is the shared address. |

Key consequence: **true per-user sender identity is the main reason to move off
username-password to a Connected App / OAuth** (see section 6). With one shared
service account, every reply comes from that account — not from the operator who
wrote it.

Caveat: exact behavior depends on org config — which OWEAs exist, each user's
"Send Email" permission, and the Email-to-Case settings. Confirm these in the
org as step one of enabling sends.

## 6. Auth, permissions & environment

- **POC (read-only):** existing username/password/token works. Run reads against
  **prod or sandbox**; do all eventual write testing in **sandbox (`SF_DEV_*`)**.
- **Integration user perms required for reads:** API Enabled; read on Group,
  Case, EmailMessage, Contact, Account, ContentDocumentLink, ContentVersion;
  visibility into the target queues.
- **For write (later, when enabled):** "Send Email" permission, edit on Case +
  EmailMessage, and the queue's sharing must allow the user to act on its cases.
- **Longer-term auth upgrade (note, not POC blocker):** move from
  username-password to a **Connected App** with OAuth 2.0 (JWT bearer or client
  credentials) so we're not shipping a password+token and so sending email is
  attributable to a service identity. Add `SF_CLIENT_ID` / `SF_CLIENT_SECRET` /
  `SF_JWT_KEY` to `.env` when we get there.

## 7. Governor limits / performance

- Keep the existing 100-id `query_in_batches` batching for the IN-clauses.
- The 3-month queue-history query can be large — cap with `LIMIT` + date filter,
  and cache per queue (MySQL or `data/`), refreshed on demand.
- Bodies (`TextBody`/`HtmlBody`) are heavy; only fetch full bodies for the one
  selected thread, not for list views.

---

## 8. Email detail — exact fields the POC needs (decision record)

What "full email detail" means for the selected thread, so `sf_threads.js` has a
fixed contract. Confirm each is readable via the verification step (§9).

EmailMessage (per message, ordered by `MessageDate ASC`, grouped by `ParentId`):

- Body: `TextBody` (preferred), `HtmlBody` (fallback, stripped to text).
- Direction: `Incoming` (true = from customer, false = agent/outbound) — this is
  what separates "question" from "answer" for both display and AI exemplars.
- Routing: `FromAddress`, `FromName`, `ToAddress`, `CcAddress`, `BccAddress`.
- Lifecycle: `Status`, `MessageDate`, `HasAttachment`, `Subject`, `Headers`
  (best-effort; we order by `MessageDate`, so Headers are optional).

Case detail (the thread's parent): `CaseNumber`, `Subject`, `Description`,
`Status`, `Priority`, `Origin`, `ContactId`, `AccountId`, `Contact.Name`,
`Contact.Email`, `Account.Name`, `OwnerId`, `CreatedDate`, `LastModifiedDate`.

### Thread assembly (multi-turn) — decision record

A back-and-forth is **not one record**: every message is a separate
`EmailMessage` row sharing the same `ParentId` (the Case). So `get_email_thread`
returns N rows ordered by `MessageDate ASC`; `Incoming` gives direction
(true = customer, false = us/auto). Notes:

- **Quoted history accumulates.** Each reply's `TextBody`/`HtmlBody` usually
  contains the quoted text of all prior turns ("On <date> X wrote: …"), so later
  messages get progressively longer. **Strip quoted history** (split on common
  reply markers / `>` quote blocks) before (a) feeding turns to the AI and
  (b) building tier-3 exemplars, so the model sees each turn's *new* content, not
  the same text repeated. Keep the full raw body available for display.
- Display/order by `MessageDate`; do not rely on `Headers` (not filterable).
- Subjects are usually the same with `RE:`/`FW:` prefixes — not a reliable
  thread key; group strictly by `ParentId`.

### Attachments — decision record

`EmailMessage.HasAttachment` only flags presence; the bytes live elsewhere. Hop
`EmailMessage → ContentDocumentLink → ContentVersion` (reuse the `sf_email.js`
pattern) to list files (`Title`, `FileExtension`, `ContentSize`, the
`ContentVersion` Id), then `fetch_content_version_bytes()` → download via
`/sobjects/ContentVersion/<id>/VersionData`. Uses:

- **AI review:** extract text (pdf/docx/xlsx/csv via repo libs / skills) and add
  it to the thread context so the assistant can read what the customer sent.
- **Operator review:** expose the file (title + download) in the UI/CLI.
- This is a deliberate advantage over the native Agentforce email agent, which
  **ignores attachments** — our notes require attachments be considered.
- `verify_sf_access.js` §7 already lists a thread's files with their
  `ContentVersionId` + ready GET path so they can be confirmed in Workbench.

## 9. Context rules — what the AI may use, and how (decision record)

Three tiers, with different trust levels. Enforced in `ai/context.js` +
`ai/guardrails.js`, not by Salesforce.

1. **This thread** — full ordered conversation for the selected Case,
   **including automated/system messages** (auto-acks, Flow sends). → Primary
   fact source. May be quoted freely. The AI must SEE automated messages here so
   it knows what has already been sent on this case (and doesn't repeat it).
2. **This contact's own history** — the sender's other Cases/EmailMessages,
   matched primarily on **`SuppliedEmail`/`FromAddress`** (verified 100% present
   on this queue), with `ContactId` as an optional upgrade when populated (~24%).
   → Safe to quote (same person).
3. **Queue-wide history (last ~3 months)** — other cases in the same queue.
   → **Style/pattern grounding only.** Used to imitate tone/structure of how
   agents answer this *kind* of question. The highest-value signal is paired
   inbound question (`Incoming=true`) → agent reply (`Incoming=false`) exemplars
   from resolved cases. **Never quote another contact's specifics or PII.**
4. **Domain content folder** — per-queue FAQ/canned knowledge in `data/<queue>/
   content/` (or MySQL). → Authoritative reference, freely usable.

**REQUIREMENT — automated/system replies:** exclude system/automated outbound
from *learning context* (tier-3 exemplars and any "how should I answer" grounding),
but **include** them in the *per-thread understanding* of the selected case so the
AI knows what has already been done to respond to that specific thread. In short:
keep them in tier 1 (this case's history), drop them from tier 3 (queue learning).

**Human vs automated replies (important):** an outbound `EmailMessage` whose
`CreatedBy.Name` is `Automated Process` / `System` is an **auto-response /
acknowledgement** (e.g. "Thanks for contacting us, your case # is…") sent by an
Email-to-Case auto-response rule or Flow — **not a human answer**. Consequences:

- The "ANSWERED" signal must be computed from **human** outbound only. A case
  with just an auto-ack is effectively *unanswered* and is exactly the kind the
  assistant should help with.
- Tier-3 exemplars (inbound question → reply) must **exclude automated outbound**
  so the AI doesn't learn to parrot the auto-ack boilerplate. Keep only replies
  authored by a real agent.
- Detect automated senders by `CreatedBy.Name` (`Automated Process`/`System`),
  and/or a known no-reply from-address / auto-response template match.

Hard rules:

- The draft's *facts* come only from tiers 1, 2, and 4. Tier 3 may shape *how*
  it's written, never *what* facts are asserted (and tier 3 = human replies only).
- A guardrail strips/denies any other contact's PII from leaking out of tier 3.
- If tiers 1+2+4 don't contain enough to answer, the AI must return
  "not enough info" + the specific gaps — it must not fill gaps from tier 3.
- **Strict grounding (observed failure):** the AI must not state any specific —
  timeframe, email address, phone, URL, price, policy, or date — that is not in
  the provided context; if one is needed, return need-info instead. (A POC draft
  invented "4-6 weeks" and a support email with no FAQ present.) The real fix is
  to supply those facts via the FAQ/knowledge tier (tier 4) + corrections.
- **Non-actionable senders:** automated bounces (mailer-daemon) and no-reply
  addresses must NOT be drafted a customer reply — flag for triage instead.

## 10. Verification before building (run `verify_sf_access.js`)

Run `node verify_sf_access.js prod` (or `sandbox`) as the **integration user**.
It checks exactly the §8/§9 dependencies. Beyond the pass/fail checks, §7 of the
script previews the 10 most recent threads with: the Case Id (= `ParentId`, to
paste into Workbench), subject, message counts (in/out), a question + response
excerpt, who answered (with `[human agent]` vs `[AUTOMATED]` tag), and any
attachments (file name, size, `ContentVersionId`, ready GET path). Record
results here:

Results — run 2026-06-18, Coaching queue, PROD, user `steve.calla@usatriathlon.org`, API v64.0:

| Check | What it proves | Result |
| --- | --- | --- |
| EmailMessage describe shows `TextBody`/`HtmlBody`/`Incoming`/`To/Cc/Bcc` | body + direction fields are FLS-readable | ✅ all visible (incl. Headers) |
| Sample thread shows `textLen > 0` | bodies actually populate (not blank) | ✅ 369/502 chars; inbound also has HtmlBody |
| Coaching queue resolves + case counts | sharing lets the user see queue cases | ✅ id `00GaZ000001CqogUAC`; 2,995 total, 5 open |
| `ContactId populated` rate on recent 50 | whether tier-2 needs FromAddress fallback | ⚠️ **only 12/50 (~24%)** — `SuppliedEmail` 50/50 (100%); all `Origin=Email` |
| Emails(3mo) inbound/outbound counts | tier-3 volume → caching/cap strategy | ✅ 1,929 (899 in / 1,030 out) — small; ~640/mo |
| `Parent.OwnerId` traversal works | we can query emails by queue in one hop | ✅ works |
| Headers populated? | optional; ordering falls back to MessageDate | ⚠️ `Headers` is **selectable but NOT filterable** — don't use in WHERE; not needed (order by MessageDate) |

**Decisions driven by these results:**

- **Contact history (tier 2) keys off `SuppliedEmail` / `FromAddress`, NOT
  `ContactId`** — ContactId is blank ~76% of the time on this queue, but
  SuppliedEmail is always present. `sf_context.js` matches on email address;
  ContactId is only an optional upgrade when present.
- Tier-3 3-month volume is small (~1,900), so we can cache the whole window per
  queue (MySQL/`data/`) and build inbound→outbound exemplar pairs without paging
  concerns.
- Never put `Headers` in a `WHERE` clause (SOQL rejects it). Select-only if ever
  needed; thread ordering uses `MessageDate ASC`.
- FLS/Enhanced Email are confirmed good on this integration user — no profile
  changes needed before building `sf_threads.js`.

**Plain-English rationale (so the "why" isn't lost):**

- **`ContactId` vs `SuppliedEmail`.** When an email hits the queue, Salesforce
  creates a Case. `ContactId` is a *link* to an existing Contact record, and it
  only fills in when the sender's address matches someone already in Salesforce
  — here that's ~24% of the time. `SuppliedEmail` is the *raw from-address*
  captured every time (100%), whether or not that person exists in the CRM. So
  to pull a sender's prior emails we match on the **email address**, not on
  whether they're a known Contact. (Match people by email, not by CRM presence.)
- **Headers "select vs filter".** You can *select* (read) `Headers`, but
  Salesforce forbids using it in a `WHERE` filter — that's a field-type rule, not
  a permission problem. It was a bug in the verification query, now fixed to read
  Headers instead of filtering. We don't need it anyway: thread order comes from
  `MessageDate`. Nothing is wrong with the org/data.

## 11. Per-user Salesforce identity (FUTURE — when sending is enabled)

Today the app reads as **one integration user**, and app login is a separate
local gate (see MVP plan). When we later want users to act under their *own* SF
identity, there are two parts:

**A. How their identity connects to the API.** Move to a **Connected App +
OAuth 2.0**; the app then calls SF with a token that acts *as that user*:

- A **callback URL (redirect URI)** is registered on the Connected App: the address Salesforce returns the user to after approving sign-in (must exactly match our app login endpoint, e.g. `http://localhost:8019/oauth/callback`). Security control; placeholder for JWT.
- **Authorization-code (per-user login):** user signs in with Salesforce, approves
  the app once; we store an access + refresh token tied to them.
- **JWT bearer (impersonation):** an admin pre-authorizes the Connected App to
  request a token *for* a username without their password (good for background
  work on someone's behalf).

**B. Whether that identity can actually read the data.** The API enforces the
**logged-in user's** permissions + record sharing — narrower than the integration
user. Per-user onboarding must confirm:

- `API Enabled` on the profile (required to use the API at all).
- Object + field read on Case, EmailMessage (incl. TextBody/HtmlBody), Contact,
  Account, ContentDocument/ContentVersion.
- Record access to the queues' cases (queue membership / role hierarchy / sharing).
- Usually granted via a shared **Permission Set**; verify per user with a
  per-user run of the access-check (our verify script as that user).

**The model fork (decide at enable time):**

- **Full per-user:** every read + send uses the user's token. Permissions and
  reply attribution both correct; but a user who can't see a queue in SF won't
  see it in the tool. More permission setup.
- **Hybrid (often best for a service desk):** reads via the integration user
  (consistent visibility for all reviewers), **sends** under the individual's
  identity (correct attribution). Tool may show data a user couldn't open
  directly in SF — a deliberate governance call.

This is why the MVP captures `sf_email` per user and keeps auth pluggable
(`auth/providers/`): switching to any of these is additive, not a rebuild.

## 12. AI tools / actions (research & lookups)

Per `notes.txt`, the AI may use **tools** to fetch specific info or take targeted
actions mid-reasoning (e.g. "is this coach certified?"). Implementation mirrors
`bot_analyst_chatgpt_like`'s tool loop: we expose function schemas to the model;
when it decides it needs data it calls a tool; we execute a **read-only** query
and return JSON; it continues until it can answer or declares "not enough info."

**Read-only lookup tools (safe, high value):**

- `lookup_contact_account(email|name)` → Contact/Account fields.
- `check_coach_certification(contact)` → certification status/level/expiry.
- `get_membership_status(member)` → active/expiry.
- `get_contact_history(email)` → this sender's prior cases/emails (tier 2).
- `search_faq(query)` → the queue's content/Knowledge folder (tier 4).
- `run_soql(safe_select)` → guarded ad-hoc read, allowlisted objects/fields only.

**Guardrails:**

- **Read-only by default.** Each tool is an allowlisted, parameterized query — no
  arbitrary DML. Any future *action* tool (e.g. update a field) is gated like
  sending (off by default, explicit enable).
- Reuse the **`sql_guard`** pattern (SELECT-only, allowlisted tables/fields, row
  caps) for the generic `run_soql` tool.
- PII scope still applies (this contact's data quotable; others not).
- Every tool call is **logged** (AI history / audit).
- With per-user identity (§11), tools automatically run under the user's perms.

**Discovery needed:** the certification / membership data model isn't known yet —
identify the object/fields via `describe` (e.g. a `Certification__c` object or
`Contact` cert fields) before wiring `check_coach_certification`.

**MVP:** ship a small read-only subset (`lookup_contact_account`,
`get_contact_history`, `search_faq`, and a guarded `run_soql`) so the demo shows
the AI doing a real lookup to answer. Cert/membership tools follow discovery.

## 13. API limits to confirm (ACTION ITEM)

Two separate quotas to investigate with real numbers before scaling past the POC.

**A. Salesforce API limits (the org's allocation):**

- **Daily API request allocation** — CONFIRMED (Jun 2026): USAT is **Unlimited
  Edition** with ~**410,000 API requests / 24h**; recent usage ~**4,000/day
  (<1%)** — ample headroom. (Setup → Company Information → "API Requests, Last
  24 Hours.") Every SOQL/REST call still counts toward this.
- **Calls per email viewed** — our flow issues several calls (queue list, cases,
  thread messages, attachment link + version, sender history, each attachment
  download). Estimate calls × expected daily usage vs. the allocation.
- **Concurrent request limits** (long-running calls) and **Bulk API** if we ever
  batch-load history.
- Mitigation: cache queue/case lists and the 3-month history; fetch full bodies
  + attachments only on demand; reuse a single connection.

**B. AI provider limits (OpenAI / Anthropic):**

- **Rate limits** — requests-per-minute (RPM) and tokens-per-minute (TPM),
  tiered by account usage/spend. Confirm our tier's RPM/TPM.
- **Context window** — max tokens per request; a long thread + history +
  attachment text can exceed it → need truncation/summarization.
- **Daily token caps + 429 handling** — implement backoff/retry on rate-limit
  errors.
- Mitigation: trim context (stripped turns, capped history), default to a
  smaller model for routine drafts, queue/serialize requests.

**Action:** capture the actual numbers (SF allocation + AI tier limits) and size
them against expected volume (e.g., Coaching ~300 inbound/mo, across 11 queues)
before any broader rollout.

## New SF module surface (proposed additions to `sf/`)

```
sf/
  sf_config.js          # reuse (add SF_WRITE_ENABLED, queue defaults)
  sf_client.js          # reuse
  sf_fetch.js           # reuse
  sf_dates.js           # reuse
  sf_naming.js          # reuse
  sf_queues.js          # NEW  list_queues, queue open-case counts
  sf_threads.js         # NEW  list_queue_cases, list_case_emails, get_email_thread, get_case_detail
  sf_context.js         # NEW  contact history + scoped queue history
  sf_write.js           # NEW  send_reply / update_case / post_note — DISABLED by flag
  index.js              # reuse, export the new functions
```

Everything stays **injectable + unit-testable with a mock `conn`**, matching the
existing `sf/` style (no network in tests).

## 14. AI queue triage (IMPLEMENTED - per-case + visible-queue, on-demand)

STATUS: implemented. `ai/triage.js` + `POST /api/ai/triage`; UI shows a status badge on the thread
header and queue rows, plus an "AI triage visible" button. Bounces/no-reply are classified locally
(no AI call). Internal tag only - not written to Salesforce. (Original notes below.)


Idea: have the AI scan the open emails in a queue and tag each with a triage status so staff can
prioritize - e.g. `answer_ready` (AI is confident it can fully draft), `draft_possible` (partial),
`needs_info` (missing facts), `non_actionable` (bounce/no-reply), `escalate`.

- Value: turns the queue into a worklist; staff jump to the easy wins / spot what needs a human.
- How: a batch pass that runs the same grounding (thread + history + FAQ/context) but only asks the
  model for a one-word verdict + 1-line reason per case (cheap, short output). Cache results; refresh
  on demand or on a schedule.
- Cost/limits: this multiplies AI calls by # of open emails - keep prompts tiny (subject + first
  inbound only for the first pass), cap volume, and respect the AI rate limits (see Section 13). The
  Coaching queue had ~9 open; the Service queue ~62 - still small, but a full-queue nightly scan
  across all queues should be batched + cached.
- Status writes back to Salesforce stay DISABLED (this is an internal tag for the tool, not a SF field)
  until/unless we enable writes.

## 15. Where context/knowledge is stored (guidance)

- POC: per-queue FAQ in `data/faq/` and user files in `data/context/` (gitignored). Fine for
  non-sensitive reference content during the proof of concept.
- Do NOT store member PII or sensitive material in the repo. For production, move context/knowledge to
  a secured server store (or Salesforce Knowledge / a Data Library) with access controls and backup -
  the app already loads context through one module (`ai/faq.js`), so the storage backend can change
  without touching the rest.

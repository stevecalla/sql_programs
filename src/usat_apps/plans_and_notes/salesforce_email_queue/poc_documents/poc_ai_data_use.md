# How This App Uses AI — and What It Shares (Data / PII Disclosure)

*Salesforce Email Queue Assistant (proof of concept). Internal reference for privacy/legal review. Describes the app as built; pair with `ai_data_privacy_thought_starter.docx` for vendor-side retention/training detail.*

## What the AI does

The app is a **read-only** assistant for staff working a Salesforce email queue. Four AI features operate on a live case, plus one operates on usage metrics:

1. **Triage** — classifies an email thread (actionable / awaiting reply / spam / non-actionable / needs info).
2. **Draft reply** — proposes a customer reply when there is enough information to answer.
3. **Ask about this case** — answers a staff member's question about the open thread.
4. **Spam pre-check** — a conservative local rule runs first; the model is only consulted when needed.
5. **Ask your data (metrics)** — natural-language questions over the **usage-analytics** database (separate path; see below).

Nothing is ever sent to a customer automatically — **a human reviews every draft.** The app makes **no writes** to Salesforce; the AI call is the only place data leaves the building.

## Where the data goes

Calls go to the **selected AI provider's API — OpenAI or Anthropic** (admin-selectable per model in `/admin → Settings`). Only the chosen provider receives the prompt for a given call. Token counts and estimated cost are recorded; the request content itself is not stored by the app.

## What is shared with the AI

**Features 1–4 (triage / draft / ask / spam) send the actual email content**, assembled as grounding context (`ai/context.js`, `ai/prompt.js`):

- The **email thread** — subject and the **full message bodies** of the customer, staff, and any automated messages, with dates.
- **Attachment contents** — extracted text of attachments on the thread.
- **Sender history** — the sender's prior cases (case number, status, subject, date).
- **Sender identity + signals** (triage/spam) — the from-name/email and computed flags.
- **Grounding files** — the queue FAQ / knowledge files and operator corrections (staff-authored).

**This content contains member PII.** Specifically it can include: member/customer **names and email addresses**, the **free-text body** of their messages (which may contain phone numbers, mailing addresses, membership IDs, dates of birth, and any personal or sensitive details the member chose to write), **email subjects**, and **attachment contents**.

**Feature 5 (metrics "ask your data") does NOT send member PII.** It sends the analytics table **schema**, the staff **question**, and **read-only query results** that are aggregate counts, enums, staff usernames, queue names, and Salesforce record IDs only. The analytics store is **PII-free by design** — it never holds member names, message bodies, or email addresses.

## PII summary

| Data element | Sent to AI? | Where |
|---|---|---|
| Member name / email address | **Yes** | Triage, Draft, Ask, Spam |
| Message body text (may contain phone, address, member ID, personal details) | **Yes** | Triage, Draft, Ask, Spam |
| Email subject / attachment contents | **Yes** | Triage, Draft, Ask |
| Sender's prior-case list (case #, status, subject) | **Yes** | Triage, Draft, Ask |
| Staff-authored FAQ / corrections | **Yes** | Draft, Ask |
| Usage analytics (counts, enums, usernames, queue, SF record IDs) | Yes — **no member PII** | Metrics "Ask your data" |
| Salesforce credentials / passwords / secrets | **No** | — |
| Raw analytics event rows / the local database | **No** | — |

## Safeguards in place

Read-only to Salesforce (AI is the only outbound path); **human-in-the-loop** on every reply; system-prompt **grounding rules** instruct the model to use only provided context, never invent PII, and never expose another member's data; admin-selectable model with token/cost tracking; and analytics deliberately store **no** member PII.

## Important status / caveat

This is a **proof of concept** intended to run on **mock/sandbox** data. If it is pointed at the **production** Salesforce org with a live AI API key, **real member PII would be transmitted to the AI provider.** Before any real member data is used, the project requires: a **commercial/organization** API account (not personal), a signed **DPA**, **Zero Data Retention** (or equivalent), and **training opt-out** confirmed for each provider — see `ai_data_privacy_thought_starter.docx`. Provider-side retention of these inputs is governed by vendor terms (commercial default is ~30 days; ZDR removes it).

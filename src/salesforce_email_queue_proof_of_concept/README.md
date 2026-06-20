# Salesforce Email Queue Assistant (Proof of Concept)

An AI assistant that helps USA Triathlon staff respond to emails in Salesforce queues, faster and
more consistently. It reads a Case's full email thread + attachments, pulls the sender's history, a
per-queue FAQ, and operator corrections, then drafts a reply — **or clearly says it doesn't have
enough information.** A human always reviews. **Nothing is ever sent to Salesforce** (read-only POC).

## Quick start

```
cd src/salesforce_email_queue_proof_of_concept
node menu.js
```

The menu (color-coded) gives you:

- **Tests** — run all suites (or individually); each prints its own header.
- **Salesforce (read-only)** — verify access, list queues, list case statuses.
- **AI assistant** — *Browse & assist*: pick a queue → status → email, view the color-coded thread,
  then **draft a reply**, **ask a question**, or add a **correction**. No record IDs needed.
- **Server & users** — start the web app, add/list logins.

Headless test run (e.g. CI): `node menu.js test`

## Web app

```
node ../../server_salesforce_email_queue_8019.js     # then open http://localhost:8019
```

Single page: queue/email list on the left, the email thread + attachments in the middle, and an AI
panel (suggested reply, ask-a-question, correction box, and a disabled "send" button) on the right.

Create a login first: set `.env` accounts (always valid, carry a role for future access control):
`SF_EMAIL_QUEUE_ADMIN_USER` / `SF_EMAIL_QUEUE_ADMIN_PASS` (admin) and/or `SF_EMAIL_QUEUE_USER` /
`SF_EMAIL_QUEUE_PASS` (user). You can also add stored users with `node src/admin.js add`.

## Configuration (repo-root `.env`)

- `SF_PROD_*` — Salesforce credentials (reads run as the integration user).
- `OPENAI_API_KEY` (default model `gpt-4o-mini`) and/or `ANTHROPIC_API_KEY` (Claude).
- Optional model overrides: `OPENAI_MODEL`, `ANTHROPIC_MODEL`.
- Web-app logins (`.env` accounts, always valid, each carries a role for future access control):
  - `SF_EMAIL_QUEUE_ADMIN_USER` / `SF_EMAIL_QUEUE_ADMIN_PASS` — role `admin`.
  - `SF_EMAIL_QUEUE_USER` / `SF_EMAIL_QUEUE_PASS` — role `user`.
  - (Stored, scrypt-hashed users can also be added with `node src/admin.js add`.)

## Attachment parsing (optional)

Text/CSV/HTML attachments work out of the box. For PDF/DOCX/XLSX, install the optional parsers:

```
npm install        # installs pdf-parse, mammoth, xlsx (optionalDependencies)
```

Without them, attachments show a labeled placeholder instead of extracted text.

## What it will NOT do (by design, this POC)

- It does not send replies or change Case status in Salesforce (read-only).
- It does not invent facts; if the answer needs a specific it can't find in context, it asks for it.
- It does not draft replies to automated bounces / no-reply senders (flags them for triage).

## More detail

See `CLAUDE.md` (architecture + conventions) and `plans_and_notes/` (requirements, MVP plan, full
roadmap with the native-Salesforce-vs-build comparison, and the build review guide).


## Adding your own context files (knowledge the AI reads)

Context lives **outside the repo** (so member data is never committed), resolved cross-platform via the
shared utility pattern (`data_dir.js` -> `utilities/determineOSPath()`), at
`<base>/usat_email_queue/context/` (e.g. `.../usat/data/usat_email_queue/context/` on linux/mac). Drop reference
files there and the assistant reads them as grounding:

- `<context>/_global/` - applied to EVERY queue
- `<context>/<queue_slug>/` - applied to that queue only (e.g. `coaching`, `event_services`, `rankings`)

Two ways to add context from the web app's **Context files** card (each file has **view** + an **exclude/include** toggle that keeps the file on disk but skips it for grounding):
1. **Add a file** - upload one file into the context folder.
2. **Choose a folder from your computer** - the browser reads a local folder (File System Access API;
   falls back to a folder picker on Safari/Firefox) and sends its files into the context store.

All knowledge (FAQ-style facts, policies, contacts, rosters) goes here for now - it is the single
grounding source. Overrides: `EQ_CONTEXT_DIR` (point at any local folder; uploads write there too) and
`EQ_DATA_DIR` (project data root). A SAMPLE file (`knowledge_SAMPLE.md`) is seeded into `_global` on
first run so grounding works out of the box; the server logs the folder path at startup.

Supported (text-extracted): `.md` `.txt` `.csv` `.tsv` `.html` `.json` `.xml` `.log` `.yaml`/`.yml` `.rtf`,
and (with optional parsers via `npm install`) `.pdf` `.docx` `.xlsx` `.xls`. **Images** are read by the AI via **vision**: `.png` `.jpg/.jpeg` `.gif` `.webp` in the context folder are
sent to the model as grounding (up to 4 images, <=4MB each). Other image types (`.bmp/.tif/.heic/.svg`)
and binaries are stored/listed but not sent. Total text context is capped (~20k chars) per request.

See what's currently loaded: `node src/cli.js context [queue]` (or menu -> View context files).
This is the single place to give the AI real USAT facts (policies, timelines, contacts) so it stops
guessing - alongside operator corrections.

## Web app features

Login (auth-gated) - 3 **resizable** panes:
- **Queue:** pick queue + status (with per-status counts + summary); numbered case list with checkboxes
  to tick off items, status / message-count / attachment chips.
- **Thread:** sticky header (case # + count); newest-first, each message **collapsible** (date + role);
  a "hide quoted/repeated text" toggle to cut clutter; attachments openable.
- **AI status (triage):** per-case badge (answer ready / draft possible / needs info / no action),
  shown in the thread header and on queue rows; an "AI triage visible" button tags the listed cases.
- **AI panel:** Draft reply (verdict + **editable** draft you can edit/compose and "Send" - mocked,
  returns the not-enabled message); Ask with **preset chips** + running **history**; **mock** case-status
  update (not connected); **context upload** (drop files the AI will read).

## Theme

The web app supports auto / light / dark, matching the transform app (USAT red accent, navy brand).
Use the "Theme:" button in the header (or on the login screen); the choice persists in your browser.

## Data handling, privacy & where context lives

- Dependencies (incl. optional parsers `pdf-parse`, `mammoth`, `xlsx`) live in the **repo-root**
  `package.json`; run `npm install` at the repo root. This folder has no `package.json` by design.
- **No sensitive data in the repo.** Logins (`auth.json`), operator `corrections.json`, and uploaded
  context all live OUTSIDE the repo via `data_dir.js` -> `utilities/determineOSPath()`
  (`<base>/usat_email_queue/`). There is no in-repo data folder. `corrections` is slated to move to a DB table (see `plans_and_notes/path_to_production.md`,
  Track C). Overrides: `EQ_DATA_DIR`, `EQ_CONTEXT_DIR`, `EQ_USERS_FILE`, `EQ_CORRECTIONS_FILE`.
- AI calls use your **commercial OpenAI/Anthropic API** keys: under those terms inputs/outputs are
  **not used for training** by default; retention is short (OpenAI ~30d, Anthropic ~7d) and can be
  **zero** with a Zero-Data-Retention (ZDR) agreement.
  - **Get ZDR:** request it from the vendor with a qualifying use case - OpenAI via your enterprise/
    account team (or platform data controls); Anthropic via Anthropic sales - alongside a signed DPA.
    Put DPA + ZDR in place before processing real member data.

## Tests

`node menu.js test` (or `node --test tests/*.test.js`) runs all suites - **40 tests across 8 files**:
unit (text/threads/extract/ai/faq+context/auth) p
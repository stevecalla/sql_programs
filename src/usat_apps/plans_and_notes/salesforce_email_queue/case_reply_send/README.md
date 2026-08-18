# Email Queue — Salesforce send/reply plans & assets

Plans, runbook, and the Apex source behind the Email Queue app's outbound send
(reply to a case → Salesforce delivers to the member + logs/threads it on the case).

## Contents
- `CaseReply_Production_Setup.md` — full production setup runbook (deploy Apex, verify
  org-wide addresses, wire the admin panel, test threading). Start here.
- `TODO.md` — short go-live checklist.
- `create_test_email.apex` — anonymous Apex to seed a test inbound email on a case
  (Workbench → utilities → Apex Execute, sandbox). Edit the variables at the top.
- `apex/` — the deployable Apex **source** (canonical copy):
  - `CaseReplyService.cls` (+ `-meta.xml`) — REST service at `/services/apexrest/caseReply`.
  - `CaseReplyServiceTest.cls` (+ `-meta.xml`) — test class (deploy coverage).
  - `package.xml` — deploy manifest (API v59.0).
- `CaseReplyService_prod_deploy.zip` — prebuilt Workbench deploy artifact.
  **Git-ignored** (repo ignores `*.zip`) — it's derived from `apex/`. Rebuild if the
  source changes: zip `package.xml` + `classes/` at the archive root with no directory
  entries (e.g. `zip -D -X`).

## Deploy (short version)
Workbench → migration → Deploy → upload the zip → Rollback On Error + Run Specified
Tests `CaseReplyServiceTest`. Full steps in the runbook.

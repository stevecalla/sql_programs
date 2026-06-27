# Deploying the Apex merge endpoint (ALTERNATIVE path)

Node SOAP merge is the primary path (see `../README_MERGE_EXECUTION.md`). Deploy this Apex only
if you want snapshot + merge to be atomic in one Salesforce transaction. Same files, same code
go to sandbox and production — the only difference is *how* they're added.

Files: `AccountMergeService.cls` (+ `.cls-meta.xml`) and `AccountMergeService_Test.cls`
(+ `.cls-meta.xml`). Salesforce requires the test class (≥75% coverage) to deploy.

## Sandbox (test) — you CAN create Apex directly here

Quick — Developer Console:
1. Log in to the sandbox (`https://test.salesforce.com`).
2. Gear → Developer Console → File → New → Apex Class → name `AccountMergeService` → paste the
   `.cls` body → save (Ctrl/Cmd-S).
3. Repeat for `AccountMergeService_Test`.
4. Test menu → New Run → select `AccountMergeService_Test` → Run; confirm it passes.

Repeatable — Salesforce CLI (recommended; same as CI):
1. Place the four files under `force-app/main/default/classes/`.
2. `sf org login web --alias sbx --instance-url https://test.salesforce.com`
3. `sf project deploy start --source-dir force-app --target-org sbx --test-level RunSpecifiedTests --tests AccountMergeService_Test`

## Production — you CANNOT hand-edit Apex; you must DEPLOY (tests run automatically)

Change Set (no CLI):
1. In the sandbox: Setup → Outbound Change Sets → New → add both Apex classes → Upload to production.
2. In production: Setup → Inbound Change Sets → select it → Validate (runs tests) → Deploy.

Salesforce CLI (recommended / CI):
1. `sf org login web --alias prod`   (uses `https://login.salesforce.com`)
2. Validate first: `sf project deploy start --source-dir force-app --target-org prod --test-level RunLocalTests --dry-run`
3. Deploy: `sf project deploy start --source-dir force-app --target-org prod --test-level RunLocalTests`

Production requires `RunLocalTests` (or `RunSpecifiedTests`) with all tests passing and ≥75%
org-wide coverage.

## After deploy (both environments) — turn it on

1. Grant the integration user access: Setup → Permission Sets (or the user's Profile) →
   Apex Class Access → add `AccountMergeService`. Without this, calls return HTTP 403. The user
   also needs "API Enabled".
2. Endpoint URL: `https://<your-instance>/services/apexrest/accountMerge`
3. Call it from Node with the session/OAuth token:
   `POST /services/apexrest/accountMerge`  body `{ "masterId": "001…", "loserIds": ["001…"] }`

## Notes

- `without sharing` lets the admin tool merge regardless of record-level sharing — a deliberate
  security choice; review before production.
- The test uses standard business accounts so it runs in any org; verify Person-Account merge
  behavior by hand in the sandbox.
- Recommended deploy folder layout for the CLI path:
  `force-app/main/default/classes/AccountMergeService.cls` (+ meta) and the test class (+ meta).

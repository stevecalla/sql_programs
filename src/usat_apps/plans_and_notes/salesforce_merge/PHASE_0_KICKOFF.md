# Merge tool — Phase 0 kickoff (what I need from you)

Next step is **Phase 0: the read-only foundation scaffold** (Express server + Vite/React shell +
a Dashboard reading the existing `salesforce_duplicate_*` MySQL tables). It's read-only — no
Salesforce calls, no writes, no Connected App needed. Answer the items below and I can build it.

## To START Phase 0 (the only blockers)

1. **Add React + Vite to the repo?** This is the first React app in the repo, by decision. OK to
   add the npm dependencies and a `web/` build step? (y/n)
2. **Reuse the email-queue's auth + local DB?** OK to copy the `auth/session` signed-cookie
   pattern from `src/salesforce_email_queue_proof_of_concept/auth`, and use the existing
   `LOCAL_MYSQL_*` `.env` connection that already reaches `usat_sales_db`? (y/n)
3. **Port / name** `server_salesforce_merge_8020.js` on port **8020** — good, or pick another?
4. **Login users** for the tool's own admin login — reuse the same pattern as the proxy/email-queue
   (`.env` admin user/pass)? If so, what env var names do you want (e.g. `MERGE_ADMIN_USER` /
   `MERGE_ADMIN_PASS`)?

## To GATHER for later phases (not needed for Phase 0 — drop whenever)

5. **Salesforce sandbox read access** — confirm the existing `SF_DEV_*` creds work and the
   integration user can read `Account` + its child objects. (Phase 2)
6. **Confirm the merge-id rule** — that `usat_Salesforce_Merge_Id__pc` holds the **surviving
   Account Id** (so winner = `Id == merge_id`). A few sample records would confirm it. (Phase 2/3)
7. **High-value flag API names** — the donor flag (and any others: major member, board, …) field
   API names on Account, used to gate Contact-Point preservation. (Phase 3/4)
8. **Decisions still open:**
   - Restore default when **no** high-value flag matches: discard loser-only contact values, or
     always preserve? 
   - Person Accounts only, or other objects too?
9. **Child objects of Account** — I can auto-discover via `describe` once SF read access is
   confirmed, but a list of known custom child objects helps validate the snapshot/restore. (Phase 3)
10. **Production / Connected App** — not needed until we go to prod; we'll set up the Connected
    App (OAuth JWT, least-privilege write user) before any production write. (Phase 5)

## What you'll have after Phase 0

A running app at `localhost:8020` that looks like the email-queue (nav, env switch, auth, the
`/metrics` and `/admin` shells) but in React, with a working **Dashboard** showing real counts
from your existing duplicate tables — and zero ability to change anything in Salesforce.

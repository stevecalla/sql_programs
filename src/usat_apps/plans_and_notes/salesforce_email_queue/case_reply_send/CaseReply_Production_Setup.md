# Case Reply (Apex) — Production Setup Runbook

Goal: make the Email Queue app able to send case replies in PRODUCTION exactly like we
proved out in sandbox — delivered to the member, logged on the case, threaded, and sent
FROM the queue's org-wide address (e.g. teamusa@usatriathlon.org).

There are two independent pieces:
  A. Deploy the Apex class  -> you can do this yourself via Workbench.
  B. Set up the Org-Wide Email Address + a couple of org settings -> needs a Salesforce ADMIN.

Do A and B in either order. The app won't send from teamusa@ until BOTH are done.

===============================================================================
PART A — DEPLOY THE APEX CLASS TO PRODUCTION (Workbench)   [you can do this]
===============================================================================

What it is: a small Apex REST service, CaseReplyService, that the app calls at
/services/apexrest/caseReply. It sends the reply, relates it to the Case (so it threads
and logs), and can send from a verified org-wide address. Same class we deployed to sandbox.

You need: the file  CaseReplyService_prod_deploy.zip  (delivered with this runbook).
It contains package.xml + the two classes (CaseReplyService, CaseReplyServiceTest), API v59.

Steps:
  1. Go to  https://workbench.developerforce.com
  2. Environment = "Production", tick "I agree to the terms", Login with the PRODUCTION org.
       (Log in with the same production Salesforce account you normally use.)
  3. Top menu:  migration  ->  Deploy
  4. Click "Choose File" and select  CaseReplyService_prod_deploy.zip
  5. Tick these two checkboxes:
       [x] Rollback On Error
       [x] Run Tests:  choose "Run Specified Tests"  and enter:   CaseReplyServiceTest
       (If your production org requires it, "Run Local Tests" also works — it just runs more.)
  6. Leave everything else default. Click "Next", then "Deploy".
  7. Wait for the result. You want:  "Deploy Complete" / status Succeeded, tests passed.

If it says "0 components deployed" or a package/path error:
  - The zip must have package.xml and the classes/ folder at the ROOT of the zip, with NO
    extra top-level folder and no directory entries. The provided zip is already built this
    way — just re-download and re-upload it; don't rezip it yourself.

How to confirm it deployed:
  - Setup -> search "Apex Classes" -> you should see CaseReplyService and CaseReplyServiceTest.
  - (Optional) Workbench -> utilities -> REST Explorer -> GET is not needed; the app will POST.

Note on permissions: deploying via Workbench uses your user's Metadata API access. If your
user can deploy, you don't need the full admin role for THIS step. You DO need admin for Part B.

===============================================================================
PART B — ORG-WIDE EMAIL ADDRESS + ORG SETTINGS   [needs a Salesforce ADMIN]
===============================================================================

Hand this section to whoever has Salesforce admin in PRODUCTION. Three things:

--- B1. Create + verify the Org-Wide Email Address (the "From") -------------------
  1. Setup -> search "Organization-Wide Addresses" -> open it.
  2. Click "New" (or edit teamusa@ if it already exists).
  3. Fill in:
       Display Name:   Team USA
       Email Address:  teamusa@usatriathlon.org
       Purpose:        User Selection            <- important; NOT "Default No-Reply"
       Access:         (o) Allow All Profiles to Use this From Address
  4. Save. Salesforce emails a VERIFICATION link to teamusa@usatriathlon.org.
  5. IMPORTANT: teamusa@ is an Email-to-Case routing address, so that verification email
     will land as a Case/email in Salesforce (or in whatever inbox backs teamusa@). Find it
     and click the "click this link to verify" URL. The address flips to Verified.
       - Until it shows Verified, sends from teamusa@ will fail with
         "Org-Wide Email provided is not valid" and fall back to the running user.
  6. Repeat B1 for any OTHER queue you want to send from (coaching@, clubs@, etc.) —
     one Org-Wide Email Address per address, each verified.

--- B2. Email Deliverability (only if sends are blocked) --------------------------
  Setup -> search "Deliverability" -> "Email Deliverability".
    - "Access to Send Email" should be:  All email.
    - Production is normally already "All email"; if it's "System email only", Apex sends
      throw NO_SINGLE_MAIL_PERMISSION. (This is the setting that bit us in sandbox.)

--- B3. Domain sending (usually already fine in production) -----------------------
  Salesforce only sends from verified domains. usatriathlon.org is your live mail domain, so
  it's normally already verified (DKIM). If a first real send bounces for domain reasons,
  check Setup -> "Email" -> DKIM Keys / domain verification. No action expected here.

===============================================================================
PART C — POINT THE APP AT PRODUCTION AND WIRE THE DEFAULTS
===============================================================================
  In the Email Queue app (Admin -> Settings):
  1. Salesforce environment -> Production (live). Save, then reload the app.
       (We were on Sandbox for testing. This switches reads/sends to the prod org.)
  2. Email sending (master switch) -> turn ON when you're ready to let operators send.
       (Leave OFF until Parts A + B are confirmed.)
  3. Per-queue "From" -> for "Team USA", pick  teamusa@usatriathlon.org  from the dropdown.
       (Only VERIFIED org-wide addresses appear here — if teamusa@ isn't listed yet, B1 isn't
        finished. Map the other queues the same way.)
  4. Send method: the app already defaults to "Apex case-reply". Leave it. Direct send stays
     available but can't use an org-wide address, so it's not for customer replies.

===============================================================================
PART D — VERIFY (the round-trip test)
===============================================================================
  1. Open a real Team USA case in the app (Production).
  2. Draft a short reply. From = "Queue default" (resolves to teamusa@). Method = Apex.
  3. Send. Expect: "Sent - Logged on the case. [via Apex case-reply]" and the new message
     shows in the thread with From = teamusa@usatriathlon.org.
  4. From the recipient's inbox, REPLY to that email.
  5. Confirm the reply comes back onto the SAME case (as a new inbound message), not a new
     case. That confirms full threading end-to-end. Done.

If step 3 falls back to your SF user instead of teamusa@:
  - teamusa@ isn't Verified yet (finish B1), OR
  - you used Direct send instead of Apex (switch Send method to Apex).

===============================================================================
PART E — WHY SANDBOX CAN'T TEST REPLY-THREADING (and how to test it anyway)
===============================================================================
If you send a test reply from SANDBOX and then reply to it from your own inbox, the reply
will land in PRODUCTION as a NEW case — not back on the sandbox case. That is EXPECTED and is
not a failure of this setup. Reasons:

  - The reply's To/Reply-To is teamusa@usatriathlon.org, a REAL production mailbox. Sandbox
    does not receive mail sent to the real teamusa@ inbox — only production does. So the reply
    physically leaves the sandbox's world and goes to prod.
  - Even once in prod, the original case lives in SANDBOX and doesn't exist in prod, so prod
    can't match the thread and opens a new case. (Sandbox also prefixes outbound subjects with
    "Sandbox:", another sign the mail crossed orgs.)

So: the outbound half (send-as-teamusa@ + log on case via Apex) is fully proven in sandbox.
The reply-threading half can only be validated ENTIRELY WITHIN ONE org.

Option 1 (recommended): test reply-threading in PRODUCTION after teamusa@ is verified there
(Part D). Send from a real Team USA case, reply from your inbox, confirm it threads back.

Option 2 (NOT recommended — here only for completeness): a sandbox-only test via the sandbox's
own Email Services Address. In practice this org's sandbox routing addresses have NO Email
Services Address generated (the column is blank), so there's no clean sandbox target to reply
to, and it isn't worth the fuss. Prefer Option 1.

*** DO NOT change anything on the sandbox Email-to-Case setup page. ***
  - The routing addresses shown there (clubs@, coaching@, teamusa@, ... all "Verified") are
    just the PRODUCTION routes copied in when the sandbox was refreshed. They're inherited.
  - Enabling/toggling the on-demand service or routes in sandbox does NOT make the sandbox
    ingest real customer email: the real @usatriathlon.org mailboxes forward to PRODUCTION's
    Email Services Address, not the sandbox's. Sandbox can't intercept live mail and can't
    affect production's email flow. So there's nothing to gain by touching it — leave it as-is.
  - Reply-threading is inherently a production behavior (real mailboxes + real routing).
    Treat the threading test as PRODUCTION-ONLY (Option 1).

Sandbox caution that DOES apply (unrelated to the E2C page): Deliverability is set to "All
email", so any test send reaches a real inbox. Send tests only to your own address; never
draft to a real member from sandbox.

If a reply opens a NEW case even within production, check Setup -> Email-to-Case threading
settings (modern orgs thread on message headers; older orgs rely on the "Ref ID" token that
must stay in the subject/body of the reply).

===============================================================================
APPENDIX — the Apex class (for reference; you don't need to paste this if you deploy the zip)
===============================================================================
Endpoint:  POST /services/apexrest/caseReply
Body:      { "caseId": "...", "toAddress": "...", "subject": "RE: ...",
             "body": "...", "orgWideEmailAddressId": "(optional 18-char OWEA id)" }

CaseReplyService.cls:
-------------------------------------------------------------------------------
@RestResource(urlMapping='/caseReply/*')
global with sharing class CaseReplyService {

    global class ReplyRequest {
        public Id caseId;
        public String toAddress;
        public String subject;
        public String body;
        public Id orgWideEmailAddressId;
    }
    global class ReplyResult {
        public Boolean success;
        public String error;
    }

    @HttpPost
    global static ReplyResult doPost() {
        ReplyResult res = new ReplyResult();
        try {
            ReplyRequest r = (ReplyRequest) JSON.deserialize(
                RestContext.request.requestBody.toString(), ReplyRequest.class);

            Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();
            mail.setToAddresses(new List<String>{ r.toAddress });
            mail.setSubject(r.subject);
            mail.setPlainTextBody(r.body);
            mail.setWhatId(r.caseId);        // relate to the Case -> threads + logs EmailMessage
            mail.setSaveAsActivity(true);
            if (r.orgWideEmailAddressId != null) {
                mail.setOrgWideEmailAddressId(r.orgWideEmailAddressId);
            }

            Messaging.SendEmailResult[] sr =
                Messaging.sendEmail(new List<Messaging.SingleEmailMessage>{ mail });

            if (sr[0].isSuccess()) {
                res.success = true;
            } else {
                res.success = false;
                res.error = sr[0].getErrors()[0].getMessage();
            }
        } catch (Exception e) {
            res.success = false;
            res.error = e.getMessage();
        }
        return res;
    }
}
-------------------------------------------------------------------------------
(The test class CaseReplyServiceTest is included in the zip and is what satisfies the
production code-coverage requirement during deploy.)

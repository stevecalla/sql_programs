// ============================================================================
// Create a TEST inbound email -> Case
// Run in Workbench: utilities -> Apex Execute  (logged into the SANDBOX)
// Makes a Case owned by the queue + an INBOUND EmailMessage on it, so it shows
// up in the Email Queue app and can be replied to. Nothing is emailed out.
// ============================================================================

String queueName   = 'Team USA';                   // Case queue that should own the case
String fromAddress = 'test@example.com';      // the "member" (use your own inbox for testing)
String toAddress   = 'teamusa@usatriathlon.org';   // the routing address for that queue
String subject     = '[TEST] Sandbox test email';
String body        = 'This is a test inbound email for the Email Queue app.';

Group q = [SELECT Id FROM Group WHERE Type = 'Queue' AND Name = :queueName LIMIT 1];

Case c = new Case(Subject = subject, Status = 'New', Origin = 'Email',
                  OwnerId = q.Id, SuppliedEmail = fromAddress);
insert c;

EmailMessage em = new EmailMessage(
    ParentId    = c.Id,
    Incoming    = true,          // inbound (from the member)
    Status      = '0',           // 0 = New
    Subject     = subject,
    TextBody    = body,
    FromAddress = fromAddress,
    ToAddress   = toAddress,
    MessageDate = System.now()
);
insert em;

System.debug('Created Case ' + c.Id + ' (' + c.CaseNumber + ') / EmailMessage ' + em.Id);


// ---------------------------------------------------------------------------
// VARIANT: add another inbound email to an EXISTING case (e.g. simulate a member
// replying). Comment out the block above and use this instead — set the CaseNumber.
// ---------------------------------------------------------------------------
// Case c = [SELECT Id FROM Case WHERE CaseNumber = '00041373' LIMIT 1];
// insert new EmailMessage(
//     ParentId = c.Id, Incoming = true, Status = '0',
//     Subject = 'RE: [TEST] Sandbox test email',
//     TextBody = 'Another inbound test message.',
//     FromAddress = 'test@example.com',
//     ToAddress = 'teamusa@usatriathlon.org',
//     MessageDate = System.now()
// );

// EmailMessage.Status codes: 0=New, 1=Read, 2=Replied, 3=Sent, 4=Forwarded, 5=Draft
// OwnerId must be a real Case queue. This is anonymous Apex — nothing to deploy.

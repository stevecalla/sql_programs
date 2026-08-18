# Email Queue — Go-Live Reminder

- [ ] Deploy Apex to production — Workbench → Deploy → CaseReplyService_prod_deploy.zip, run test CaseReplyServiceTest
- [ ] Smoke-test it — send a reply from a prod case (Apex method) to your own email; confirm delivered + logged on the case
- [ ] Create + verify Org-Wide Email Addresses (admin) — teamusa@ first, then coaching@, clubs@, etc.; click the verify link (arrives as a case)
- [ ] Confirm Deliverability = "All email" in production
- [ ] Deploy the updated app so operators get the new cards
- [ ] Set the admin panel — switch env to Production, map each queue → its From address, turn the master send switch ON
- [ ] Production round-trip test — reply from your inbox; confirm it threads back onto the same case
- [ ] Close the stray test case the earlier Gmail reply created in the prod queue

(Full details: CaseReply_Production_Setup.md)

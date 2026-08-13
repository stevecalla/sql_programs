@RestResource(urlMapping='/caseReply/*')
global with sharing class CaseReplyService {

    global class ReplyRequest {
        public Id caseId;                 // the Case to reply on
        public String toAddress;          // recipient
        public String subject;            // e.g. "RE: ..."
        public String body;               // plain-text reply
        public Id orgWideEmailAddressId;  // optional: verified OWEA to send "from"
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
            mail.setWhatId(r.caseId);          // relate to the Case -> threads + logs an EmailMessage (Enhanced Email)
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

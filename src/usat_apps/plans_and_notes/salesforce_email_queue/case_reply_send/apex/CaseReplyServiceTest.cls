@IsTest
private class CaseReplyServiceTest {
    @IsTest static void testReply() {
        Case c = new Case(Subject = 'Test', Status = 'New', Origin = 'Email');
        insert c;

        Map<String, Object> payload = new Map<String, Object>{
            'caseId'    => c.Id,
            'toAddress' => 'test@example.com',
            'subject'   => 'RE: Test',
            'body'      => 'Hello from the test.'
        };

        RestRequest req = new RestRequest();
        req.requestUri  = '/services/apexrest/caseReply';
        req.httpMethod  = 'POST';
        req.requestBody = Blob.valueOf(JSON.serialize(payload));
        RestContext.request  = req;
        RestContext.response = new RestResponse();

        Test.startTest();
        CaseReplyService.ReplyResult res = CaseReplyService.doPost();
        Test.stopTest();

        System.assertNotEquals(null, res, 'Should return a result');
    }
}

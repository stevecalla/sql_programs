@IsTest
private class AccountMergeService_Test {

    @IsTest static void merges_loser_into_master() {
        Account master = new Account(Name = 'Master');
        Account loser  = new Account(Name = 'Loser');
        insert new List<Account>{ master, loser };

        AccountMergeService.MergeRequest body = new AccountMergeService.MergeRequest();
        body.masterId = master.Id;
        body.loserIds = new List<Id>{ loser.Id };

        RestContext.request = new RestRequest();
        RestContext.request.requestBody = Blob.valueOf(JSON.serialize(body));
        RestContext.response = new RestResponse();

        Test.startTest();
        String out = AccountMergeService.doMerge();
        Test.stopTest();

        System.assert(out.contains('"success":true'), out);
        System.assertEquals(0, [SELECT COUNT() FROM Account WHERE Id = :loser.Id]);
    }

    @IsTest static void rejects_missing_master() {
        RestContext.request = new RestRequest();
        RestContext.request.requestBody = Blob.valueOf('{"loserIds":[]}');
        RestContext.response = new RestResponse();

        Test.startTest();
        String out = AccountMergeService.doMerge();
        Test.stopTest();

        System.assert(out.contains('"success":false'), out);
    }
}

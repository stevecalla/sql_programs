@RestResource(urlMapping='/accountMerge/*')
global without sharing class AccountMergeService {

    global class MergeRequest {
        global Id masterId;
        global List<Id> loserIds;                  // up to 2 per call
        global Map<String,String> fieldOverrides;  // optional: field API name -> winning value
    }

    @HttpPost
    global static String doMerge() {
        RestContext.response.addHeader('Content-Type', 'application/json');

        MergeRequest req;
        try {
            req = (MergeRequest) JSON.deserialize(
                RestContext.request.requestBody.toString(), MergeRequest.class);
        } catch (Exception e) {
            RestContext.response.statusCode = 400;
            return JSON.serialize(new Map<String,Object>{ 'success' => false, 'error' => 'bad JSON: ' + e.getMessage() });
        }

        if (req == null || req.masterId == null || req.loserIds == null || req.loserIds.isEmpty()) {
            RestContext.response.statusCode = 400;
            return JSON.serialize(new Map<String,Object>{ 'success' => false, 'error' => 'masterId and loserIds are required' });
        }
        if (req.loserIds.size() > 2) {
            RestContext.response.statusCode = 400;
            return JSON.serialize(new Map<String,Object>{ 'success' => false, 'error' => 'merge supports at most 2 losers per call' });
        }

        Account master = [SELECT Id FROM Account WHERE Id = :req.masterId LIMIT 1];
        if (req.fieldOverrides != null) {
            for (String f : req.fieldOverrides.keySet()) {
                master.put(f, req.fieldOverrides.get(f));
            }
        }

        List<Account> losers = [SELECT Id FROM Account WHERE Id IN :req.loserIds];

        try {
            List<Database.MergeResult> results = Database.merge(master, losers, false);
            return JSON.serialize(new Map<String,Object>{
                'success'  => true,
                'masterId' => master.Id,
                'results'  => results
            });
        } catch (Exception e) {
            RestContext.response.statusCode = 500;
            return JSON.serialize(new Map<String,Object>{ 'success' => false, 'error' => e.getMessage() });
        }
    }
}

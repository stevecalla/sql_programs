const { query_member_data } = require('../google_cloud/queries/query_member_data');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

const { members_schema } = require('../google_cloud/schemas/schema_member_data');

// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_sales_key_metrics() {
    const options = [
        {
            fileName: 'member_data',
            query: query_member_data,
            tableId: "membership_data", // table name
        }
    ];

    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = members_schema;

    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema);

    return;
}

// execute_load_big_query_database();

module.exports = {
    execute_load_big_query_sales_key_metrics,
}
const { query_sales_year_over_year_data } = require('../google_cloud/queries/query_sales_year_over_year_data');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

const { members_sales_year_over_year_schema } = require('../google_cloud/schemas/schema_sales_year_over_year_data');

// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_sales_year_over_year_metrics() {
    const options = [
        {
            fileName: 'sales_year_over_year_data',
            query: query_sales_year_over_year_data,
            tableId: "sales_year_over_year_data", // table name
        }
    ];

    const directoryName = `usat_google_bigquery_data`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = members_sales_year_over_year_schema;

    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    return;
}

// execute_load_big_query_sales_year_over_year_metrics();

module.exports = {
    execute_load_big_query_sales_year_over_year_metrics,
}
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { query_sales_year_over_year_data } = require('../google_cloud/queries/query_sales_year_over_year_data');
const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');
const { members_sales_year_over_year_schema } = require('../google_cloud/schemas/schema_sales_year_over_year_data');

// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_sales_year_over_year_metrics() {

    const table_name_2025 = "sales_data_year_over_year";
    const table_name_2026 = "sales_data_year_over_year_2026";

    const options = [
        {
            fileName: 'sales_year_over_year_data',
            query: (retrieval_batch_size, offset) => query_sales_year_over_year_data(retrieval_batch_size, offset, table_name_2025),
            tableId: "sales_year_over_year_data", // table name
        },
        {
            fileName: 'sales_year_over_year_2026_data',
            query: (retrieval_batch_size, offset) => query_sales_year_over_year_data(retrieval_batch_size, offset, table_name_2026),
            tableId: "sales_year_over_year_2026_data", // table name
        }
    ];

    for (let i = 0; i < options.length; i++) {

        const directoryName = `usat_bigquery_${options[i].fileName}`;
        const datasetId = "membership_reporting"; // database name
        const bucketName = 'membership-reporting';
        const schema = members_sales_year_over_year_schema;
        
        // ✅ exactly one option, as the loader expects as array
        const option_as_array = [options[i]];

        await execute_load_data_to_bigquery(option_as_array, datasetId, bucketName, schema, directoryName);
    }

    return true;
}

// execute_load_big_query_sales_year_over_year_metrics();

module.exports = {
    execute_load_big_query_sales_year_over_year_metrics,
}
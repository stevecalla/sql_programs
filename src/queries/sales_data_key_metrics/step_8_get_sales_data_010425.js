const { step_8_sales_key_stats_2015_query } = require('./step_8a_get_sales_data_082925_query');
const { step_8a_sales_key_stats_2015_upsert } = require('./step_8a_get_sales_data_082925_upsert');

async function step_8_sales_key_stats_2015(FROM_STATEMENT, pool, update_mode, options) {

    const query = `
        DROP TABLE IF EXISTS ${options.TARGET_TABLE_NAME};

            CREATE TABLE ${options.TARGET_TABLE_NAME} AS
                ${await step_8_sales_key_stats_2015_query(FROM_STATEMENT)}
            ;
        `
    ;
    return query;
}

async function step_8_sales_key_stats_2015_upsert(FROM_STATEMENT, pool, update_mode, options) {

    const query = await step_8a_sales_key_stats_2015_upsert(FROM_STATEMENT, pool, update_mode, options);

    return query;
}

module.exports = {
    step_8_sales_key_stats_2015,
    step_8_sales_key_stats_2015_upsert,
}
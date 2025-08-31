const { step_8_sales_key_stats_2015_query } = require('./step_8a_get_sales_data_082925_query');
const { step_8a_sales_key_stats_2015_upsert } = require('./step_8a_get_sales_data_082925_upsert');

const TABLE_NAME = `sales_key_stats_2015_test`;
const WHERE_STATEMENT = `WHERE 1 = 0`;

async function step_8_sales_key_stats_2015_test(FROM_STATEMENT) {
    const query = `

        -- Drop current table (if any)
        DROP TABLE IF EXISTS ${TABLE_NAME};

        -- Compute fixed timestamps once
        SET @now_utc := NOW();
        SET @dt_mtn  := DATE_FORMAT(DATE_ADD(@now_utc, INTERVAL -6 HOUR), '%Y-%m-%d');
        SET @dt_utc  := DATE_FORMAT(@now_utc, '%Y-%m-%d');

        -- Create table structure by selecting 0 rows (captures all columns & types)
        CREATE TABLE ${TABLE_NAME}
            ENGINE=InnoDB
            AS
            -- SELECT

            ${await step_8_sales_key_stats_2015_query(FROM_STATEMENT, WHERE_STATEMENT)}

            -- WHERE 1=0
        ;

        -- Add NOT NULL + PK (cheap now because the table is empty)
        ALTER TABLE ${TABLE_NAME}
            MODIFY id_profiles BIGINT NOT NULL,
            MODIFY id_membership_periods_sa BIGINT NOT NULL,
            ADD PRIMARY KEY (id_profiles, id_membership_periods_sa);
        `
    ;

    return query;
}

module.exports = {
    step_8_sales_key_stats_2015_test,
}
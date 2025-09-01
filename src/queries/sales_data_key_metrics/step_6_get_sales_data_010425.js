// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_6_membership_period_stats(FROM_STATEMENT) {
    return `
        -- STEP #6 = CREATE MEMBERSHIP PERIOD STATS TABLE 
        DROP TABLE IF EXISTS step_6_membership_period_stats;

            CREATE TABLE step_6_membership_period_stats AS
                SELECT
                    id_membership_periods_sa,
                    actual_membership_fee_6_rule_sa,
                        
                    COUNT(id_membership_periods_sa) AS sales_units,
                    SUM(actual_membership_fee_6_sa) AS sales_revenue

                --  FROM all_membership_sales_data_2015_left
                ${FROM_STATEMENT}
                
                GROUP BY id_membership_periods_sa, actual_membership_fee_6_rule_sa
            ;
        
        ALTER TABLE step_6_membership_period_stats              
            ADD INDEX (id_membership_periods_sa);
        -- *********************************************
    `;
}

function step_6_membership_period_stats_query(FROM_STATEMENT, WHERE_STATEMENT = '', ORDER_BY_STATEMENT = '') {
    return `
        -- STEP #6 = CREATE TABLE step_6_membership_period_stats AS
        SELECT
            am.id_membership_periods_sa,
            am.actual_membership_fee_6_rule_sa,
                
            COUNT(am.id_membership_periods_sa) AS sales_units,
            SUM(am.actual_membership_fee_6_sa) AS sales_revenue

        --  FROM all_membership_sales_data_2015_left
        ${FROM_STATEMENT} AS am
        ${WHERE_STATEMENT}
        GROUP BY am.id_membership_periods_sa, am.actual_membership_fee_6_rule_sa
        ${ORDER_BY_STATEMENT}
        ;
    `;
}

module.exports = {
    step_6_membership_period_stats,
    step_6_membership_period_stats_query,
}
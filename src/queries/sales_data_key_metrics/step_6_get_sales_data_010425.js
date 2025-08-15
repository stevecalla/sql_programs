// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_6_membership_period_stats() {
    return `
        -- STEP #6 = CREATE MEMBERSHIP PERIOD STATS TABLE -- TODO: 
        DROP TABLE IF EXISTS step_6_membership_period_stats;

        CREATE TABLE step_6_membership_period_stats AS
            SELECT
                id_membership_periods_sa,
                actual_membership_fee_6_rule_sa,
                    
                COUNT(id_membership_periods_sa) AS sales_units,
                SUM(actual_membership_fee_6_sa) AS sales_revenue

            FROM all_membership_sales_data_2015_left
            GROUP BY id_membership_periods_sa, actual_membership_fee_6_rule_sa
        ;
        
        ALTER TABLE step_6_membership_period_stats              
            ADD INDEX (id_membership_periods_sa);
        -- *********************************************
    `;
}

module.exports = {
    step_6_membership_period_stats,
}
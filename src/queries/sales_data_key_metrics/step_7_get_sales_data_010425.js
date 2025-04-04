// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_7_prior_purchase() {
    return `
        -- STEP #7 = MOST RECENT PRIOR PURCHASE TO DETERMINE NEW, LAPSED, RENEW -- TODO: done 10 min
        DROP TABLE IF EXISTS step_7_prior_purchase;

            CREATE TABLE step_7_prior_purchase AS
                SELECT 
                    am1.member_number_members_sa AS member_number_members_sa,
                    am1.id_membership_periods_sa,
                    am1.new_member_category_6_sa,
                    am1.purchased_on_adjusted_mp AS most_recent_purchase_date,
                    am1.ends_mp AS most_recent_mp_ends_date,
                    (
                        SELECT 
                            MAX(am2.purchased_on_adjusted_mp)
                        FROM all_membership_sales_data_2015_left am2
                        WHERE 
                            am2.member_number_members_sa = am1.member_number_members_sa
                            AND DATE(am2.purchased_on_adjusted_mp) = DATE(am1.purchased_on_adjusted_mp) 
                            -- AND am2.member_number_members_sa IN ('1001416', '100181772', '100142051', '100853852') 
                        LIMIT 1
                    ) AS most_recent_prior_purchase_date,
                    (
                        SELECT 
                            MAX(am2.ends_mp)
                        FROM all_membership_sales_data_2015_left am2
                        WHERE 
                            am2.member_number_members_sa = am1.member_number_members_sa
                            AND DATE(am2.ends_mp) = DATE(am1.ends_mp) 
                            -- AND am2.member_number_members_sa IN ('1001416', '100181772', '100142051', '100853852') 
                        LIMIT 1
                    ) AS most_recent_prior_mp_ends_date,
                    (
                        SELECT 
                            am2.real_membership_types_sa
                        FROM all_membership_sales_data_2015_left am2
                        WHERE 
                            am2.member_number_members_sa = am1.member_number_members_sa
                            AND DATE(am2.purchased_on_adjusted_mp) = DATE(am1.purchased_on_adjusted_mp) 
                            -- AND am2.member_number_members_sa IN ('1001416', '100181772', '100142051', '100853852') 
                        ORDER BY am2.purchased_on_adjusted_mp DESC
                        LIMIT 1
                    ) AS most_recent_prior_purchase_membership_type,
                    (
                        SELECT 
                            am2.new_member_category_6_sa
                        FROM all_membership_sales_data_2015_left am2
                        WHERE 
                            am2.member_number_members_sa = am1.member_number_members_sa
                            AND DATE(am2.purchased_on_adjusted_mp) = DATE(am1.purchased_on_adjusted_mp) 
                            -- AND am2.member_number_members_sa IN ('1001416', '100181772', '100142051', '100853852') 
                        ORDER BY am2.purchased_on_adjusted_mp DESC
                        LIMIT 1
                    ) AS most_recent_prior_purchase_membership_category

                FROM all_membership_sales_data_2015_left am1
                -- WHERE member_number_members_sa IN ('1001416', '100181772', '100142051', '100853852') 
                -- LIMIT 100
                ;

            -- CREATE INDEX idx_member_number_members_sa ON step_7_prior_purchase (member_number_members_sa);
            -- CREATE INDEX idx_most_recent_purchase_date ON step_7_prior_purchase (most_recent_purchase_date);
            -- CREATE INDEX idx_most_recent_prior_purchase_date ON step_7_prior_purchase (most_recent_prior_purchase_date);
            -- CREATE INDEX idx_most_recent_prior_purchase_membership_type ON step_7_prior_purchase (most_recent_prior_purchase_membership_type);
            -- CREATE INDEX idx_most_recent_prior_purchase_membership_category ON step_7_prior_purchase (most_recent_prior_purchase_membership_category);
        -- *********************************************
    `;
}

module.exports = {
    step_7_prior_purchase,
}
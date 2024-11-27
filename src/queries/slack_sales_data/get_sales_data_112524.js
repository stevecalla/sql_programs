function query_slack_sales_data() {
    return `
        SELECT 
            DATE_FORMAT(sd.purchased_on_date_adjusted_mp, '%Y-%m-%d') AS purchased_on_date_adjusted_mp_mtn,
            
            -- ORIGIN FLAG LOGIC
            CASE
                WHEN sd.origin_flag_ma IS NULL THEN 'Direct'
                WHEN sd.origin_flag_ma IN ('SUBSCRIPTION_RENEWAL') THEN 'Sub'
                WHEN sd.origin_flag_ma IN ('ADMIN_BULK_UPLOADER') THEN 'Bulk'
                WHEN sd.origin_flag_ma IN ('AUDIT_API') THEN 'Audit'
                WHEN sd.origin_flag_ma IN ('RTAV_CLASSIC') THEN 'RTAV'
                ELSE 'Other'
            END AS origin_flag_category,
            
            -- MEMBERSHIP TYPE
            CASE
                WHEN sd.real_membership_types_sa IN ('adult_annual') THEN 'Adult'
                WHEN sd.real_membership_types_sa IN ('one_day') THEN 'One_Day'
                WHEN sd.real_membership_types_sa IN ('youth_annual') THEN 'Youth'
                WHEN sd.real_membership_types_sa IN ('elite') THEN 'Elite'
                ELSE "Other"
            END AS real_membership_type,

            -- MEMBERSHIP CATEGORY
            CASE
                WHEN sd.new_member_category_6_sa LIKE ('%Bronze%') THEN 'Bronze'
                WHEN sd.new_member_category_6_sa IN ('Gold') THEN 'Gold'
                WHEN sd.new_member_category_6_sa IN ('Silver') THEN 'Silver'
                WHEN sd.new_member_category_6_sa IN ('3-Year') THEN '3-Year'
                ELSE "Other"
            END AS new_membership_type,

            CAST(COUNT(sd.id_membership_periods_sa) AS UNSIGNED) AS count_units,

            DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS queried_at_mtn,
            
            -- Max created_on for all records (without per-grouping)
            (SELECT DATE_FORMAT(MAX(purchased_on_adjusted_mp), '%Y-%m-%d %H:%i:%s') 
                FROM slack_membership_sales_data) AS max_created_on_mtn

        FROM slack_membership_sales_data AS sd
        GROUP BY 1, 2, 3, 4
        ORDER BY 1, 2, 3, 4;
    `;
}

module.exports = {
    query_slack_sales_data,
}
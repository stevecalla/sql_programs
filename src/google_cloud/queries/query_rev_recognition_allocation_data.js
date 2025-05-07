async function query_rev_recognition_allocation_data(batch_size = 10, offset = 0) {
    return `
        SELECT
            id_profiles,
            id_membership_periods_sa,
            
            real_membership_types_sa,
            new_member_category_6_sa,
            origin_flag_ma,
            
            DATE_FORMAT(created_at_mp, '%Y-%m-%d %H:%i:%s') AS created_at_mp,
            created_month,

            DATE_FORMAT(purchased_on_date_adjusted_mp, '%Y-%m-%d') AS purchased_on_date_adjusted_mp,
            purchased_on_adjusted_month,

            DATE_FORMAT(starts_mp, '%Y-%m-%d') AS starts_mp,
            DATE_FORMAT(ends_mp, '%Y-%m-%d') AS ends_mp,

            revenue_month,
            
            recursion_month_index,
            total_months,
            total_months_recursive,
            
            sales_units,
            monthly_sales_units,
            sales_revenue,
            monthly_revenue, 

            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
                
        FROM rev_recognition_allocation_data
        WHERE 1 = 1
        ORDER BY id_profiles, id_membership_periods_sa, revenue_month
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_rev_recognition_allocation_data
}
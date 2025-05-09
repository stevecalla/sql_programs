async function query_rev_recognition_allocation_data(batch_size = 10, offset = 0) {
    return `
        SELECT
            id_profiles,
            id_membership_periods_sa,
            
            real_membership_types_sa,
            new_member_category_6_sa,
            origin_flag_ma,

            DATE_FORMAT(created_at_mp, '%Y-%m-%d %H:%i:%s') AS created_at_mp,
            DATE_FORMAT(created_at_date_mp, '%Y-%m-%d') AS created_at_date_mp,
            created_at_mp_month,
            created_at_mp_quarter,
            created_at_mp_year,

            created_year_month,

            DATE_FORMAT(purchased_on_date_adjusted_mp, '%Y-%m-%d') AS purchased_on_date_adjusted_mp,
            purchased_on_date_adjusted_mp_month,
            purchased_on_date_adjusted_mp_quarter,
            purchased_on_date_adjusted_mp_year,
        
            purchased_on_adjusted_year_month,

            DATE_FORMAT(starts_mp, '%Y-%m-%d') AS starts_mp,
            starts_mp_month,
            starts_mp_quarter,
            starts_mp_year,

            DATE_FORMAT(ends_mp, '%Y-%m-%d') AS ends_mp,
            ends_mp_month,
            ends_mp_quarter,
            ends_mp_year,
        
            DATE_FORMAT(ends_mp, '%Y-%m-%d') AS revenue_date,
            revenue_month_date,
            revenue_quarter_date,
            revenue_year_date,
        
            revenue_year_month,

            is_current_month,
            
            recursion_month_index,

            months_mp_allocation_recursive,
            months_mp_allocated_custom,

            -- NOTE: Removed b/c produces too much data
            -- is_duplicate_previous_period,
            -- is_overlaps_previous_mp,
            -- is_stacked_previous_mp,
            -- days_between_previous_end_and_start,
            -- is_sales_revenue_zero,
            -- is_bulk,
            -- is_youth_premier,
            -- is_lifetime,
            -- has_created_at_gt_purchased_on,
            
            sales_units,
            monthly_sales_units,
            sales_revenue,
            monthly_revenue, 

            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
                
        FROM rev_recognition_allocation_data
        WHERE 1 = 1
        ORDER BY id_profiles, id_membership_periods_sa, revenue_year_month
        LIMIT ${batch_size} OFFSET ${offset}
        -- LIMIT 1 OFFSET 1
        ;
    `;
}

module.exports = {
    query_rev_recognition_allocation_data
}
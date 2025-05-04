async function query_rev_recognition_base_data(batch_size = 10, offset = 0) {
    return `
        SELECT
            id_profiles,
            id_membership_periods_sa,
            
            real_membership_types_sa,
            new_member_category_6_sa,
            origin_flag_ma,
            
            DATE_FORMAT(created_at_mp, '%Y-%m-%d %H:%i:%s') AS created_at_mp,
            created_at_mp_month,
            created_at_mp_quarter,
            created_at_mp_year,

            DATE_FORMAT(updated_at_mp, '%Y-%m-%d %H:%i:%s') AS updated_at_mp,
            updated_at_mp_month,
            updated_at_mp_quarter,
            updated_at_mp_year,

            DATE_FORMAT(purchased_on_date_mp, '%Y-%m-%d') purchased_on_date_mp,
            purchased_on_date_mp_month,
            purchased_on_date_mp_quarter,
            purchased_on_date_mp_year,

            DATE_FORMAT(purchased_on_date_adjusted_mp, '%Y-%m-%d') AS purchased_on_date_adjusted_mp,
            purchased_on_date_adjusted_mp_month,
            purchased_on_date_adjusted_mp_quarter,
            purchased_on_date_adjusted_mp_year,
            
            DATE_FORMAT(starts_mp, '%Y-%m-%d') AS starts_mp,
            starts_mp_month,
            starts_mp_quarter,
            starts_mp_year,
            
            DATE_FORMAT(ends_mp, '%Y-%m-%d') AS ends_mp,
            ends_mp_month,
            ends_mp_quarter,
            ends_mp_year,

            -- Standard difference (excludes the first partial month)
            total_months,

            -- Recursive-style logic (includes the start month)
            total_months_recursive,
            
            -- Flag if the prior period (previous start and end) is the same as the current period's start and end
            is_duplicate_previous_period,
            
            -- Flag if the current period overlaps with the previous one (start of current <= end of previous)
            is_overlaps_previous_mp,

            days_between_previous_end_and_start,
            
            is_sales_revenue_zero,
            is_bulk,
            
            is_youth_premier,
            is_lifetime,

             has_created_at_gt_purchased_on,

            actual_membership_fee_6_rule_sa,
            sales_revenue,
            sales_units,

            -- CREATED AT DATES
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
                
        FROM rev_recognition_base_data
        WHERE 1 = 1
        ORDER BY id_profiles, starts_mp
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_rev_recognition_base_data
}
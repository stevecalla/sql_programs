const query_sales_year_over_year_data = `
    SELECT 
        DATE_FORMAT(common_purchased_on_date_adjusted, '%Y-%m-%d') AS common_purchased_on_date_adjusted, -- date '2024-02-12'
        combined_date_field,

        DATE_FORMAT(current_year_date, '%Y-%m-%d') AS current_year_date, -- date '2024-02-12'
        current_year_day_of_week,

        DATE_FORMAT(prior_year_date, '%Y-%m-%d') AS prior_year_date, -- date '2024-02-12'
        prior_year_day_of_week,	

        real_membership_types_sa,	
        new_member_category_6_sa,	
        origin_flag_ma,
        origin_flag_category,	
        member_created_at_category,	

        region_name_member,
        region_abbr_member,
        region_name_events,
        region_abbr_events,

        revenue_current,	
        revenue_prior,	
        revenue_diff_abs,	
        revenue_diff_pct,

        units_current_year,	
        units_prior_year,	
        units_diff_abs,	
        units_diff_pct,	

        rev_per_unit_current_year,	
        rev_per_unit_prior_year,	
        rev_per_unit_diff_abs,	
        rev_per_unit_diff_pct,	

        DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn, -- date '2024-02-12'
        DATE_FORMAT(created_at_utc, '%Y-%m-%d') AS created_at_utc -- date '2024-02-12'

    FROM usat_sales_db.sales_data_year_over_year
    -- LIMIT 100;
`;

module.exports = {
    query_sales_year_over_year_data
}
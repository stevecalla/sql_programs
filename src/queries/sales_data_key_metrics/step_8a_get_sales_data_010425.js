// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_8a_create_indexes() {
    return `
        -- Step #8a: Create indexes on the new table
        CREATE INDEX idx_name_events ON sales_key_stats_2015 (name_events);
            CREATE INDEX idx_name_events_starts_events ON sales_key_stats_2015 (name_events, starts_events);

            CREATE INDEX idx_event_search ON sales_key_stats_2015 (
                starts_month_events,
                starts_year_events,
                purchased_on_mp,
                purchased_on_adjusted_mp,
                name_events_lower
            );

            CREATE INDEX idx_date_of_birth_profiles ON sales_key_stats_2015 (date_of_birth_profiles);

            CREATE INDEX idx_id_profiles ON sales_key_stats_2015(id_profiles);
            CREATE INDEX idx_purchased_on_year_adjusted_mp ON sales_key_stats_2015(purchased_on_year_adjusted_mp);

            CREATE INDEX idx_member_number ON sales_key_stats_2015 (member_number_members_sa);
            CREATE INDEX idx_id_membership_periods ON sales_key_stats_2015 (id_membership_periods_sa);

            CREATE INDEX idx_member_min_created_at ON sales_key_stats_2015 (member_min_created_at);
            CREATE INDEX idx_member_lifetime_purchases ON sales_key_stats_2015 (member_lifetime_purchases);
            CREATE INDEX idx_sales_units ON sales_key_stats_2015 (sales_units);
            CREATE INDEX idx_member_first_purchase_year ON sales_key_stats_2015 (member_first_purchase_year);
            CREATE INDEX idx_id_events ON sales_key_stats_2015 (id_events);
            
            CREATE INDEX idx_year_month ON sales_key_stats_2015 (purchased_on_year_adjusted_mp, purchased_on_month_adjusted_mp);
            CREATE INDEX idx_purchase_date ON sales_key_stats_2015 (purchased_on_adjusted_mp);

            CREATE INDEX idx_origin_flag_ma ON sales_key_stats_2015 (origin_flag_ma(255));

            CREATE INDEX idx_member_lapsed_renew_category ON sales_key_stats_2015 (member_lapsed_renew_category);
            CREATE INDEX idx_most_recent_prior_purchase_membership_type ON sales_key_stats_2015 (most_recent_prior_purchase_membership_type);
            CREATE INDEX idx_most_recent_prior_purchase_membership_category ON sales_key_stats_2015 (most_recent_prior_purchase_membership_category);
            CREATE INDEX idx_member_upgrade_downgrade_category ON sales_key_stats_2015 (member_upgrade_downgrade_category);
            CREATE INDEX idx_most_recent_purchase_date ON sales_key_stats_2015 (most_recent_purchase_date);
            CREATE INDEX idx_most_recent_prior_purchase_date ON sales_key_stats_2015 (most_recent_prior_purchase_date)
        ;
-- ********************************************
    `;
}

module.exports = {
    step_8a_create_indexes,
}
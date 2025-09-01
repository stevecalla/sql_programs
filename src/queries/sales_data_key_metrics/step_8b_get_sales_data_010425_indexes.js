// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_8b_create_indexes() {
    return `
        -- Step #8a: Create indexes on the new table
        
        -- ********************************************
        -- SET SESSION innodb_sort_buffer_size = 268435456;  -- 256 MB, adjust to taste

        ALTER TABLE sales_key_stats_2015
            ALGORITHM=INPLACE,
            LOCK=NONE,

            /* =======================
            ID / FK-like lookups
            ======================= */
            ADD INDEX idx_id_membership_periods (id_membership_periods_sa),
            ADD INDEX idx_id_events (id_events),

            /* =======================
            Event search / lookup
            ======================= */
            ADD INDEX idx_name_events_starts_events (name_events_lower, starts_events),
            ADD INDEX idx_event_lookup (starts_year_events, starts_month_events, name_events_lower),

            /* =======================
            Purchase date dimensions
            ======================= */
            ADD INDEX idx_purchase_date (purchased_on_adjusted_mp),
            -- ADD INDEX idx_sales_ym (purchased_on_year_adjusted_mp, purchased_on_month_adjusted_mp),
            ADD INDEX idx_year_month_cover (
                purchased_on_year_adjusted_mp,
                purchased_on_month_adjusted_mp,
                sales_revenue,
                sales_units
            ),

            /* =======================
            Member lifecycle / segmentation
            ======================= */
            ADD INDEX idx_member_min_created_at (member_min_created_at),
            ADD INDEX idx_member_lifetime_purchases (member_lifetime_purchases),
            ADD INDEX idx_member_first_purchase_year (member_first_purchase_year),
            ADD INDEX idx_member_lapsed_renew_category (member_lapsed_renew_category),
            ADD INDEX idx_member_upgrade_downgrade_category (member_upgrade_downgrade_category),

            /* =======================
            Prior purchase history
            ======================= */
            ADD INDEX idx_most_recent_purchase_date (most_recent_purchase_date),
            ADD INDEX idx_most_recent_prior_purchase_date (most_recent_prior_purchase_date),
            ADD INDEX idx_most_recent_prior_purchase_type (most_recent_prior_purchase_membership_type),
            ADD INDEX idx_most_recent_prior_purchase_cat (most_recent_prior_purchase_membership_category),

            /* =======================
            Demographics
            ======================= */
            ADD INDEX idx_date_of_birth_profiles (date_of_birth_profiles),

            /* =======================
            Origin / source
            ======================= */
            ADD INDEX idx_origin_flag_ma (origin_flag_ma(32))
        ;`
    ;
}

module.exports = {
    step_8b_create_indexes,
}
// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_8a_create_indexes(TABLE_NAME) {
    return `
            -- Step #8a: Create indexes on the new table

            -- 1) Make key columns NOT NULL (required for PK)
            ALTER TABLE ${TABLE_NAME}
                MODIFY id_profiles               BIGINT NOT NULL,
                MODIFY id_membership_periods_sa  BIGINT NOT NULL
            ;

            -- 2) Add the primary key
            ALTER TABLE ${TABLE_NAME}
                ADD PRIMARY KEY (id_profiles, id_membership_periods_sa)
            ;

            -- 3) Add more indexes
        
            -- CREATE INDEX idx_id_profiles_id_membership_periods ON ${TABLE_NAME} (id_profiles, id_membership_periods_sa);

            CREATE INDEX idx_name_events ON ${TABLE_NAME} (name_events);
        
            CREATE INDEX idx_name_events_starts_events ON ${TABLE_NAME} (name_events, starts_events);

            CREATE INDEX idx_event_search ON ${TABLE_NAME} (
                starts_month_events,
                starts_year_events,
                purchased_on_mp,
                purchased_on_adjusted_mp,
                name_events_lower
            );

            CREATE INDEX idx_date_of_birth_profiles ON ${TABLE_NAME} (date_of_birth_profiles);

            CREATE INDEX idx_id_profiles ON ${TABLE_NAME}(id_profiles);
            CREATE INDEX idx_purchased_on_year_adjusted_mp ON ${TABLE_NAME}(purchased_on_year_adjusted_mp);

            CREATE INDEX idx_member_number ON ${TABLE_NAME} (member_number_members_sa);
            CREATE INDEX idx_id_membership_periods ON ${TABLE_NAME} (id_membership_periods_sa);

            CREATE INDEX idx_member_min_created_at ON ${TABLE_NAME} (member_min_created_at);
            CREATE INDEX idx_member_lifetime_purchases ON ${TABLE_NAME} (member_lifetime_purchases);
            CREATE INDEX idx_sales_units ON ${TABLE_NAME} (sales_units);
            CREATE INDEX idx_member_first_purchase_year ON ${TABLE_NAME} (member_first_purchase_year);
            CREATE INDEX idx_id_events ON ${TABLE_NAME} (id_events);
            
            CREATE INDEX idx_year_month ON ${TABLE_NAME} (purchased_on_year_adjusted_mp, purchased_on_month_adjusted_mp);
            CREATE INDEX idx_purchase_date ON ${TABLE_NAME} (purchased_on_adjusted_mp);

            CREATE INDEX idx_origin_flag_ma ON ${TABLE_NAME} (origin_flag_ma(255));

            CREATE INDEX idx_member_lapsed_renew_category ON ${TABLE_NAME} (member_lapsed_renew_category);
            CREATE INDEX idx_most_recent_prior_purchase_membership_type ON ${TABLE_NAME} (most_recent_prior_purchase_membership_type);
            CREATE INDEX idx_most_recent_prior_purchase_membership_category ON ${TABLE_NAME} (most_recent_prior_purchase_membership_category);
            CREATE INDEX idx_member_upgrade_downgrade_category ON ${TABLE_NAME} (member_upgrade_downgrade_category);
            CREATE INDEX idx_most_recent_purchase_date ON ${TABLE_NAME} (most_recent_purchase_date);
            CREATE INDEX idx_most_recent_prior_purchase_date ON ${TABLE_NAME} (most_recent_prior_purchase_date)
        ;
-- ********************************************
    `;
}

module.exports = {
    step_8a_create_indexes,
}
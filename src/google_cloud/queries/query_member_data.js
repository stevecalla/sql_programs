const query_member_data = `
    SELECT 
        member_number_members_sa,
        id_profiles,
        origin_flag_ma,
        origin_flag_category,
        id_membership_periods_sa,
        real_membership_types_sa,
        new_member_category_6_sa,
        
        -- purchased_on_mp AS purchase,
        DATE_FORMAT(CONVERT_TZ(purchased_on_mp, @@session.time_zone, @@session.time_zone), '%Y-%m-%d %H:%i:%s') AS purchased_on_mp,
        DATE_FORMAT(purchased_on_date_mp, '%Y-%m-%d') AS purchased_on_date_mp, -- date '2024-02-12'
        purchased_on_year_mp,
        purchased_on_quarter_mp,
        purchased_on_month_mp,

        -- purchased_on_adjusted_mp,
        DATE_FORMAT(CONVERT_TZ(purchased_on_adjusted_mp, @@session.time_zone, @@session.time_zone), '%Y-%m-%d %H:%i:%s') AS purchased_on_adjusted_mp,

        purchased_on_date_adjusted_mp,
        DATE_FORMAT(purchased_on_date_adjusted_mp, '%Y-%m-%d') AS purchased_on_date_adjusted_mp, -- date '2024-02-12'
        purchased_on_year_adjusted_mp,
        purchased_on_quarter_adjusted_mp,
        purchased_on_month_adjusted_mp,

        DATE_FORMAT(starts_mp, '%Y-%m-%d') AS starts_mp, -- date '2024-02-12'
        starts_year_mp,
        starts__quarter_mp,
        starts_month_mp,

        DATE_FORMAT(ends_mp, '%Y-%m-%d') AS ends_mp, -- date '2024-02-12'
        ends_year_mp,
        ends_quarter_mp,
        ends_month_mp,


        -- member_min_created_at,
        DATE_FORMAT(DATE(member_min_created_at), '%Y-%m-%d') AS member_min_created_at,

        member_min_created_at_year,
        member_min_created_at_quarter,
        member_min_created_at_month,

        member_created_at_years_out,
        member_created_at_category,

        DATE_FORMAT(CONVERT_TZ(most_recent_purchase_date, @@session.time_zone, @@session.time_zone), '%Y-%m-%d %H:%i:%s') AS most_recent_purchase_date,
        
        CASE 
            WHEN most_recent_prior_purchase_date IS NOT NULL THEN 
                DATE_FORMAT(CONVERT_TZ(most_recent_prior_purchase_date, @@session.time_zone, @@session.time_zone),'%Y-%m-%d %H:%i:%s')
            ELSE NULL
        END AS most_recent_prior_purchase_date,

        member_lapsed_renew_category,

        most_recent_prior_purchase_membership_type,
        most_recent_prior_purchase_membership_category,
        member_upgrade_downgrade_category,

        member_lifetime_purchases,
        member_lifetime_frequency,
        member_first_purchase_year,
        member_first_purchase_years_out,
        member_first_purchase_year_category,

        DATE_FORMAT(date_of_birth_profiles, '%Y-%m-%d') AS date_of_birth_profiles, -- date '2024-02-12'

        date_of_birth_year_mp,
        date_of_birth_quarter_mp,
        date_of_birth_month_mp,

        age_now,
        age_now_bin,

        age_as_of_sale_date,
        age_as_sale_bin,
        age_at_end_of_year,
        age_as_year_end_bin,

        id_events,
        event_type_id_events,
        TRIM(BOTH '"' FROM name_events) AS name_events,
        TRIM(BOTH '"' FROM cleaned_name_events) AS cleaned_name_events,
        TRIM(BOTH '"' FROM name_events_lower) AS name_events_lower,

        DATE_FORMAT(CONVERT_TZ(created_at_events, @@session.time_zone, @@session.time_zone), '%Y-%m-%d %H:%i:%s') AS created_at_events,
        created_at_month_events,
        created_at_quarter_events,
        created_at_year_events,
    
        DATE_FORMAT(starts_events, '%Y-%m-%d') AS starts_events,
        starts_month_events,
        starts_quarter_events,
        starts_year_events,

        DATE_FORMAT(ends_events, '%Y-%m-%d') AS ends_events,
        ends_month_events,
        ends_quarter_events,
        ends_year_events,

        status_events,
        race_director_id_events,
        last_season_event_id,

        TRIM(BOTH '"' FROM city_events) AS city_events,
        state_events,
        country_name_events,
        country_events,

        sales_units,
        sales_revenue,
        actual_membership_fee_6_rule_sa,

        DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn, -- date '2024-02-12'        
        DATE_FORMAT(created_at_utc, '%Y-%m-%d') AS created_at_utc -- date '2024-02-12'

    FROM usat_sales_db.sales_key_stats_2015 
    WHERE purchased_on_year_adjusted_mp >= 2022
    -- LIMIT 100;
`;

module.exports = {
    query_member_data
}
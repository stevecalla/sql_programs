// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_8_sales_key_stats_2015() {
    return `
        -- STEP #8 = CREATE FINAL SALES TABLE -- TODO: done in 10 min
        DROP TABLE IF EXISTS sales_key_stats_2015;

            CREATE TABLE sales_key_stats_2015 AS
                SELECT 
                    am.member_number_members_sa, 
                    am.id_profiles,

                    -- sale origin       
                    CASE
                        -- categorize NULL as sourced from member_portal
                        WHEN am.purchased_on_year_adjusted_mp >= 2023 AND am.origin_flag_ma IS NULL THEN 'member_portal'
                        ELSE am.origin_flag_ma
                    END AS origin_flag_ma,          
                    CASE
                        -- categorize NULL as sourced from usat direct
                        WHEN am.purchased_on_year_adjusted_mp >= 2023 AND am.origin_flag_ma IS NULL THEN 'source_usat_direct'
                        WHEN am.purchased_on_year_adjusted_mp >= 2023 AND am.origin_flag_ma IN ('SUBSCRIPTION_RENEWAL') THEN 'source_usat_direct'
                        -- categorize 'ADMIN_BULK_UPLOADER', 'AUDIT_API', 'RTAV_CLASSIC' as sourced from race registration
                        WHEN am.purchased_on_year_adjusted_mp >= 2023 THEN 'source_race_registration'
                        ELSE 'prior_to_2023'
                    END AS origin_flag_category,

                    -- membership periods, types, category
                    am.id_membership_periods_sa, 
                    am.real_membership_types_sa, 
                    am.new_member_category_6_sa, 

                    -- purchase on dates
                    am.purchased_on_mp,
                    am.purchased_on_date_mp,
                    am.purchased_on_year_mp,       
                    am.purchased_on_quarter_mp,  
                    am.purchased_on_month_mp,       

                    -- adjust purchase on dates
                    am.purchased_on_adjusted_mp,
                    am.purchased_on_date_adjusted_mp,
                    am.purchased_on_year_adjusted_mp,
                    am.purchased_on_quarter_adjusted_mp,
                    am.purchased_on_month_adjusted_mp,
                            
                    -- start period dates
                    am.starts_mp as starts_mp,
                    YEAR(am.starts_mp) as starts_year_mp,
                    QUARTER(am.starts_mp) as starts__quarter_mp,
                    MONTH(am.starts_mp) as starts_month_mp,

                    -- end period dates
                    am.ends_mp ends_mp,
                    YEAR(am.ends_mp) ends_year_mp,
                    QUARTER(am.ends_mp) ends_quarter_mp,
                    MONTH(am.ends_mp) ends_month_mp,

                    -- member created at segmentation
                    mc.min_created_at AS member_min_created_at,
                    YEAR(mc.min_created_at) AS member_min_created_at_year,
                    QUARTER(mc.min_created_at) AS member_min_created_at_quarter,
                    MONTH(mc.min_created_at) AS member_min_created_at_month,

                    -- am.purchased_on_year_adjusted_mp - YEAR(mc.min_created_at) AS member_created_at_years_out,
                    -- GREATEST(am.purchased_on_year_adjusted_mp - year(mc.min_created_at), 0) AS member_created_at_years_out, -- TODO
                    CASE
                        WHEN am.purchased_on_year_adjusted_mp = YEAR(mc.min_created_at) THEN 'created_year'
                        WHEN am.purchased_on_year_adjusted_mp > YEAR(mc.min_created_at) THEN 'after_created_year'
                        ELSE 'error_first_purchase_year_category'
                    END AS member_created_at_category,

                    -- member lapsed, new, renew segmentation
                    pp.most_recent_purchase_date,
                    pp.most_recent_prior_purchase_date,
                    CASE
                        WHEN am.purchased_on_year_adjusted_mp = YEAR(mc.min_created_at) THEN 'created_year' -- new   
                        WHEN pp.most_recent_purchase_date > DATE_ADD(most_recent_prior_purchase_date, INTERVAL 2 YEAR) THEN 'after_created_year_lapsed'
                        WHEN pp.most_recent_purchase_date <= DATE_ADD(most_recent_prior_purchase_date, INTERVAL 2 YEAR) THEN 'after_created_year_renew'
                        ELSE 'error_lapsed_renew_segmentation'
                    END AS member_lapsed_renew_category,

                    -- upgrade, downgrade, same
                    most_recent_prior_purchase_membership_type,
                    most_recent_prior_purchase_membership_category,
                    CASE
                        WHEN am.purchased_on_year_adjusted_mp = YEAR(mc.min_created_at) THEN 'created_year' -- new 
                        WHEN pp.most_recent_prior_purchase_membership_type = 'one_day' AND real_membership_types_sa = 'adult_annual' THEN 'upgrade_oneday_to_annual'
                        WHEN pp.most_recent_prior_purchase_membership_type = 'adult_annual' AND real_membership_types_sa = 'one_day' THEN 'downgrade_annual_to_oneday'
                        WHEN pp.most_recent_prior_purchase_membership_type = 'one_day' AND real_membership_types_sa = 'one_day' THEN 'same_one_day_to_one_day'
                        WHEN pp.most_recent_prior_purchase_membership_type ='adult_annual' AND real_membership_types_sa = 'adult_annual' THEN 'same_annual_to_annual'
                        ELSE 'other'
                    END AS member_upgrade_downgrade_category,
                    
                    -- member lifetime frequency
                    lp.member_lifetime_purchases, -- total lifetime purchases  
                    CASE 
                        WHEN member_lifetime_purchases = 1 THEN 'one_purchase'
                        ELSE 'more_than_one_purchase'
                    END AS member_lifetime_frequency,
                    -- ********************************************

                    -- member first purchase year segmentation
                    fd.first_purchased_on_year_adjusted_mp AS member_first_purchase_year,
                    -- am.purchased_on_year_adjusted_mp - first_purchased_on_year_adjusted_mp AS member_first_purchase_years_out,
                    -- GREATEST(am.purchased_on_year_adjusted_mp - first_purchased_on_year_adjusted_mp, 0) AS member_first_purchase_years_out, -- TODO
                    CASE
                        WHEN am.purchased_on_year_adjusted_mp = fd.first_purchased_on_year_adjusted_mp THEN 'first_year'
                        WHEN am.purchased_on_year_adjusted_mp > fd.first_purchased_on_year_adjusted_mp THEN 'after_first_year'
                        ELSE 'error_first_purchase_year_category'
                    END AS member_first_purchase_year_category,

                    -- date of birth dimensions
                    ad.date_of_birth_profiles,
                    YEAR(ad.date_of_birth_profiles) as date_of_birth_year_mp,
                    QUARTER(ad.date_of_birth_profiles) as date_of_birth_quarter_mp,
                    MONTH(ad.date_of_birth_profiles) as date_of_birth_month_mp,

                    ad.age_now,
                    CASE  
                        WHEN ad.age_now < 4 THEN 'bad_age'
                        WHEN ad.age_now >= 4 AND ad.age_now < 10 THEN '4-9'
                        WHEN ad.age_now < 20 THEN '10-19'
                        WHEN ad.age_now < 30 THEN '20-29'
                        WHEN ad.age_now < 40 THEN '30-39'
                        WHEN ad.age_now < 50 THEN '40-49'
                        WHEN ad.age_now < 60 THEN '50-59'
                        WHEN ad.age_now < 70 THEN '60-69'
                        WHEN ad.age_now < 80 THEN '70-79'
                        WHEN ad.age_now < 90 THEN '80-89'
                        WHEN ad.age_now < 100 THEN '90-99'
                        WHEN ad.age_now >= 100 THEN 'bad_age'
                        ELSE 'bad_age'
                    END AS age_now_bin, -- create bin for date of birth as of now

                    sd.age_as_of_sale_date,
                    CASE 
                        WHEN sd.age_as_of_sale_date < 4 THEN 'bad_age'
                        WHEN sd.age_as_of_sale_date >= 4 AND sd.age_as_of_sale_date < 10 THEN '4-9'
                        WHEN sd.age_as_of_sale_date < 20 THEN '10-19'
                        WHEN sd.age_as_of_sale_date < 30 THEN '20-29'
                        WHEN sd.age_as_of_sale_date < 40 THEN '30-39'
                        WHEN sd.age_as_of_sale_date < 50 THEN '40-49'
                        WHEN sd.age_as_of_sale_date < 60 THEN '50-59'
                        WHEN sd.age_as_of_sale_date < 70 THEN '60-69'
                        WHEN sd.age_as_of_sale_date < 80 THEN '70-79'
                        WHEN sd.age_as_of_sale_date < 90 THEN '80-89'
                        WHEN sd.age_as_of_sale_date < 100 THEN '90-99'
                        WHEN sd.age_as_of_sale_date >= 100 THEN 'bad_age'
                        ELSE 'bad_age'
                    END AS age_as_sale_bin, -- create bin for date of birth as of sale date
                    
                    ye.age_at_end_of_year,
                    CASE 
                        WHEN ye.age_at_end_of_year < 4 THEN 'bad_age'
                        WHEN ye.age_at_end_of_year >= 4 AND ye.age_at_end_of_year < 10 THEN '4-9'
                        WHEN ye.age_at_end_of_year < 20 THEN '10-19'
                        WHEN ye.age_at_end_of_year < 30 THEN '20-29'
                        WHEN ye.age_at_end_of_year < 40 THEN '30-39'
                        WHEN ye.age_at_end_of_year < 50 THEN '40-49'
                        WHEN ye.age_at_end_of_year < 60 THEN '50-59'
                        WHEN ye.age_at_end_of_year < 70 THEN '60-69'
                        WHEN ye.age_at_end_of_year < 80 THEN '70-79'
                        WHEN ye.age_at_end_of_year < 90 THEN '80-89'
                        WHEN ye.age_at_end_of_year < 100 THEN '90-99'
                        WHEN ye.age_at_end_of_year >= 100 THEN 'bad_age'
                        ELSE 'bad_age'
                    END AS age_as_year_end_bin, -- create bin for age at the end of year of sale

                    -- event detais
                    id_events,
                    event_type_id_events,
                    name_events,
                    -- cleaned event name for comparison
                    REGEXP_REPLACE(
                        LOWER(REPLACE(
                            REGEXP_REPLACE(
                                REGEXP_REPLACE(
                                    REGEXP_REPLACE(
                                        REGEXP_REPLACE(
                                            name_events, 
                                            '^\\b[0-9]{4}\\s*|\\s*\\b[0-9]{4}\\b', ''  -- Remove year at start or end
                                        ),  
                                        'The\\s+\\b[0-9]{1,2}(st|nd|rd|th)\\s*', ''  -- Remove "The" followed by series number
                                    ), 
                                    '\\b[0-9]{1,2}(st|nd|rd|th)\\s*', ''  -- Remove series number
                                ), 
                                '-', '' -- Replace - with a single space
                            ), /step_8_get_sales_data_010425'); // step 8
                            '/', ' ' -- Replace / with a single space
                        )),
                    '\\s+', ' ' -- Replace multiple spaces with a single space
                    ) AS cleaned_name_events,
                    LOWER(name_events) AS name_events_lower, -- used to index & search efficiently

                    created_at_events,
                    created_at_month_events,
                    created_at_quarter_events,
                    created_at_year_events,

                    starts_events,
                    starts_month_events,
                    starts_quarter_events,
                    starts_year_events,

                    ends_events,
                    ends_month_events,
                    ends_quarter_events,
                    ends_year_events,

                    status_events,

                    race_director_id_events,
                    last_season_event_id,

                    city_events,
                    state_events,
                    country_name_events,
                    country_events,

                    -- key stats
                    st.sales_units,
                    st.sales_revenue,
                    st.actual_membership_fee_6_rule_sa, 

                    -- data created at dates
                    DATE_FORMAT(DATE_ADD(NOW(), INTERVAL -6 HOUR), '%Y-%m-%d') AS created_at_mtn,
                    DATE_FORMAT(NOW(), '%Y-%m-%d') AS created_at_utc

                FROM all_membership_sales_data_2015_left am

                    LEFT JOIN step_1_member_minimum_first_created_at_dates AS fd
                    ON am.member_number_members_sa = fd.member_number_members_sa

                    LEFT JOIN step_2_member_min_created_at_date AS mc
                    ON am.member_number_members_sa = mc.member_number_members_sa
                    
                    LEFT JOIN step_3_member_total_life_time_purchases AS lp
                    ON am.member_number_members_sa = lp.member_number_members_sa

                    LEFT JOIN step_4_member_age_dimensions AS ad
                    ON am.member_number_members_sa = ad.member_number_members_sa

                    LEFT JOIN step_5_member_age_at_sale_date AS sd
                    ON am.id_membership_periods_sa = sd.id_membership_periods_sa

                    LEFT JOIN step_5a_member_age_at_end_of_year_of_sale AS ye
                    ON am.id_membership_periods_sa = ye.id_membership_periods_sa

                    LEFT JOIN step_6_membership_period_stats AS st
                    ON am.id_membership_periods_sa = st.id_membership_periods_sa

                    LEFT JOIN step_7_prior_purchase AS pp
                    ON am.id_membership_periods_sa = pp.id_membership_periods_sa


W               -- HERE id_membership_periods_sa IN (421768, 1214842, 1214843, 1952878, 3272901) -- bad purchased on dates; eliminated iwth where statement below
		        WHERE CAST(purchased_on_date_mp AS CHAR) != '0000-00-00';
                -- LIMIT 10    
                ;
        -- *********************************************
    `;
}

module.exports = {
    step_8_sales_key_stats_2015,
}
const { step_8_sales_key_stats_2015_query } = require('./step_8a_get_sales_data_082925_query');
const { step_8a_sales_key_stats_2015_upsert } = require('./step_8a_get_sales_data_082925_upsert');

const TABLE_NAME = `sales_key_stats_2015_test`;

async function step_8_sales_key_stats_2015_test_create_table(FROM_STATEMENT) {
    const WHERE_STATEMENT = `WHERE 1 = 0`;

    const query = `

        -- Drop current table (if any)
        DROP TABLE IF EXISTS ${TABLE_NAME};

        -- Compute fixed timestamps once
        SET @now_utc := NOW();
        SET @dt_mtn  := DATE_FORMAT(DATE_ADD(@now_utc, INTERVAL -6 HOUR), '%Y-%m-%d');
        SET @dt_utc  := DATE_FORMAT(@now_utc, '%Y-%m-%d');

        -- Create table structure by selecting 0 rows (captures all columns & types)
        CREATE TABLE ${TABLE_NAME}
            ENGINE=InnoDB
            AS
            -- SELECT
            ${await step_8_sales_key_stats_2015_query(FROM_STATEMENT, WHERE_STATEMENT, '')}
            -- WHERE 1=0
        ;

        -- Add NOT NULL + PK (cheap now because the table is empty)
        ALTER TABLE ${TABLE_NAME}
            MODIFY id_profiles BIGINT NOT NULL,
            MODIFY id_membership_periods_sa BIGINT NOT NULL,
            ADD PRIMARY KEY (id_profiles, id_membership_periods_sa)
        ;
    `;

    return query;
}

async function step_8_sales_key_stats_2015_test_procedure(FROM_STATEMENT) {
    const WHERE_STATEMENT = 'WHERE am.id_profiles BETWEEN v_lo AND v_hi';
    const ORDER_BY_STATEMENT = 'ORDER BY am.id_profiles, am.id_membership_periods_sa';
    const INSERT_STATEMENT = `
        member_number_members_sa, id_profiles, origin_flag_ma, origin_flag_category, created_at_mp, created_at_date_mp,
        id_membership_periods_sa, real_membership_types_sa, new_member_category_6_sa, purchased_on_mp, purchased_on_date_mp,
        purchased_on_year_mp, purchased_on_quarter_mp, purchased_on_month_mp, purchased_on_adjusted_mp,
        purchased_on_date_adjusted_mp, purchased_on_year_adjusted_mp, purchased_on_quarter_adjusted_mp, purchased_on_month_adjusted_mp,
        starts_mp, starts_year_mp, starts__quarter_mp, starts_month_mp, ends_mp, ends_year_mp, ends_quarter_mp, ends_month_mp,
        member_min_created_at, member_min_created_at_year, member_min_created_at_quarter, member_min_created_at_month,
        member_created_at_years_out, member_created_at_category, most_recent_purchase_date, most_recent_prior_purchase_date,
        most_recent_mp_ends_date, most_recent_prior_mp_ends_date, member_lapsed_renew_category,
        most_recent_prior_purchase_membership_type, most_recent_prior_purchase_membership_category,
        member_upgrade_downgrade_category, member_upgrade_downgrade_major, member_lifetime_purchases, member_lifetime_frequency,
        member_first_purchase_year, first_starts_mp, member_first_purchase_years_out, member_first_purchase_year_category,
        date_of_birth_profiles, date_of_birth_year_mp, date_of_birth_quarter_mp, date_of_birth_month_mp,
        age_now, age_now_bin, age_as_of_sale_date, age_as_sale_bin, age_at_end_of_year, age_as_year_end_bin,
        id_events, id_sanctioning_events, id_sanctioning_events_and_type, event_type_id_events, name_events,
        cleaned_name_events, 
        name_events_lower, 
        created_at_events, created_at_month_events, created_at_quarter_events, created_at_year_events,
        starts_events, starts_month_events, starts_quarter_events, starts_year_events,
        ends_events, ends_month_events, ends_quarter_events, ends_year_events, status_events, race_director_id_events,
        last_season_event_id, id_event_types, id_event_type_events, name_event_type,
        member_city_addresses, member_postal_code_addresses, member_lng_addresses, member_lat_addresses,
        member_state_code_addresses, member_country_code_addresses, region_name_member, region_abbr_member,
        address_events, city_events, zip_events, state_code_events, country_code_events, region_name_events, region_abbr_events,
        created_at_ma, order_id_orders_products, id_registration_audit, confirmation_number_registration_audit,
        name_registration_companies, designation_races, sales_units, sales_revenue, actual_membership_fee_6_rule_sa,
        created_at_mtn, created_at_utc
    `;

    return `
      -- CREATE PROCEDURE TO LOOP THRU id_profiles IN BATCHES; INSERT RESULTS INTO TABLE
      
        DROP PROCEDURE IF EXISTS sp_step8_build_sales_key_stats;
        -- Always start from UTC
        
        -- Let MySQL handle daylight vs standard time automatically; compute times once        
        SET @dt_mtn  := NOW();              -- DATE_FORMAT(@now_mtn, '%Y-%m-%d');
        SET @dt_utc  := UTC_TIMESTAMP();    -- DATE_FORMAT(@now_utc, '%Y-%m-%d');

        CREATE PROCEDURE sp_step8_build_sales_key_stats(
            IN p_batch BIGINT,     -- e.g. 100000
            IN p_lo    BIGINT,     -- pass NULL to auto-detect
            IN p_hi    BIGINT      -- pass NULL to auto-detect
        )
        BEGIN
            DECLARE v_min BIGINT; DECLARE v_max BIGINT;
            DECLARE v_lo  BIGINT; DECLARE v_hi  BIGINT;

          SELECT MIN(id_profiles), MAX(id_profiles) INTO v_min, v_max
            -- FROM all_membership_sales_data_2015_left;
            ${FROM_STATEMENT};

            SET v_lo  = COALESCE(p_lo, v_min);
            SET v_max = COALESCE(p_hi, v_max);   -- ← cap range when p_hi provided

            WHILE v_lo IS NOT NULL AND v_lo <= v_max DO
                -- SET v_hi = p_hi;
                SET v_hi := LEAST(v_lo + p_batch - 1, v_max);

                
                INSERT INTO ${TABLE_NAME} (
                    ${INSERT_STATEMENT}
                )
                    WITH tmp_ids AS (
                        -- SELECT * ${FROM_STATEMENT} WHERE id_profiles BETWEEN 1 AND 100
                        SELECT * ${FROM_STATEMENT} WHERE id_profiles BETWEEN v_lo AND v_hi
                    )
                        ${await step_8_sales_key_stats_2015_query('FROM tmp_ids', '', '')}

                        -- WHERE am.id_profiles BETWEEN v_lo AND v_hi;
                        -- ORDER BY am.id_profiles, am.id_membership_periods_sa
                    ;

            COMMIT;
            SET v_lo = v_hi + 1;
            END WHILE;
        END;

        -- CALL THE PROCEDURE e.g., ~100k IDs per batch
        CALL sp_step8_build_sales_key_stats(100000, 1, 50); -- test on limited profile range
        -- CALL sp_step8_build_sales_key_stats(20000, NULL, NULL); -- run for full profile range; leave profile range NULL
    `;
}

module.exports = {
    step_8_sales_key_stats_2015_test_create_table,
    step_8_sales_key_stats_2015_test_procedure,
}

// -- SELECT
// -- ${await step_8_sales_key_stats_2015_query(FROM_STATEMENT, WHERE_STATEMENT, ORDER_BY_STATEMENT)}
// -- ;

// -- Optional: speed knob for index build
// -- SET SESSION innodb_sort_buffer_size = 268435456;  -- 256MB

// ALTER TABLE sales_key_stats_2015
//   -- drop redundants first if any
//   -- DROP INDEX idx_id_profiles,  -- redundant with PK left-prefix

//   ADD INDEX idx_name_events_starts_events (name_events_lower, starts_events),
//   ADD INDEX idx_event_lookup (starts_year_events, starts_month_events, name_events_lower),
//   ADD INDEX idx_date_of_birth_profiles (date_of_birth_profiles),
//   ADD INDEX idx_id_membership_periods (id_membership_periods_sa),
//   ADD INDEX idx_member_min_created_at (member_min_created_at),
//   ADD INDEX idx_member_lifetime_purchases (member_lifetime_purchases),
//   ADD INDEX idx_member_first_purchase_year (member_first_purchase_year),
//   ADD INDEX idx_id_events (id_events),
//   ADD INDEX idx_year_month (purchased_on_year_adjusted_mp, purchased_on_month_adjusted_mp),
//   ADD INDEX idx_purchase_date (purchased_on_adjusted_mp),
//   ADD INDEX idx_member_lapsed_renew_category (member_lapsed_renew_category),
//   ADD INDEX idx_most_recent_prior_purchase_type (most_recent_prior_purchase_membership_type),
//   ADD INDEX idx_most_recent_prior_purchase_cat (most_recent_prior_purchase_membership_category),
//   ADD INDEX idx_member_upgrade_downgrade_category (member_upgrade_downgrade_category),
//   ADD INDEX idx_most_recent_purchase_date (most_recent_purchase_date),
//   ADD INDEX idx_most_recent_prior_purchase_date (most_recent_prior_purchase_date),
//   ADD INDEX idx_origin_flag_ma (origin_flag_ma(32)),
//   ALGORITHM=INPLACE, LOCK=NONE;

// ANALYZE TABLE sales_key_stats_2015;

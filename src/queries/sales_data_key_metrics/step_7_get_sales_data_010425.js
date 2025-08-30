// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_7_prior_purchase(FROM_STATEMENT) {
    return `
        -- STEP #7 = MOST RECENT PRIOR PURCHASE TO DETERMINE NEW, LAPSED, RENEW

        -- CREATE TABLE
        DROP TABLE IF EXISTS step_7_prior_purchase;

          CREATE TABLE step_7_prior_purchase (
              id_profiles BIGINT NOT NULL,
              id_membership_periods_sa BIGINT NOT NULL,
              new_member_category_6_sa VARCHAR(255),
              most_recent_purchase_date DATETIME,
              most_recent_mp_ends_date DATETIME,
              most_recent_prior_purchase_date DATETIME,
              most_recent_prior_mp_ends_date DATETIME,
              most_recent_prior_purchase_membership_type VARCHAR(255),
              most_recent_prior_purchase_membership_category VARCHAR(255),
              PRIMARY KEY (id_profiles, id_membership_periods_sa)
          ) ENGINE=InnoDB;

      -- CREATE PROCEDURE TO LOOP THRU id_profiles IN BATCHES; INSERT RESULTS INTO TABLE
      DROP PROCEDURE IF EXISTS sp_step7_rebuild_by_range;

        CREATE PROCEDURE sp_step7_rebuild_by_range(IN p_batch BIGINT)
        BEGIN
          DECLARE v_min BIGINT;
          DECLARE v_max BIGINT;
          DECLARE v_lo  BIGINT;
          DECLARE v_hi  BIGINT;

          SELECT MIN(id_profiles), MAX(id_profiles) INTO v_min, v_max
          -- FROM all_membership_sales_data_2015_left;
          ${FROM_STATEMENT} AS am2;

          SET v_lo = v_min;

          WHILE v_lo IS NOT NULL AND v_lo <= v_max DO
            SET v_hi = v_lo + p_batch - 1;

            INSERT INTO step_7_prior_purchase (
              id_profiles, 
              id_membership_periods_sa, 
              new_member_category_6_sa,
              most_recent_purchase_date, 
              most_recent_mp_ends_date,
              most_recent_prior_purchase_date, 
              most_recent_prior_mp_ends_date,
              most_recent_prior_purchase_membership_type, 
              most_recent_prior_purchase_membership_category
            )
            SELECT 
              am1.id_profiles,
              am1.id_membership_periods_sa,
              am1.new_member_category_6_sa,
              am1.purchased_on_adjusted_mp,
              am1.ends_mp,

              (SELECT MAX(am2.purchased_on_adjusted_mp)
              -- FROM all_membership_sales_data_2015_left am2
              ${FROM_STATEMENT} AS am2
              WHERE am2.id_profiles = am1.id_profiles
                AND am2.purchased_on_adjusted_mp < am1.purchased_on_adjusted_mp),

              (
                SELECT MAX(am2.ends_mp)
                -- FROM all_membership_sales_data_2015_left am2
                ${FROM_STATEMENT} AS am2
                WHERE am2.id_profiles = am1.id_profiles
                  AND am2.ends_mp < am1.ends_mp
              ),

              (
                SELECT am2.real_membership_types_sa
                -- FROM all_membership_sales_data_2015_left am2
                ${FROM_STATEMENT} AS am2
                WHERE am2.id_profiles = am1.id_profiles
                  AND am2.purchased_on_adjusted_mp < am1.purchased_on_adjusted_mp
                ORDER BY am2.purchased_on_adjusted_mp DESC LIMIT 1
              ),

              (
                SELECT am2.new_member_category_6_sa
                -- FROM all_membership_sales_data_2015_left am2
                ${FROM_STATEMENT} AS am2
                WHERE am2.id_profiles = am1.id_profiles
                  AND am2.purchased_on_adjusted_mp < am1.purchased_on_adjusted_mp
                ORDER BY am2.purchased_on_adjusted_mp DESC LIMIT 1
              )

          -- FROM all_membership_sales_data_2015_left am1
          ${FROM_STATEMENT} AS am1
          WHERE am1.id_profiles BETWEEN v_lo AND v_hi;

          COMMIT;
          SET v_lo = v_hi + 1;
        END WHILE;
      END;


      -- CALL THE PROCEDURE e.g., ~100k IDs per batch
      CALL sp_step7_rebuild_by_range(100000);
    `;
}

module.exports = {
    step_7_prior_purchase,
}
// C:\Users\calla\development\usat\sql_code\29_runsignup_api\discovery_runsignup_usat_id_vs_fuzzy_match_usat_id_041226.sql

// or if using different where statement

// C:\Users\calla\development\usat\sql_code\29_runsignup_api\discovery_runsignup_usat_id_vs_fuzzy_match_usat_id_041226_v2.sql

async function main(TABLE_NAME, where_statement, affiliate_token) {
    return `
        CREATE TABLE \`${TABLE_NAME}\` AS 
        WITH base_usat_internal AS (
        SELECT
            'Q1 - setting_name_member_settings LIKE usat' AS query_label,
            rd.race_id,
            CASE
                    WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) = LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) THEN '1_match'
                    -- WHEN usat_event_id_member_settings IS NULL AND usat_sanction_id_internal IS NULL THEN '3. both_null'
                    -- WHEN usat_event_id_member_settings IS NOT NULL AND usat_sanction_id_internal IS NULL THEN '4. usat_sanction_id_null'
                    ELSE '2_mismatch'
                END AS comparison_status,
            CASE
            WHEN rd.race_name = "Title 9 Women's Triathlon" THEN "race name different but looks correct; check url"
                    WHEN rd.race_name = 'A Tri in the Buff' THEN 'example of a good match' --  = 137876 
                    
            WHEN rd.race_name = "Music City Track Carnival" THEN "running event only" -- 6061
                    
            WHEN rd.race_name = "Citrus Kids Triathlon" THEN 'no membership settings; registration ask if USAT member but didnt offer purchase option' -- 8255
                    WHEN rd.race_name = 'CajunMan Triathlon, Duathlon, Aquabike, Aquathlon & 5k Run' THEN 'no membership settings; registration ask if USAT member' -- 9238
                    
                    WHEN rd.race_name = 'Timberman Triathlon' THEN 'weird legacy membership setting fields' -- 
                    
                    WHEN rd.race_name = 'Swim to the Moon Open Water Swim Festival' THEN 'swim only event that has USMS membership setting. no usat membership setting' -- 19385
                    WHEN rd.race_name = 'The Active Texan Triathlon' THEN 'usat sanction id doesnt show in runsignup, not collecting membership on runsignup' -- 141220
                    WHEN rd.race_name = 'Brewhouse Triathlon' THEN 'usat sanction id is blank in runsignup; collecting $13/$18 wrong fee via runsignup in odd maybe old flow' -- 109588
                    WHEN rd.race_name = 'Greenfields Tri/Aqua/Du/ 5K & Splash and Dash #' THEN 'usat sanction id is blank in runsignup; ask if member but does nott charge for membership in runsignup flow' -- 159216
                    WHEN rd.race_name = 'Spring Fling Duathlon/5k' THEN 'runsignup sanction id should be 354413' -- '56808' wrong santion id at runsignup

                    ELSE 0
                END AS is_possible_exception,
                CASE
            WHEN rd.usat_match_date = rd.race_next_date THEN 'exact_match'
                    WHEN rd.usat_match_date BETWEEN DATE_SUB(rd.race_next_date, INTERVAL 7 DAY) AND DATE_ADD(rd.race_next_date, INTERVAL 7 DAY) THEN 'within_7_days'
                    ELSE 'other'
                END AS date_match,

                    MAX(rd.url) AS url,
                    MAX(rd.external_race_url) AS external_race_url,
            MAX(ed.registration_url) AS usat_registration_url,

            CASE
                WHEN ed.registration_url = rd.url THEN "runsignup_url = usat_url"
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) = LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) THEN "runsignup_usat_sanction_id = usat_sanction_id"
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN "sanction_id_mismatch_fuzzy_gt_95"
                        WHEN race_id = '169435' THEN "manual_match"
                        WHEN race_id = '80325' THEN "manual_match"
                        WHEN race_id = '131115' THEN "manual_match"
                        WHEN race_id = '139628' THEN "manual_match"
                        WHEN race_id = '143649' THEN "manual_match"
                ELSE "other"
            END AS registration_url_final_rule,
            CASE
                WHEN ed.registration_url = rd.url THEN rd.url
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) = LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) THEN rd.url
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN rd.url
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN rd.url
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN rd.url
                        WHEN race_id = '169435' THEN rd.url -- 'USA Triathlon Collegiate Club National Championships'
                        WHEN race_id = '80325' THEN rd.url -- 'Peasantman'
                        WHEN race_id = '131115' THEN rd.url -- 'Runner''s Edge - TOBAY Triathlon & Junior Triathlon'
                        WHEN race_id = '139628' THEN rd.url -- 'Cypress Sprint and Youth Triathlon'
                        WHEN race_id = '143649' THEN rd.url -- 'Splash & Dash - TRI Clear Lake Triathlon'
                ELSE 0
            END AS registration_url_final,
                    
            CASE
                WHEN ed.registration_url = rd.url THEN rd.url
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) = LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) THEN CONCAT(rd.url, '?aflt_token=${affiliate_token}')
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN CONCAT(rd.url, '?aflt_token=${affiliate_token}')
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN CONCAT(rd.url, '?aflt_token=${affiliate_token}')
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN CONCAT(rd.url, '?aflt_token=${affiliate_token}')
                        WHEN race_id = '169435' THEN CONCAT(rd.url, '?aflt_token=${affiliate_token}') -- 'USA Triathlon Collegiate Club National Championships'
                        WHEN race_id = '80325' THEN CONCAT(rd.url, '?aflt_token=${affiliate_token}')-- 'Peasantman'
                        WHEN race_id = '131115' THEN CONCAT(rd.url, '?aflt_token=${affiliate_token}') -- 'Runner''s Edge - TOBAY Triathlon & Junior Triathlon'
                        WHEN race_id = '139628' THEN CONCAT(rd.url, '?aflt_token=${affiliate_token}') -- 'Cypress Sprint and Youth Triathlon'
                        WHEN race_id = '143649' THEN CONCAT(rd.url, '?aflt_token=${affiliate_token}') -- 'Splash & Dash - TRI Clear Lake Triathlon'
                ELSE 0
            END AS registration_url_affiliate_final,
                    
            CASE
                WHEN ed.registration_url = rd.url THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}'))
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) = LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}'))
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}'))
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}'))
                        WHEN TRIM(CAST(rd.usat_event_id_member_settings AS CHAR)) <> LEFT(TRIM(CAST(rd.usat_sanction_id_internal AS CHAR)), 6) AND match_score_internal > 95 THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}'))
                        WHEN race_id = '169435' THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}')) -- 'USA Triathlon Collegiate Club National Championships'
                        WHEN race_id = '80325' THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}'))-- 'Peasantman'
                        WHEN race_id = '131115' THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}')) -- 'Runner''s Edge - TOBAY Triathlon & Junior Triathlon'
                        WHEN race_id = '139628' THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}')) -- 'Cypress Sprint and Youth Triathlon'
                        WHEN race_id = '143649' THEN CHAR_LENGTH(CONCAT(rd.url, '?aflt_token=${affiliate_token}')) -- 'Splash & Dash - TRI Clear Lake Triathlon'
                ELSE 0
            END AS registration_url_affiliate_final_char_count,
                    
            GROUP_CONCAT(DISTINCT(rd.event_type)) AS event_type,
            MAX(rd.setting_name_member_settings) AS setting_name_member_settings,
            MAX(rd.membership_settings_source_member_settings) AS membership_settings_source_member_settings,
            MAX(rd.race_name) AS race_name,
            MAX(rd.address_state) AS address_state,
            MAX(rd.address_city) AS address_city,

            MAX(rd.race_next_date) AS race_next_date,
            MAX(YEAR(rd.race_next_date)) AS race_next_year_date,
            MAX(MONTH(rd.race_next_date)) AS race_next_month_date,

            MAX(rd.usat_event_id_member_settings) AS usat_event_id_member_settings,
            MAX(rd.usat_sanction_id_internal) AS usat_sanction_id_internal,
            MAX(rd.usat_match_name) AS usat_match_name,
            MAX(rd.usat_match_state) AS usat_match_state,
            MAX(rd.usat_match_city) AS usat_match_city,
            
            MAX(rd.usat_match_date) AS usat_match_date,
            MAX(YEAR(rd.usat_match_date)) AS usat_match_year_date,
            MAX(MONTH(rd.usat_match_date)) AS usat_match_month_date,

            MAX(rd.match_method) AS match_method,
            MAX(rd.match_score_internal) AS match_score_internal, 
                
            FORMAT(COUNT(DISTINCT rd.race_id), 0),
            FORMAT(COUNT(*), 0)

            FROM all_runsignup_data_raw AS rd
            LEFT JOIN all_event_data_raw AS ed ON ed.registration_url = rd.url

            WHERE 1 = 1
                ${where_statement}

            -- AND LOWER(rd.setting_name_member_settings) LIKE '%usat%'
            -- AND LOWER(rd.setting_name_member_settings) NOT LIKE '%usatf%'
            
            GROUP BY 1,2,3,4,5,9,10,11,12
            ORDER BY 1,2,3
        )
        SELECT * FROM base_usat_internal ORDER BY is_possible_exception DESC;
    `;
}

async function runsignup_add_indexes(dst, TABLE_NAME) {
  await dst.execute(`ALTER TABLE \`${TABLE_NAME}\` ADD INDEX idx_race_id (race_id)`);

  await dst.execute(`ALTER TABLE \`${TABLE_NAME}\` ADD INDEX idx_race_next_year_date (race_next_year_date)`);
  await dst.execute(`ALTER TABLE \`${TABLE_NAME}\` ADD INDEX idx_usat_match_year_date (usat_match_year_date)`);

  await dst.execute(`ALTER TABLE \`${TABLE_NAME}\` ADD INDEX idx_comparison_status (comparison_status)`);
  await dst.execute(`ALTER TABLE \`${TABLE_NAME}\` ADD INDEX idx_registration_url_final_rule (registration_url_final_rule)`);
  await dst.execute(`ALTER TABLE \`${TABLE_NAME}\` ADD INDEX idx_match_score_internal (match_score_internal)`);
  await dst.execute(`ALTER TABLE \`${TABLE_NAME}\` ADD INDEX idx_usat_sanction_id_internal (usat_sanction_id_internal)`);
}

module.exports = {
    create_runsignup_match_data: main,
    runsignup_add_indexes,
}
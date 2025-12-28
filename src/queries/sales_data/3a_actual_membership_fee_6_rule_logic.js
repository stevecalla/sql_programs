// -- Section 3a: actual_membership_fee_6_rule

const query_actual_membership_fee_6_rule_logic = `
    SELECT
        ka.id_membership_periods,
        -- Is this pulling as expected historically? Up above, the max is used. Here though could it be an issue if it's taking MAX of a string??? Running for 2024, no change.
        -- What is the difference between pulling the data directly and using the MAX????
        MAX(
            CASE
            -- Section 0: base rules
                WHEN mp.terminated_on IS NOT NULL THEN '1_term_rule'
                
            -- Section 0a: Tri for Cure
                WHEN e.id IN (32774, 32775) AND ma.membership_type_id IN (115) THEN '1a_triforcure_2025' -- 2025 event rule Tri for Cure, added 2/4/25
                WHEN e.id IN (38330) AND ma.membership_type_id IN (115) THEN '1a_triforcure_2026' -- 2026 event rule for Tri for Cure, added 12/27/25

            -- Section 1: Pulls from order_products. This currently only contains memberships purchased through the website.
                WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  > 0) THEN '2_ops_cart_>_0'
                WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  <= 0) THEN '3_ops_cart_<=_0'

            -- Section 2: Looks at registration audit. For all memberships from API RTAV_Batch
                WHEN ra.registration_company_id IN (1) THEN '4_design_sensory' -- 'Designsensory'
                WHEN ra.registration_company_id IN (23) THEN '5_acme_usat' -- 'Acme-Usat'
                WHEN rama.price_paid IN (6.41)      THEN '7_rtav_batch_fee_6'
                WHEN rama.price_paid IN (10.68)     THEN '7_rtav_batch_fee_10'
                WHEN rama.price_paid IN (13.88)     THEN '7_rtav_batch_fee_13'
                WHEN rama.price_paid IN (16.01)     THEN '7_rtav_batch_fee_15'
                WHEN rama.price_paid IN (19.22)     THEN '7_rtav_batch_fee_18'
                WHEN rama.price_paid IN (24.55)     THEN '7_rtav_batch_fee_23'
                WHEN rama.price_paid IN (32.03)     THEN '7_rtav_batch_fee_30'
                WHEN rama.price_paid IN (38.43)     THEN '7_rtav_batch_fee_36'
                WHEN rama.price_paid IN (42.70)     THEN '7_rtav_batch_fee_40'
                WHEN rama.price_paid IN (53.38)     THEN '7_rtav_batch_fee_50'
                WHEN rama.price_paid IN (64.05)     THEN '7_rtav_batch_fee_60'
                WHEN rama.price_paid IN (105.68)    THEN '7_rtav_batch_fee_99'

                -- Add range here on below additions. Changes for February 3, 2025 price change 
                WHEN rama.price_paid BETWEEN 9.36 AND 9.86      THEN '7_rtav_batch_fee_9' -- $0.25 on either side of expected value based on 6.75% service fee (historical #)
                WHEN rama.price_paid BETWEEN 14.70 AND 14.95    THEN '7_rtav_batch_fee_14' -- Needed to limit upper due to overlapping with previous $15
                WHEN rama.price_paid BETWEEN 22.17 AND 22.67    THEN '7_rtav_batch_fee_21' -- $0.25 on either side of expected value based on 6.75% service fee (historical #)
                WHEN rama.price_paid BETWEEN 29.64 AND 29.95    THEN '7_rtav_batch_fee_28' -- Needed to limit upper due to overlapping wth previous $30
                WHEN rama.price_paid BETWEEN 68.07 AND 68.57    THEN '7_rtav_batch_fee_64' -- $0.25 on either side of expected value based on 6.75% service fee (historical #)
                WHEN rama.price_paid BETWEEN 175.89 AND 176.39  THEN '7_rtav_batch_fee_165' -- $0.25 on either side of expected value based on 6.75% service fee (historical #)
                WHEN rama.price_paid IS NOT NULL    THEN '7_rtav_batch_fee_not_null'

            -- Section 3: Ironman bulk upload rule for 2024
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND ma.payment_type = 'ironman-ticketsocket' AND mp.membership_type_id IN (115) AND mp.purchased_on >= '2024-01-01 00:00:00' AND mp.purchased_on < '2025-01-01 00:00:00' THEN '8_ironman_bulk_23' -- 23

                WHEN mp.origin_flag = 'admin_bulk_uploader' AND ma.payment_type = 'ironman-ticketsocket' AND mp.membership_type_id IN (112) AND mp.purchased_on >= '2024-01-01 00:00:00' AND mp.purchased_on < '2025-01-01 00:00:00'  THEN '8_ironman_bulk_60' -- 60

                WHEN mp.origin_flag = 'admin_bulk_uploader' AND ma.payment_type = 'ironman-ticketsocket' AND mp.membership_type_id IN (113) AND mp.purchased_on >= '2024-01-01 00:00:00' AND mp.purchased_on < '2025-01-01 00:00:00' THEN '8_ironman_bulk_90' -- 99

            -- Section 3a: Ironman bulk upload rule for 2025; 2/27/25
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (115) AND mp.purchased_on >= '2025-01-01 00:00:00' AND mp.purchased_on < '2025-02-03 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN '8.5_bulk_upload_2025_bronze_pre_increase'
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (115) AND mp.purchased_on >= '2025-02-03 00:00:00' AND mp.purchased_on < '2026-01-01 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN '8.5_bulk_upload_2025_bronze_post_increase'

                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (112) AND mp.purchased_on >= '2025-01-01 00:00:00' AND mp.purchased_on < '2025-02-03 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN '8.5_bulk_upload_2025_silver_pre_increase'
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (112) AND mp.purchased_on >= '2025-02-03 00:00:00' AND mp.purchased_on < '2026-01-01 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN '8.5_bulk_upload_2025_silver_post_increase'

                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (119) AND mp.purchased_on >= '2025-01-01 00:00:00' AND mp.purchased_on < '2025-01-21 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN '8.5_bulk_upload_2025_3year_pre_increase'
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (119) AND mp.purchased_on >= '2025-01-21 00:00:00' AND mp.purchased_on < '2026-01-01 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN '8.5_bulk_upload_2025_3year_post_increase'
                
            -- Section 4: Exception to Zero Out (no clear reason for each... subject to more research)
                WHEN mp.origin_flag = 'ADMIN_BULK_UPLOADER' AND ma.payment_type != 'Chronotrack' AND ka.is_koz_acception IN (0) THEN '9_chronotrack_bulk_koz_0' -- 0 ISNULL('KOZ Acception')

                WHEN mp.origin_flag = 'RTAV_CLASSIC' THEN '10_origin_rtav_classic' -- 0

                WHEN ma.payment_type = 'comped' THEN  '11_payment_type_comp_0' -- 0

                WHEN ma.payment_type = 'normal' AND mp.membership_type_id IN (74, 103) THEN '12_payment_type_normal_lifetime_0' -- 0 'No Home Member ID' = 'Lifetime'

                WHEN 1 = 1
                    AND ma.confirmation_code IS NULL
                    AND ma.payment_type != 'Chronotrack'
                    AND ma.payment_type != 'stripe'
                    AND ka.is_koz_acception IN (0)
                    AND
                    CASE
                        WHEN ma.payment_explanation LIKE '%recert%' THEN 'coach_recert'
                        WHEN ma.payment_explanation LIKE '%cert%' THEN 'coach_recert'
                        WHEN ma.payment_explanation LIKE '%coach%' THEN 'coach_recert'
                        WHEN ma.payment_type LIKE '%stripe%' THEN 'coach_recert' -- 2024 forward
                        ELSE NULL
                    END IS NULL THEN '13_koz_acception_coach_recert_0' -- 0
    
            -- Section 5: Product Specific Rules
                -- 2-YEAR          
                WHEN mp.membership_type_id IN (2, 52, 65, 70, 73, 91, 93, 96, 98) THEN '14_2_year_100' -- 100 -- 2year

                -- 3-YEAR
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) AND mp.purchased_on < '2024-06-04 12:00:00' THEN '15_3_year_135' -- 3year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) AND mp.purchased_on < '2024-10-29 00:00:00' THEN '15_3_year_180' -- 3year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) AND mp.purchased_on < '2025-01-21 00:00:00' THEN '15_3_year_150' -- 3year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) AND mp.purchased_on < '2026-01-01 00:00:00' THEN '15_3_year_165' -- 3year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) AND mp.purchased_on < '2027-01-01 00:00:00' THEN '15_3_year_178.49' -- 3year

                -- LIFETIME
                WHEN mp.membership_type_id IN (74, 103) THEN '16_lifetime_1000' -- 1000 -- lifetime

                -- KOZ ACCEPTION
                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND ma.event_id IN (30785, 30768, 30770) THEN '17_comped_events_0' --  0 -- one-day; these events were comped
                WHEN ka.is_koz_acception IN (1) AND mp.membership_type_id IN (4, 51, 54, 61, 94) THEN '18_koz_acception_youth_annual_10' -- 10 -- youth = youth annual; 'KOZ Acception' = 'KOZ'
                WHEN ka.is_koz_acception THEN '19_koz_acception_15' -- 15 -- 'KOZ Acception' = 'KOZ'

                -- YOUTH ANNUAL
                WHEN mp.membership_type_id IN (4, 51, 54, 61, 94) THEN '20_youth_annual_10' -- 10 -- youth annual

                -- SILVER
                WHEN mp.membership_type_id IN (112) AND mp.purchased_on < '2025-02-03 00:00:00' THEN '21_silver_60' -- 60
                WHEN mp.membership_type_id IN (112) AND mp.purchased_on < '2025-02-03 00:00:00' THEN '21_silver_60' -- 60
                WHEN mp.membership_type_id IN (112) AND mp.purchased_on < '2026-01-01 00:00:00' THEN '21_silver_64' -- 60
                WHEN mp.membership_type_id IN (112) AND mp.purchased_on < '2027-01-01 00:00:00' THEN '21_silver_69.99' -- 60
                
                -- GOLD
                WHEN mp.membership_type_id IN (113) AND mp.purchased_on < '2026-01-01 00:00:00' THEN '22_gold_99' -- 99
                WHEN mp.membership_type_id IN (113) AND mp.purchased_on < '2027-01-01 00:00:00' THEN '22_gold_99.99' -- 99.99

                -- PLATINUM TEAM USA
                WHEN mp.membership_type_id IN (114) AND mp.purchased_on < '2026-01-01 00:00:00' THEN '23_platinum_team_usa_400' -- 400 platinum team usa
                WHEN mp.membership_type_id IN (114) AND mp.purchased_on < '2027-01-01 00:00:00' THEN '23_platinum_team_usa_429.99' -- 429.99 platinum team usa
                
                -- PLATINUM FOUNDATION
                WHEN mp.membership_type_id IN (117) THEN '23_platinum_foundation_400' -- 400 -- platinum 
                WHEN mp.membership_type_id IN (117) AND mp.purchased_on < '2026-01-01 00:00:00' THEN '23_platinum_foundation_400' -- 400 -- platinum foundation
                WHEN mp.membership_type_id IN (117) AND mp.purchased_on < '2027-01-01 00:00:00' THEN '23_platinum_foundation_429.99' -- 429.99 -- platinum 

                -- BRONZE
                WHEN ma.membership_type_id = 118 THEN '25_bronze_0' -- 0 BRONZE AO
                WHEN mp.membership_type_id IN (115) AND mp.purchased_on < '2025-02-03 00:00:00' THEN '24_bronze_23' -- seems inaccurate to price all bronze at $23; will need evaluate if necessary
                
                -- 1-YEAR
                WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mp.purchased_on < '2024-01-16 09:00:00' THEN '33_1_year_50'-- 50 1 year -- 1 Year
                WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN '28_1_year_>=_2024-01-16_60' -- 1-Year these are legacy annual codes; there should be no membership purchase at level with some leakage in 2024
                
                -- YOUTH PREMIER
                WHEN mp.membership_type_id IN (107) AND mp.purchased_on < '2024-01-16 09:00:00' THEN '30_youth_premier_<_2024-01-16_30' -- 25 youth premier
                WHEN mp.membership_type_id IN (107) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN '26_youth_premier_>=_2024-01-16_30' -- 30 youth premier
                
                -- YOUNG ADULT
                WHEN mp.membership_type_id IN (55) AND mp.purchased_on < '2024-01-16 09:00:00' THEN '31_youth_adult_<_2024_01_16_36' -- 36 young adult
                WHEN mp.membership_type_id IN (55) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN '27_youth_adult_>=_2024-01-16_40' -- 40 young adult
                
                -- ELITE
                WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) AND mp.purchased_on < '2023-11-01 09:00:00' THEN '34_elite_50' -- elite
                WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) AND mp.purchased_on >= '2023-11-01 09:00:00' AND mp.purchased_on < '2025-02-03 00:00:00' THEN '29_elite_>=_2024-01-16_60' -- elite
                WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) AND mp.purchased_on < '2026-01-01 00:00:00' THEN '34_elite_64' -- elite
                WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) AND mp.purchased_on < '2027-01-01 00:00:00' THEN '34_elite_79.99' -- elite
                
                -- ONE DAY - FALL BACK RULES
                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) THEN '32_one_day_15' -- 15 one day (applies mostly prior to 2022)
                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN '27_one_day_>=_2024-01-16_23' -- seems inaccurate to price all bronze $23; will need evaluate if necessary

            -- Section 6: Backstop #1
                WHEN mp.membership_type_id IN (112) AND mp.purchased_on >= '2025-02-03 00:00:00' THEN '35_silver_64'
                WHEN mp.membership_type_id IN (119) AND mp.purchased_on >= '2025-02-03 00:00:00' THEN '36_3_year_165'
                WHEN mp.membership_type_id IN (115) AND mp.purchased_on >= '2025-02-03 00:00:00' THEN '37_bronze_28'
                -- End Jan 2025 Section

            -- Section 7: Backstop #2
                ELSE '99_no_rule_applied'

            END
        ) AS max_membership_fee_6_rule
         
    FROM koz_acception AS ka
        LEFT JOIN membership_applications AS ma ON ka.id_membership_periods = ma.membership_period_id
        LEFT JOIN membership_periods AS mp ON ka.id_membership_periods = mp.id
        LEFT JOIN registration_audit AS ra ON ka.id_membership_periods = ra.membership_period_id
        LEFT JOIN order_products AS op ON ma.id = op.purchasable_id
        LEFT JOIN registration_audit_membership_application AS rama ON ra.id = rama.audit_id
        LEFT JOIN races r ON r.id = ma.race_id
        LEFT JOIN distance_types dt ON dt.id = r.distance_type_id
        
        /* BEGIN Eric Passe CHANGES 2/27/25 */
        LEFT JOIN events AS e ON ma.event_id = e.id
        LEFT JOIN (
            SELECT 
                id 'event_id', 1 'ironman_bulk_event_list'
            FROM events 
            WHERE sanctioning_event_id IN (310118,310159,310009,310187,310210,310248,310348,310278,310317,310323,310354,310714,310372,310356,310418,310357,310446,310408,310742,310419,310404,310420,310473,310424,310458,310507,310551,310552,310618,310536,310682,310603,310554,310704,310529,310725,310726,310762,310506,310970,310931,311092,350152,351065,350971,350406,350706,350720,350930,311684,311683,311682,350978,350536,350496,350410,350557,350363,350150,350177,311625,311599,350758,310542)
        ) evbu ON evbu.event_id = e.id
        /* END Eric Passe CHANGES 2/27/25 */
    
    GROUP BY ka.id_membership_periods
`;

module.exports = { query_actual_membership_fee_6_rule_logic };
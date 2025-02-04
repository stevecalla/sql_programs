const query_actual_membership_fee_6_rule_logic = `
    SELECT 
        ka.id_membership_periods,

        -- Membership Fee 6
        MAX(
            CASE
                WHEN mp.terminated_on IS NOT NULL THEN '1_term_rule' -- membership period terminated on ISNULL filtered in the source_2 CTE query above 

                WHEN events.id IN ('32774', '32775') AND mp.membership_type_id IN (115) THEN '35_tri_for_cure' -- tri for cure rule; sale is at $0 then race director is billed the membership fee; added 02/04/25

                -- elseif [Source] = "Membership System/RTAV Classic" then [MS or Classic Fee 2] // essentially does it have an Order ID
                -- [Source] 
                    -- has a rule such that if not isnull([Cart Label]) then "Membership System/RTAV Classic"
                -- 'MS or Classic Fee 2' = if [Amount Per] - [Discount] - [Amount Refunded] > 0 then [Amount Per] - [Discount] - [Amount Refunded] else 0 END
                    -- amount per = order_products.amount_per 
                    -- Discount = order_products.discount
                    -- Amount Refunded = order_products.amount_refunded   
                    -- this rule applies the discount for the purchase of a one day then an annual
                WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  > 0) THEN '2_ops_cart_>_0'
                WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  <= 0) THEN '3_ops_cart_<=_0'
                
                WHEN ra.registration_company_id IN (1) THEN '4_design_sensory' -- "Designsensory"
                WHEN ra.registration_company_id IN (23) THEN '5_acme_usat' -- "Acme-Usat"

                -- 'RTAV Batch Fee'
                -- elseif [Source] = "RTAV Batch" then [RTAV Batch Fee] //essentially does it have an Audit ID
                -- [Source] is elseif not isnull([Price Paid]) then "RTAV Batch"
                -- WHEN rama.price_paid IS NOT NULL THEN 1
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
                WHEN rama.price_paid IS NOT NULL    THEN '7_rtav_batch_fee_not_null' -- assigns 6, 13, 18, 23 et al as appropriate

                -- WHEN mp.origin_flag = "ADMIN_BULK_UPLOADER" AND ma.payment_type = "ironman-ticketsocket" THEN 23 -- remove 12/6/24 per Eric Passe replaced with below
                WHEN mp.origin_flag = 'admin_bulk_uploader' and ma.payment_type = 'ironman-ticketsocket' and mp.membership_type_id in (115) then '8_ironman_bulk_23' -- 23
                WHEN mp.origin_flag = 'admin_bulk_uploader' and ma.payment_type = 'ironman-ticketsocket' and mp.membership_type_id in (112) then '8_ironman_bulk_60' -- 60
                WHEN mp.origin_flag = 'admin_bulk_uploader' and ma.payment_type = 'ironman-ticketsocket' and mp.membership_type_id in (113) then '8_ironman_bulk_90' -- 99

                -- 'KOZ Acception'
                WHEN mp.origin_flag = "ADMIN_BULK_UPLOADER" AND ma.payment_type != "Chronotrack" AND ka.is_koz_acception IN (0) THEN '9_chronotrack_bulk_koz_0' -- 0 -- ISNULL('KOZ Acception')
                WHEN mp.origin_flag = "RTAV_CLASSIC" THEN '10_origin_rtav_classic' -- 0
                WHEN ma.payment_type = "comped" THEN  '11_payment_type_comp_0' -- 0
                WHEN ma.payment_type = "normal" AND mp.membership_type_id IN (74, 103) THEN '12_payment_type_normal_lifetime_0' -- 0 -- 'No Home Member ID' = "Lifetime"

                -- 'KOZ Acception' & coach recert
                WHEN
                    ma.confirmation_code IS NULL        AND 
                    ma.payment_type != "Chronotrack"    AND 
                    ma.payment_type != "stripe"         AND 
                    -- ISNULL('KOZ Acception')
                    ka.is_koz_acception IN (0)          AND 
                    -- ISNULL('Coach Recert')
                    CASE        
                        WHEN ma.payment_explanation LIKE '%recert%' THEN 'coach_recert'
                        WHEN ma.payment_explanation LIKE '%cert%' THEN 'coach_recert'
                        WHEN ma.payment_explanation LIKE '%coach%' THEN 'coach_recert'
                        WHEN ma.payment_type LIKE '%stripe%' THEN 'coach_recert' -- 2024 forward
                        ELSE NULL
                    END IS NULL THEN '13_koz_acception_coach_recert_0' -- 0
                WHEN mp.membership_type_id IN (2, 52, 65, 70, 73, 91, 93, 96, 98) THEN '14_2_year_100' -- 100 -- 2year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) AND mp.purchased_on < '2024-06-04 12:00:00' THEN '15_3_year_135' -- 135 -- 3year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) THEN '15_3_year_180' -- 180 -- 3year
                WHEN mp.membership_type_id IN (74, 103) THEN '16_lifetime_1000' -- 1000 -- lifetime
                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND ma.event_id IN (30785, 30768, 30770) THEN '17_comped_events_0' --  0 -- one-day; //these events were comped
                -- 'KOZ Acception'
                WHEN ka.is_koz_acception IN (1) AND mp.membership_type_id IN (4, 51, 54, 61, 94) THEN '18_koz_acception_youth_annual_10' -- 10 -- youth = youth annual; 'KOZ Acception' = "KOZ"
                WHEN ka.is_koz_acception THEN '19_koz_acception_15' -- 15 -- 'KOZ Acception' = "KOZ"
                WHEN mp.membership_type_id IN (4, 51, 54, 61, 94) THEN '20_youth_annual_10' -- 10 -- youth = youth annual
                WHEN mp.membership_type_id IN (112) THEN '21_silver_60' -- 60 -- silver
                WHEN mp.membership_type_id IN (113) THEN '22_gold_99' -- 99 -- gold
                WHEN mp.membership_type_id IN (114) THEN '23_platinum_team_usa_400' -- 400 -- platinum team usa
                WHEN mp.membership_type_id IN (117) THEN '23_platinum_foundation_400' -- 400 -- platinum foundation
                WHEN mp.membership_type_id IN (115) THEN '24_bronze_23' -- 23 -- bronze
                WHEN ma.membership_type_id = 118 THEN '25_bronze_0' -- 0 -- bronze
                WHEN mp.membership_type_id IN (107) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN '26_youth_premier_>=_2024-01-16_30' -- 30 -- youth premier
                WHEN mp.membership_type_id IN (55) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN '27_youth_adult_>=_2024-01-16_40' -- 40 -- young adult
                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN '27_one_day_>=_2024-01-16_23' -- 23  -- one day
                WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN '28_1_year_>=_2024-01-16_60' -- 60 -- 1year
                WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) AND mp.purchased_on >= '2023-11-01 09:00:00' THEN '29_elite_>=_2024-01-16_60' -- 60 -- elite
                WHEN mp.membership_type_id IN (107) THEN '30_youth_premier_25' -- 25 -- youth premier
                WHEN mp.membership_type_id IN (55) THEN '31_youth_adult_36' -- 36 -- young adult
                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) THEN '32_one_day_15' -- 15 -- one day
                WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) THEN '33_1_year_50'-- 50 -- 1 year
                WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN '34_elite_50' -- 50 -- elite
                ELSE 0
            END
        ) AS max_membership_fee_6_rule

    FROM koz_acception AS ka
        LEFT JOIN membership_applications AS ma ON ka.id_membership_periods = ma.membership_period_id
        LEFT JOIN membership_periods AS mp ON ka.id_membership_periods = mp.id
        LEFT JOIN registration_audit AS ra ON ka.id_membership_periods = ra.membership_period_id
        LEFT JOIN order_products AS op ON ma.id = op.purchasable_id
        LEFT JOIN registration_audit_membership_application AS rama ON ra.id = rama.audit_id
        LEFT JOIN events ON ma.event_id = events.id

    -- WHERE 
        -- mp.terminated_on IS NULL
        -- ma.payment_type = "ironman-ticketsocket"
        -- ra.registration_company_id IN (1, 23)
        -- op.cart_label IS NOT NULL
        -- rama.price_paid IS NOT NULL
        -- mp.membership_type_id IN (107) AND mp.purchased_on >= '2024-01-16 09:00:00' -- THEN 30
        -- mp.membership_type_id IN (55) AND mp.purchased_on >= '2024-01-16 09:00:00' -- THEN 40

        -- use case for bronze 6 relay being priced at $23; added rule above if rama.price_paid = 6 then price at 6
        -- id_membership_periods IN (4698020, 4636868) 

    GROUP BY ka.id_membership_periods
`;

module.exports = { query_actual_membership_fee_6_rule_logic };
const query_actual_membership_fee_6_logic = 
`
    SELECT 
        ka.id_membership_periods,
        ka.source_2,
        ka.is_koz_acception,
        mp.membership_type_id AS membership_type_id_membership_periods,
        -- real_membership_types
        CASE
            WHEN mp.membership_type_id IN (1, 2, 3, 52, 55, 60, 62, 64, 65, 66, 67, 68, 70, 71, 73, 74, 75, 85, 89, 91, 93, 96, 98, 99, 101, 103, 104, 112, 113, 114, 117, 119) THEN 'adult_annual'
            WHEN mp.membership_type_id IN (4, 51, 54, 61, 94, 107) THEN 'youth_annual'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 'one_day'
            WHEN mp.membership_type_id IN (56, 58, 81, 105) THEN 'club'
            WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 'elite'
            ELSE "other"
        END AS real_membership_types,
        mp.purchased_on,
        mp.terminated_on, -- membership period terminated on IS NULL filtered out in the source_2 CTE query above

        ma.payment_type AS payment_type_membership_applications,  
        ra.registration_company_id,

        op.cart_label AS cart_label_order_products,
        op.amount_per AS amount_per_order_products,
        op.discount AS discount_order_products,
        op.amount_refunded AS amount_refunded_order_products,
        (op.amount_per - op.discount - op.amount_refunded) AS ms_or_classic_fee_2,
        ((op.amount_per - op.discount - op.amount_refunded)  > 0) AS ms_or_classic_fee_2_greater_than_zero,

        rama.price_paid AS price_paid_registration_audit_membership_application,
        rama.price_paid IS NOT NULL AS is_rama_price_paid_null,

        -- Membership Fee 6
        MAX(
            CASE
                WHEN mp.terminated_on IS NOT NULL THEN 0 -- membership period terminated on ISNULL filtered in the source_2 CTE query above 

                -- elseif [Source] = "Membership System/RTAV Classic" then [MS or Classic Fee 2] // essentially does it have an Order ID
                -- [Source] 
                    -- has a rule such that if not isnull([Cart Label]) then "Membership System/RTAV Classic"
                -- 'MS or Classic Fee 2' = if [Amount Per] - [Discount] - [Amount Refunded] > 0 then [Amount Per] - [Discount] - [Amount Refunded] else 0 END
                    -- amount per = order_products.amount_per 
                    -- Discount = order_products.discount
                    -- Amount Refunded = order_products.amount_refunded   
                    -- this rule applies the discount for the purchase of a one day then an annual
                WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  > 0) THEN (op.amount_per - op.discount - op.amount_refunded)
                WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  <= 0) THEN 0
                
                WHEN ra.registration_company_id IN (1) THEN 0 -- "Designsensory"
                WHEN ra.registration_company_id IN (23) THEN 0 -- "Acme-Usat"

                -- 'RTAV Batch Fee'
                -- elseif [Source] = "RTAV Batch" then [RTAV Batch Fee] //essentially does it have an Audit ID
                -- [Source] is elseif not isnull([Price Paid]) then "RTAV Batch"
                -- WHEN rama.price_paid IS NOT NULL THEN 1
                WHEN rama.price_paid IN (6.41)      THEN 6
                WHEN rama.price_paid IN (10.68)     THEN 10
                WHEN rama.price_paid IN (13.88)     THEN 13
                WHEN rama.price_paid IN (16.01)     THEN 15
                WHEN rama.price_paid IN (19.22)     THEN 18
                WHEN rama.price_paid IN (24.55)     THEN 23
                WHEN rama.price_paid IN (32.03)     THEN 30
                WHEN rama.price_paid IN (38.43)     THEN 36
                WHEN rama.price_paid IN (42.70)     THEN 40
                WHEN rama.price_paid IN (53.38)     THEN 50
                WHEN rama.price_paid IN (64.05)     THEN 60
                WHEN rama.price_paid IN (105.68)    THEN 99  
                WHEN rama.price_paid IS NOT NULL    THEN rama.price_paid -- assigns 6, 13, 18, 23 et al as appropriate

                WHEN mp.origin_flag = "ADMIN_BULK_UPLOADER" AND ma.payment_type = "ironman-ticketsocket" THEN 23

                -- 'KOZ Acception'
                WHEN mp.origin_flag = "ADMIN_BULK_UPLOADER" AND ma.payment_type != "Chronotrack" AND ka.is_koz_acception IN (0) THEN 0 -- ISNULL('KOZ Acception')
                WHEN mp.origin_flag = "RTAV_CLASSIC" THEN 0
                WHEN ma.payment_type = "comped" THEN 0
                WHEN ma.payment_type = "normal" AND mp.membership_type_id IN (74, 103) THEN 0 -- 'No Home Member ID' = "Lifetime"
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
                    END IS NULL THEN 0
                WHEN mp.membership_type_id IN (2, 52, 65, 70, 73, 91, 93, 96, 98) THEN 100 -- 2year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) AND mp.purchased_on < '2024-06-04 12:00:00' THEN 135 -- 3year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) THEN 180 -- 3year
                WHEN mp.membership_type_id IN (74, 103) THEN 1000 -- lifetime
                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND ma.event_id IN (30785, 30768, 30770) THEN 0 -- one-day; //these events were comped
                -- 'KOZ Acception'
                WHEN ka.is_koz_acception IN (1) AND mp.membership_type_id IN (4, 51, 54, 61, 94) THEN 10 -- youth = youth annual; 'KOZ Acception' = "KOZ"
                WHEN ka.is_koz_acception THEN 15 -- 'KOZ Acception' = "KOZ"
                WHEN mp.membership_type_id IN (4, 51, 54, 61, 94) THEN 10 -- youth = youth annual
                WHEN mp.membership_type_id IN (112) THEN 60 -- silver
                WHEN mp.membership_type_id IN (113) THEN 99 -- gold
                WHEN mp.membership_type_id IN (114) THEN 400 -- platinum team usa
                WHEN mp.membership_type_id IN (117) THEN 400 -- platinum foundation
                WHEN mp.membership_type_id IN (115) THEN 23 -- bronze
                WHEN ma.membership_type_id = 118 THEN 0 -- bronze
                WHEN mp.membership_type_id IN (107) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN 30 -- youth premier
                WHEN mp.membership_type_id IN (55) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN 40 -- young adult
                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN 23  -- one day
                WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN 60 -- 1year
                WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) AND mp.purchased_on >= '2023-11-01 09:00:00' THEN 60 -- elite
                WHEN mp.membership_type_id IN (107) THEN 25 -- youth premier
                WHEN mp.membership_type_id IN (55) THEN 36 -- young adult
                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) THEN 15 -- one day
                WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) THEN 50 -- 1 year
                WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 50 -- elite
                ELSE 0
            END
        ) AS max_membership_fee_6,

        COUNT(mp.purchased_on)

    FROM koz_acception AS ka
        LEFT JOIN membership_applications AS ma ON ka.id_membership_periods = ma.membership_period_id
        LEFT JOIN membership_periods AS mp ON ka.id_membership_periods = mp.id
        LEFT JOIN registration_audit AS ra ON ka.id_membership_periods = ra.membership_period_id
        LEFT JOIN order_products AS op ON ma.id = op.purchasable_id
        LEFT JOIN registration_audit_membership_application AS rama ON ra.id = rama.audit_id

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

module.exports = { query_actual_membership_fee_6_logic };
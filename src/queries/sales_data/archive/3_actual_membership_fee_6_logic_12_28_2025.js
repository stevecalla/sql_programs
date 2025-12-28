// -- Section 3: actual_membership_fee_6
// -- Purpose: Will determine the calculations for each of the memberships
// -- JAN2025CHANGES:
//     -- 1. Added logic for registration_audit_membership_application being populated with Active.com membership + service fee. The issue should be corrected around Feb 20, 2025
//     -- 2. Added logic in backstop area for any potential bulk uploads. Added date logic for specific memberships

const query_actual_membership_fee_6_logic = `
    SELECT 
        ka.id_membership_periods,
        ka.source_2,
        ka.is_koz_acception,
        mp.membership_type_id AS membership_type_id_membership_periods,
        -- Membership subtypes below to be added to table vapor.membership_types in the future
        CASE
            WHEN mp.membership_type_id IN (1, 2, 3, 52, 55, 60, 62, 64, 65, 66, 67, 68, 70, 71, 73, 74, 75, 85, 89, 91, 93, 96, 98, 99, 101, 103, 104, 112, 113, 114, 117, 119) THEN 'adult_annual'
            WHEN mp.membership_type_id IN (4, 51, 54, 61, 94, 107) THEN 'youth_annual'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 'one_day'
            WHEN mp.membership_type_id IN (56, 58, 81, 105) THEN 'club'
            WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 'elite'
            ELSE 'other'
        END AS real_membership_types,
        mp.purchased_on,
        mp.terminated_on,
        ma.payment_type AS payment_type_membership_applications,
        ra.registration_company_id,
        op.cart_label AS cart_label_order_products,
        op.amount_per AS amount_per_order_products,
        op.discount AS discount_order_products,
        op.amount_refunded AS amount_refunded_order_products,
        (op.amount_per - op.discount - op.amount_refunded) AS ms_or_classic_fee_2,
        ((op.amount_per - op.discount - op.amount_refunded) > 0) AS ms_or_classic_fee_2_greater_than_zero,
        rama.price_paid AS price_paid_registration_audit_membership_application, -- Price from RTAV_Batch
        rama.price_paid IS NOT NULL AS is_rama_price_paid_null, -- ??? Not sure here.

        -- Step 2 max_membership_fee_6
        MAX(
            CASE
                WHEN mp.terminated_on IS NOT NULL THEN 0

                WHEN e.id IN (32774, 32775) AND ma.membership_type_id IN (115) THEN 14 -- Tri for Cure, added 2/4/25, race director will be fulfilling the actual paymen at a later date

        -- Section 1: Pulls from order_products. This currently only contains memberships purchased through the website.
                WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  > 0) THEN (op.amount_per - op.discount - op.amount_refunded)
                WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  <= 0) THEN 0
                
        -- Section 2: Looks at registration audit. This will be for all membership purchased imported through API RTAV_Batch
                WHEN ra.registration_company_id IN (1) THEN 0 -- 'Designsensory'
                WHEN ra.registration_company_id IN (23) THEN 0 -- 'Acme-Usat'
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

                WHEN rama.price_paid BETWEEN 9.36 AND 9.86      THEN 9 -- JAN2025CHANGE $0.25 on either side of expected value based on 6.75% service fee
                WHEN rama.price_paid BETWEEN 14.70 AND 14.95    THEN 14 -- JAN2025CHANGE Needed to limit upper due to overlapping with previous $15
                WHEN rama.price_paid BETWEEN 22.17 AND 22.67    THEN 21 -- JAN2025CHANGE $0.25 on either side of expected value based on 6.75% service fee
                WHEN rama.price_paid BETWEEN 29.64 AND 29.95    THEN 28 -- JAN2025CHANGE Needed to limit upper due to overlapping wth previous $30
                WHEN rama.price_paid BETWEEN 68.07 AND 68.57    THEN 64 -- JAN2025CHANGE $0.25 on either side of expected value based on 6.75% service fee
                WHEN rama.price_paid BETWEEN 175.89 AND 176.39  THEN 165 -- JAN2025CHANGE $0.25 on either side of expected value based on 6.75% service fee
                WHEN rama.price_paid IS NOT NULL    THEN rama.price_paid

                WHEN mp.origin_flag = 'admin_bulk_uploader' AND ma.payment_type = 'ironman-ticketsocket' AND mp.membership_type_id IN (115) THEN 23
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND ma.payment_type = 'ironman-ticketsocket' AND mp.membership_type_id IN (112) THEN 60
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND ma.payment_type = 'ironman-ticketsocket' AND mp.membership_type_id IN (113) THEN 99

                /* BEGIN EP CHANGES 2/27/2025 */
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (115) AND mp.purchased_on >= '2025-01-01 00:00:00' AND mp.purchased_on < '2025-02-03 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN 23
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (115) AND mp.purchased_on >= '2025-02-03 00:00:00' AND mp.purchased_on < '2999-01-01 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN 28
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (112) AND mp.purchased_on >= '2025-01-01 00:00:00' AND mp.purchased_on < '2025-02-03 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN 60
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (112) AND mp.purchased_on >= '2025-02-03 00:00:00' AND mp.purchased_on < '2999-01-01 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN 64
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (119) AND mp.purchased_on >= '2025-01-01 00:00:00' AND mp.purchased_on < '2025-01-21 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN 150
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND mp.membership_type_id IN (119) AND mp.purchased_on >= '2025-01-21 00:00:00' AND mp.purchased_on < '2999-01-01 00:00:00' AND evbu.ironman_bulk_event_list IN (1) THEN 165
                /* END EP CHANGES 2/27/2025 */
                
                WHEN mp.origin_flag = 'admin_bulk_uploader' AND ma.payment_type != 'Chronotrack' AND ka.is_koz_acception IN (0) THEN 0
                WHEN mp.origin_flag = 'rtav_classic' THEN 0
                WHEN ma.payment_type = 'comped' THEN 0
                WHEN ma.payment_type = 'normal' AND mp.membership_type_id IN (74, 103) THEN 0 -- 'No Home Member ID' = 'Lifetime'
                WHEN ma.confirmation_code IS NULL
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
                    END IS NULL THEN 0

                WHEN mp.membership_type_id IN (2, 52, 65, 70, 73, 91, 93, 96, 98) THEN 100 -- 2year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) AND mp.purchased_on < '2024-06-04 12:00:00' THEN 135 -- 3year
                WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) THEN 180 -- 3year

                WHEN mp.membership_type_id IN (74, 103) THEN 1000 -- lifetime

                WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND ma.event_id IN (30785, 30768, 30770) THEN 0 -- one-day; //these events were comped

                WHEN ka.is_koz_acception IN (1) AND mp.membership_type_id IN (4, 51, 54, 61, 94) THEN 10 -- youth = youth annual; 'KOZ Acception' = 'KOZ'
                WHEN ka.is_koz_acception THEN 15 -- 'KOZ Acception' = 'KOZ'

                WHEN mp.membership_type_id IN (4, 51, 54, 61, 94) THEN 10 -- youth = youth annual

                WHEN mp.membership_type_id IN (112) AND mp.purchased_on < '2025-02-03 00:00:00' THEN 60 -- silver JAN2025CHANGE Added date logic
                WHEN mp.membership_type_id IN (113) AND mp.purchased_on < '2025-02-03 00:00:00' THEN 99 -- gold JAN2025CHANGE Added date logic
                WHEN mp.membership_type_id IN (115) AND mp.purchased_on < '2025-02-03 00:00:00' THEN 23 -- bronze JAN2025CHANGE Added date logic

                WHEN mp.membership_type_id IN (114) THEN 400 -- platinum team usa
                WHEN mp.membership_type_id IN (117) THEN 400 -- platinum foundation

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

                -- Begin Jan 2025 Section (Backstop)
                WHEN mp.membership_type_id = 112 AND mp.purchased_on >= '2025-02-03 00:00:00' THEN 64 -- JAN2025CHANGE Added in case we get some memberships coming through this far (likely bulk upload)
                WHEN mp.membership_type_id = 119 AND mp.purchased_on >= '2025-02-03 00:00:00' THEN 165 -- JAN2025CHANGE Added in case we get some memberships coming through this far (likely bulk upload)
                WHEN mp.membership_type_id IN (115) AND mp.purchased_on >= '2025-02-03 00:00:00' THEN 28 -- JAN2025CHANGE Added in case we get some memberships coming through this far (likely bulk upload)
                -- End Jan 2025 Section
                
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
        LEFT JOIN events AS e ON ma.event_id = e.id
        
        /* BEGIN EP CHANGES 2/27/25 */
        LEFT JOIN (
            SELECT 
                id 'event_id', 1 'ironman_bulk_event_list' 
            FROM events 
            WHERE sanctioning_event_id IN (310118,310159,310009,310187,310210,310248,310348,310278,310317,310323,310354,310714,310372,310356,310418,310357,310446,310408,310742,310419,310404,310420,310473,310424,310458,310507,310551,310552,310618,310536,310682,310603,310554,310704,310529,310725,310726,310762,310506,310970,310931,311092,350152,351065,350971,350406,350706,350720,350930,311684,311683,311682,350978,350536,350496,350410,350557,350363,350150,350177,311625,311599,350758,310542)
        ) evbu ON evbu.event_id = e.id
        /* END EP CHANGES 2/27/25 */
    
    GROUP BY ka.id_membership_periods
`;

// CODE PRIOR TO 022825
// const query_actual_membership_fee_6_logic = `
//     SELECT 
//         ka.id_membership_periods,
//         ka.source_2,
//         ka.is_koz_acception,
//         mp.membership_type_id AS membership_type_id_membership_periods,
//         -- real_membership_types
//         CASE
//             WHEN mp.membership_type_id IN (1, 2, 3, 52, 55, 60, 62, 64, 65, 66, 67, 68, 70, 71, 73, 74, 75, 85, 89, 91, 93, 96, 98, 99, 101, 103, 104, 112, 113, 114, 117, 119) THEN 'adult_annual'
//             WHEN mp.membership_type_id IN (4, 51, 54, 61, 94, 107) THEN 'youth_annual'
//             WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 'one_day'
//             WHEN mp.membership_type_id IN (56, 58, 81, 105) THEN 'club'
//             WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 'elite'
//             ELSE "other"
//         END AS real_membership_types,
//         mp.purchased_on,
//         mp.terminated_on, -- membership period terminated on IS NULL filtered out in the source_2 CTE query above

//         ma.payment_type AS payment_type_membership_applications,  
//         ra.registration_company_id,

//         op.cart_label AS cart_label_order_products,
//         op.amount_per AS amount_per_order_products,
//         op.discount AS discount_order_products,
//         op.amount_refunded AS amount_refunded_order_products,
//         (op.amount_per - op.discount - op.amount_refunded) AS ms_or_classic_fee_2,
//         ((op.amount_per - op.discount - op.amount_refunded)  > 0) AS ms_or_classic_fee_2_greater_than_zero,

//         rama.price_paid AS price_paid_registration_audit_membership_application,
//         rama.price_paid IS NOT NULL AS is_rama_price_paid_null,

//         -- Membership Fee 6
//         MAX(
//             CASE
//                 WHEN mp.terminated_on IS NOT NULL THEN 0 -- membership period terminated on ISNULL filtered in the source_2 CTE query above 

//                 WHEN events.id IN ('32774', '32775') AND mp.membership_type_id IN (115) THEN 14 -- tri for cure rule; sale is at $0 then race director is billed the membership fee; added 2/4/25

//                 -- elseif [Source] = "Membership System/RTAV Classic" then [MS or Classic Fee 2] // essentially does it have an Order ID
//                 -- [Source] 
//                     -- has a rule such that if not isnull([Cart Label]) then "Membership System/RTAV Classic"
//                 -- 'MS or Classic Fee 2' = if [Amount Per] - [Discount] - [Amount Refunded] > 0 then [Amount Per] - [Discount] - [Amount Refunded] else 0 END
//                     -- amount per = order_products.amount_per 
//                     -- Discount = order_products.discount
//                     -- Amount Refunded = order_products.amount_refunded   
//                     -- this rule applies the discount for the purchase of a one day then an annual
//                 WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  > 0) THEN (op.amount_per - op.discount - op.amount_refunded)
//                 WHEN op.cart_label IS NOT NULL AND ((op.amount_per - op.discount - op.amount_refunded)  <= 0) THEN 0
                
//                 WHEN ra.registration_company_id IN (1) THEN 0 -- "Designsensory"
//                 WHEN ra.registration_company_id IN (23) THEN 0 -- "Acme-Usat"

//                 -- 'RTAV Batch Fee'
//                 -- elseif [Source] = "RTAV Batch" then [RTAV Batch Fee] //essentially does it have an Audit ID
//                 -- [Source] is elseif not isnull([Price Paid]) then "RTAV Batch"
//                 -- WHEN rama.price_paid IS NOT NULL THEN 1
//                 WHEN rama.price_paid IN (6.41)      THEN 6
//                 WHEN rama.price_paid IN (10.68)     THEN 10
//                 WHEN rama.price_paid IN (13.88)     THEN 13
//                 WHEN rama.price_paid IN (16.01)     THEN 15
//                 WHEN rama.price_paid IN (19.22)     THEN 18
//                 WHEN rama.price_paid IN (24.55)     THEN 23
//                 WHEN rama.price_paid IN (32.03)     THEN 30
//                 WHEN rama.price_paid IN (38.43)     THEN 36
//                 WHEN rama.price_paid IN (42.70)     THEN 40
//                 WHEN rama.price_paid IN (53.38)     THEN 50
//                 WHEN rama.price_paid IN (64.05)     THEN 60
//                 WHEN rama.price_paid IN (105.68)    THEN 99  
//                 WHEN rama.price_paid IS NOT NULL    THEN rama.price_paid -- assigns 6, 13, 18, 23 et al as appropriate

//                 -- WHEN mp.origin_flag = "ADMIN_BULK_UPLOADER" AND ma.payment_type = "ironman-ticketsocket" THEN 23 -- remove 12/6/24 per Eric Passe replaced with below
//                 WHEN mp.origin_flag = 'admin_bulk_uploader' and ma.payment_type = 'ironman-ticketsocket' and mp.membership_type_id in (115) then 23
//                 WHEN mp.origin_flag = 'admin_bulk_uploader' and ma.payment_type = 'ironman-ticketsocket' and mp.membership_type_id in (112) then 60
//                 WHEN mp.origin_flag = 'admin_bulk_uploader' and ma.payment_type = 'ironman-ticketsocket' and mp.membership_type_id in (113) then 99

//                 -- 'KOZ Acception'
//                 WHEN mp.origin_flag = "ADMIN_BULK_UPLOADER" AND ma.payment_type != "Chronotrack" AND ka.is_koz_acception IN (0) THEN 0 -- ISNULL('KOZ Acception')
//                 WHEN mp.origin_flag = "RTAV_CLASSIC" THEN 0
//                 WHEN ma.payment_type = "comped" THEN 0
//                 WHEN ma.payment_type = "normal" AND mp.membership_type_id IN (74, 103) THEN 0 -- 'No Home Member ID' = "Lifetime"
//                 -- 'KOZ Acception' & coach recert
//                 WHEN
//                     ma.confirmation_code IS NULL        AND 
//                     ma.payment_type != "Chronotrack"    AND 
//                     ma.payment_type != "stripe"         AND 
//                     -- ISNULL('KOZ Acception')
//                     ka.is_koz_acception IN (0)          AND 
//                     -- ISNULL('Coach Recert')
//                     CASE        
//                         WHEN ma.payment_explanation LIKE '%recert%' THEN 'coach_recert'
//                         WHEN ma.payment_explanation LIKE '%cert%' THEN 'coach_recert'
//                         WHEN ma.payment_explanation LIKE '%coach%' THEN 'coach_recert'
//                         WHEN ma.payment_type LIKE '%stripe%' THEN 'coach_recert' -- 2024 forward
//                         ELSE NULL
//                     END IS NULL THEN 0
//                 WHEN mp.membership_type_id IN (2, 52, 65, 70, 73, 91, 93, 96, 98) THEN 100 -- 2year
//                 WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) AND mp.purchased_on < '2024-06-04 12:00:00' THEN 135 -- 3year
//                 WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) THEN 180 -- 3year
//                 WHEN mp.membership_type_id IN (74, 103) THEN 1000 -- lifetime
//                 WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND ma.event_id IN (30785, 30768, 30770) THEN 0 -- one-day; //these events were comped
//                 -- 'KOZ Acception'
//                 WHEN ka.is_koz_acception IN (1) AND mp.membership_type_id IN (4, 51, 54, 61, 94) THEN 10 -- youth = youth annual; 'KOZ Acception' = "KOZ"
//                 WHEN ka.is_koz_acception THEN 15 -- 'KOZ Acception' = "KOZ"
//                 WHEN mp.membership_type_id IN (4, 51, 54, 61, 94) THEN 10 -- youth = youth annual
//                 WHEN mp.membership_type_id IN (112) THEN 60 -- silver
//                 WHEN mp.membership_type_id IN (113) THEN 99 -- gold
//                 WHEN mp.membership_type_id IN (114) THEN 400 -- platinum team usa
//                 WHEN mp.membership_type_id IN (117) THEN 400 -- platinum foundation
//                 WHEN mp.membership_type_id IN (115) THEN 23 -- bronze
//                 WHEN ma.membership_type_id = 118 THEN 0 -- bronze
//                 WHEN mp.membership_type_id IN (107) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN 30 -- youth premier
//                 WHEN mp.membership_type_id IN (55) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN 40 -- young adult
//                 WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN 23  -- one day
//                 WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mp.purchased_on >= '2024-01-16 09:00:00' THEN 60 -- 1year
//                 WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) AND mp.purchased_on >= '2023-11-01 09:00:00' THEN 60 -- elite
//                 WHEN mp.membership_type_id IN (107) THEN 25 -- youth premier
//                 WHEN mp.membership_type_id IN (55) THEN 36 -- young adult
//                 WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) THEN 15 -- one day
//                 WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) THEN 50 -- 1 year
//                 WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 50 -- elite
//                 ELSE 0
//             END
//         ) AS max_membership_fee_6,

//         COUNT(mp.purchased_on)

//     FROM koz_acception AS ka
//         LEFT JOIN membership_applications AS ma ON ka.id_membership_periods = ma.membership_period_id
//         LEFT JOIN membership_periods AS mp ON ka.id_membership_periods = mp.id
//         LEFT JOIN registration_audit AS ra ON ka.id_membership_periods = ra.membership_period_id
//         LEFT JOIN order_products AS op ON ma.id = op.purchasable_id
//         LEFT JOIN registration_audit_membership_application AS rama ON ra.id = rama.audit_id
//         LEFT JOIN events ON ma.event_id = events.id

//     -- WHERE 
//         -- mp.terminated_on IS NULL
//         -- ma.payment_type = "ironman-ticketsocket"
//         -- ra.registration_company_id IN (1, 23)
//         -- op.cart_label IS NOT NULL
//         -- rama.price_paid IS NOT NULL
//         -- mp.membership_type_id IN (107) AND mp.purchased_on >= '2024-01-16 09:00:00' -- THEN 30
//         -- mp.membership_type_id IN (55) AND mp.purchased_on >= '2024-01-16 09:00:00' -- THEN 40

//         -- use case for bronze 6 relay beinnodg priced at $23; added rule above if rama.price_paid = 6 then price at 6
//         -- id_membership_periods IN (4698020, 4636868) 

//     GROUP BY ka.id_membership_periods
// `;

module.exports = { query_actual_membership_fee_6_logic };
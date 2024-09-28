const year = 2021;
const start_date = '2023-01-01 09:00:00';
const end_date = '2023-01-01 12:00:00';

const query_test_coaches_connection = `
   -- USE vapor;

   -- Coaches Consolidated Purchases 6
   -- { fixed [Member Number (Members)],[Created At Membership Periods],[Membership Type Id (Membership Periods)], [Sanctioning Event Id], [Payment Type], [Origin Flag (Membership Periods)], [Order Id], [Confirmation Code]: 
   -- max(if [Real Membership Types] != "One Day" AND isnull([Coach Recert]) then [Id (Membership Periods)] END)}

   -- SET @year = 2021;
   -- SET @start_date = '2023-01-01 09:00:00';
   -- SET @end_date = '2023-01-01 12:00:00';

   WITH membership_sales_coaches_purchase_6 AS (
      SELECT 
         members.member_number AS member_number_members,
         MAX(membership_periods.id) as max_membership_period_id,
         CASE
               WHEN membership_periods.membership_type_id IN (1, 2, 3, 52, 55, 60, 62, 64, 65, 66, 67, 68, 70, 71, 73, 74, 75, 85, 89, 91, 93, 96, 98, 99, 101, 103, 104, 112, 113, 114, 117) THEN 'adult_annual'
               WHEN membership_periods.membership_type_id IN (4, 51, 54, 61, 94, 107) THEN 'youth_annual'
               WHEN membership_periods.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 'one_day'
               WHEN membership_periods.membership_type_id IN (56, 58, 81, 105) THEN 'club'
               WHEN membership_periods.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 'elite'
               ELSE "other"
         END AS real_membership_types,
         
         DATE(membership_periods.created_at) AS created_at_membership_periods,

         YEAR(membership_periods.purchased_on) as purchased_on_year_membership_periods,

         membership_periods.starts AS starts,
         membership_periods.ends AS ends,
         membership_periods.membership_type_id AS membership_type_id_membership_periods,
         events.sanctioning_event_id AS sanctioning_event_id,
         membership_applications.payment_type AS payment_type,
         membership_periods.origin_flag AS origin_flag_membership_periods,
         membership_applications.race_type_id AS race_type_id,
         membership_applications.distance_type_id AS distance_type_id,
         order_products.order_id AS order_id,
         membership_applications.confirmation_code AS confirmation_code,
         membership_periods.membership_type_id
         -- ,
         -- coach recert
         -- if contains([Payment Explanation],"recert") or contains([Payment Explanation],"coach") or [Payment Type] = "stripe" then "Coach Recert" END
         -- membership_applications.payment_explanation,
         -- membership_applications.payment_explanation LIKE '%recert%',
         -- membership_applications.payment_explanation LIKE '%cert%',
         -- membership_applications.payment_explanation LIKE '%coach%', 
         -- membership_applications.payment_type LIKE '%stripe%',       
         -- (
         --     CASE        
         --         WHEN membership_applications.payment_explanation LIKE '%recert%' THEN 'coach_recert'
         --         WHEN membership_applications.payment_explanation LIKE '%cert%' THEN 'coach_recert'
         --         WHEN membership_applications.payment_explanation LIKE '%coach%' THEN 'coach_recert'
         --         WHEN membership_applications.payment_type LIKE '%stripe%' THEN 'coach_recert' -- 2024 forward
         --         ELSE NULL
         --     END 
         -- ) IS NULL AS coach_recert,
         -- membership_applications.payment_type LIKE '%stripe%' AS is_stripe_payment_type
         
      FROM membership_applications
         LEFT JOIN order_products ON (membership_applications.id = order_products.purchasable_id)
         LEFT JOIN orders ON (order_products.order_id = orders.id)
         LEFT JOIN registration_audit ON (membership_applications.membership_period_id = registration_audit.membership_period_id)
         LEFT JOIN registration_audit_membership_application ON (registration_audit.id = registration_audit_membership_application.audit_id)
         RIGHT JOIN membership_periods ON (membership_applications.membership_period_id = membership_periods.id)
         LEFT JOIN membership_types ON (membership_applications.membership_type_id = membership_types.id)
         RIGHT JOIN members ON (membership_periods.member_id = members.id)
         RIGHT JOIN profiles ON (members.memberable_id = profiles.id)
         LEFT JOIN users ON (profiles.user_id = users.id)
         LEFT JOIN events ON (membership_applications.event_id = events.id)
         LEFT JOIN transactions ON (orders.id = transactions.order_id)
         
      WHERE 
         -- #1 = TBD records for = 2021
         -- year(membership_periods.purchased_on) = ${year} -- todo: @year
         year(membership_periods.purchased_on) >= ${year} -- todo:
         -- #2 = TBD is allowable below; where purchased = 2021
         -- #3 = TBD; where purchased = 2021
         AND membership_periods.id NOT IN (4652554) 
         -- #4 = tbd; where purchased = 2021
         AND membership_periods.membership_type_id NOT IN (56, 58, 81, 105) 
         -- #5 = tbd; where purchased = 2021
         AND membership_periods.membership_type_id > 0
         -- #6 = tbd; where purchased = 2021
         AND membership_periods.terminated_on IS NULL
         -- #7 = tbd; where purchased = 2021
         AND membership_periods.ends >= '2022-01-01'

         -- GENERAL DATA CHECKS
         -- one day = 21, 521, 572, 3281
         -- annual = 9, 21, 24, 386, 406, 477, 521, 572
         -- AND members.member_number IN (2, 7, 9, 21, 24, 386, 406, 477, 521, 572, 3281)

         -- not a one_day membership
         AND 
         (
               CASE
                  WHEN membership_periods.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 1 -- 'one_day'
                  ELSE 0 
               END
         ) = 0
         
         -- coach_recert is null
         AND 
         (
               CASE        
                  WHEN membership_applications.payment_explanation LIKE '%recert%' THEN 'coach_recert'
                  WHEN membership_applications.payment_explanation LIKE '%cert%' THEN 'coach_recert'
                  WHEN membership_applications.payment_explanation LIKE '%coach%' THEN 'coach_recert'
                  WHEN membership_applications.payment_type LIKE '%stripe%' THEN 'coach_recert' -- 2024 forward
                  ELSE NULL
               END 
         ) IN ('coach_recert')
         -- is allowable
         AND 
         (CASE
               -- WHEN 'Created At (Membership Periods)' <= TIMESTAMP('2021-12-16 06:25:14') 
               WHEN membership_periods.created_at <= '2021-12-16 06:25:14'
                  -- AND Source = 'Membership System/RTAV Classic' 
                  AND CASE
                           WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
                           WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
                           WHEN membership_types.name IS NOT NULL THEN 'Other'
                           -- ELSE 'null' -- Optional, for cases where none of the conditions are met
                     END = 'Membership System/RTAV Classic'
                  -- AND Deleted IS NULL 
                  AND CASE
                           WHEN 
                              members.deleted_at IS NOT NULL OR 
                              membership_periods.deleted_at IS NOT NULL OR 
                              profiles.deleted_at IS NOT NULL OR 
                              users.deleted_at IS NOT NULL THEN 'deleted'
                           ELSE 'active'  -- You can use 'active' or another label based on your preference
                     END = 'active'
                  -- AND 'Captured and Processed' = 'C&P'            
                  AND CASE
                           WHEN transactions.captured = 1 AND transactions.processed = 1 THEN 'C&P'
                           ELSE 'Other'  -- You can use 'Other' or another label based on your preference
                     END = 'C&P'
                  -- AND 'Deleted At (Order Products)' IS NULL 
                  AND order_products.deleted_at IS NULL
                  -- AND 'Purchasable Type' = 'membership-application' 
                  AND order_products.purchasable_type IN ('membership-application')
               THEN 'Allowable'

               WHEN 
                  -- Source = 'Membership System/RTAV Classic' 
                  CASE
                     WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
                     WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
                     WHEN membership_types.name IS NOT NULL THEN 'Other'
                     -- ELSE 'null' -- Optional, for cases where none of the conditions are met
                  END = 'Membership System/RTAV Classic'
               --     AND Deleted IS NULL 
                  AND CASE
                           WHEN members.deleted_at IS NOT NULL OR 
                              membership_periods.deleted_at IS NOT NULL OR 
                              profiles.deleted_at IS NOT NULL OR 
                              users.deleted_at IS NOT NULL THEN 'deleted'
                           ELSE 'active'  -- You can use 'active' or another label based on your preference
                     END = 'active'
               --     AND 'Captured and Processed' = 'C&P'           
                  AND CASE
                           WHEN transactions.captured = 1 AND transactions.processed = 1 THEN 'C&P'
                           ELSE 'Other'  -- You can use 'Other' or another label based on your preference
                     END = 'C&P'
               --     AND 'Deleted At (Order Products)' IS NULL  
                  AND order_products.deleted_at IS NULL
               --     AND 'Purchasable Processed At' IS NOT NULL 
                  AND order_products.purchasable_processed_at IS NOT NULL
               --     AND 'Purchasable Type' = 'membership-application'
                  AND order_products.purchasable_type IN ('membership-application')
               THEN 'Allowable'

               WHEN 
                  -- 'Source' = 'RTAV Batch'
                  CASE
                     WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
                     WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
                     WHEN membership_types.name IS NOT NULL THEN 'Other'
                     -- ELSE 'null' -- Optional, for cases where none of the conditions are met
                  END = 'RTAV Batch'
                  --     AND 'Deleted' IS NULL
                  AND CASE
                           WHEN members.deleted_at IS NOT NULL OR 
                              membership_periods.deleted_at IS NOT NULL OR 
                              profiles.deleted_at IS NOT NULL OR 
                              users.deleted_at IS NOT NULL THEN 'deleted'
                           ELSE 'active'  -- You can use 'active' or another label based on your preference
                     END = 'active'
               THEN 'Allowable'

               WHEN 
                  -- 'Source' = 'Other' 
                  CASE
                     WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
                     WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
                     WHEN membership_types.name IS NOT NULL THEN 'Other'
                     -- ELSE 'null' -- Optional, for cases where none of the conditions are met
                  END = 'Other'
               --     AND 'Deleted' IS NULL
                  AND CASE
                           WHEN members.deleted_at IS NOT NULL OR 
                              membership_periods.deleted_at IS NOT NULL OR 
                              profiles.deleted_at IS NOT NULL OR 
                              users.deleted_at IS NOT NULL THEN 'deleted'
                           ELSE 'active'  -- You can use 'active' or another label based on your preference
                     END = 'active'
               THEN 'Allowable'

               WHEN 
                  -- 'Source' IS NULL
                  CASE
                     WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
                     WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
                     WHEN membership_types.name IS NOT NULL THEN 'Other'
                     -- ELSE 'null' -- Optional, for cases where none of the conditions are met
                  END IS NULL
                  --     AND 'Deleted' IS NULL
                  AND CASE
                           WHEN members.deleted_at IS NOT NULL OR 
                              membership_periods.deleted_at IS NOT NULL OR 
                              profiles.deleted_at IS NOT NULL OR 
                              users.deleted_at IS NOT NULL THEN 'deleted'
                           ELSE 'active'  -- You can use 'active' or another label based on your preference
                     END = 'active'
               THEN 'Allowable'

               ELSE 'Not Allowable'
         END) = "Allowable"

      GROUP BY 
         members.member_number,
         Date(membership_periods.created_at),
         membership_periods.starts,
         membership_periods.ends,
         membership_periods.membership_type_id ,
         events.sanctioning_event_id,
         membership_periods.origin_flag ,
         membership_applications.payment_type ,
         membership_applications.race_type_id ,
         membership_applications.distance_type_id ,
         order_products.order_id ,
         membership_applications.confirmation_code,
         membership_periods.membership_type_id,
         CASE
               WHEN membership_periods.membership_type_id IN (1, 2, 3, 52, 55, 60, 62, 64, 65, 66, 67, 68, 70, 71, 73, 74, 75, 85, 89, 91, 93, 96, 98, 99, 101, 103, 104, 112, 113, 114, 117) THEN 'adult_annual'
               WHEN membership_periods.membership_type_id IN (4, 51, 54, 61, 94, 107) THEN 'youth_annual'
               WHEN membership_periods.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 'one_day'
               WHEN membership_periods.membership_type_id IN (56, 58, 81, 105) THEN 'club'
               WHEN membership_periods.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 'elite'
               ELSE "other"
         END
      -- LIMIT 10      
   )

   -- GET ALL DETAILED RECORDS = ? for 2021
   -- SELECT * FROM one_day_sales_actual_member_fee
   -- SELECT * FROM membership_sales_coaches_purchase_6 ORDER BY member_number_members

   -- GET COUNT = ? for 2021
   -- SELECT
   --     COUNT(DISTINCT max_membership_period_id) as purchases
   -- FROM membership_sales_coaches_purchase_6

   -- PROVIDES MEMBER & MEMBER PERIOD GRANULAR LEVEL PRICE
   -- SELECT
   --     purchased_on_year_membership_periods,
   --     real_membership_types,
   --     member_number_members,
   --     max_membership_period_id,
   --     new_member_category_6,
   -- FROM membership_sales_coaches_purchase_6
   -- ORDER BY purchased_on_year_membership_periods

   -- GET COUNT BY YEAR = 
   SELECT
      purchased_on_year_membership_periods,
      FORMAT(COUNT(*), 0) AS total_count
   FROM membership_sales_coaches_purchase_6
   GROUP BY purchased_on_year_membership_periods WITH ROLLUP
   ORDER BY purchased_on_year_membership_periods     
   ;
`;

module.exports = { query_test_coaches_connection };
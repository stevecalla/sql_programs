// REVISED 2026-01-19 (prior file = src\queries\sales_data\archive\4_new_member_category_6_logic_011826.js)
const query_new_member_category_6_logic = `
    SELECT 
        mf.id_membership_periods AS id_membership_periods,
        mf.source_2 AS source_2,
        mf.is_koz_acception,
        mf.real_membership_types AS real_membership_types,
        mf.max_membership_fee_6 AS max_membership_fee_6,
        r.max_membership_fee_6_rule,

        CASE
            -- BRONZE
            -- NOTE: ONE DAY
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mp.purchased_on < '2024-01-16 09:00:00' THEN 'One Day - $15'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mp.purchased_on IS NULL AND mp.created_at < '2024-01-16 09:00:00' THEN 'One Day - $15'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND mf.max_membership_fee_6 IN (15) THEN 'One Day - $15' -- 'Actual Membership Fee 6'
            
            -- NOTE: NO CHARGE MEMBERSHIPS
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND mf.max_membership_fee_6 = 0 THEN 'Bronze - $0'
            WHEN mp.membership_type_id IN (120) THEN 'Bronze Community Membership'
            WHEN mp.membership_type_id IN (118) AND ma.membership_type_id = 118 THEN 'Bronze - AO' -- Bronze - Comp
            WHEN mp.membership_type_id IN (115) AND ma.membership_type_id = 118 THEN 'Bronze - AO' -- Bronze - Comp

            -- NOTE: SINGLE SPORT
            WHEN mp.membership_type_id (5, 46, 47, 72, 97, 100, 115) AND ma.race_type_id_ma = 7 THEN 'Bronze - Run' -- NOTE: NEW SINGLE SPORT CATEGORY 3/16/26
            WHEN mp.membership_type_id (5, 46, 47, 72, 97, 100, 115) AND ma.race_type_id_ma = 8 THEN 'Bronze - Swim' -- NOTE: NEW SINGLE SPORT CATEGORY 3/16/26
            WHEN mp.membership_type_id (5, 46, 47, 72, 97, 100, 115) AND ma.race_type_id_ma = 9 THEN 'Bronze - Bike' -- NOTE: NEW SINGLE SPORT CATEGORY 3/16/26
            
            -- NOTE: RELAY
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND ma.distance_type_id_ma IN (8) THEN 'Bronze - Relay'  -- NOTE: UPDATED 3/16/26
            -- NOTE: MODIFY AS ABOVE; CAN'T DELETE B/C THE REG COMPANY DEFAULT PRODUCT DOESN'T INCLUDE RACE TPE OR RACE DISTANCE
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND mf.max_membership_fee_6 IN (6, 9) THEN 'Bronze - Relay' 

            -- NOTE: SUPER SPRINT / SPRINT
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND ma.distance_type_id_ma IN (1) THEN 'Bronze - Super Sprint' -- NOTE: UPDATED 3/16/26
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND ma.distance_type_id_ma IN (2) THEN 'Bronze - Sprint' -- NOTE: UPDATED 3/16/26
            -- NOTE: MODIFY AS ABOVE; CAN'T DELETE B/C THE REG COMPANY DEFAULT PRODUCT DOESN'T INCLUDE RACE TPE OR RACE DISTANCE
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND mf.max_membership_fee_6 IN (13, 14, 14.99) THEN 'Bronze - Sprint'

            -- NOTE: INTERMEDIATE
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND ma.distance_type_id_ma IN (3) THEN 'Bronze - Intermediate' -- NOTE: UPDATED 3/16/26
            -- NOTE: MODIFY AS ABOVE; CAN'T DELETE B/C THE REG COMPANY DEFAULT PRODUCT DOESN'T INCLUDE RACE TPE OR RACE DISTANCE
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND mf.max_membership_fee_6 IN (18, 21, 24, 24.99) THEN 'Bronze - Intermediate'
            
            -- NOTE: LONG / ULTRA
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND ma.distance_type_id_ma IN (4) THEN 'Bronze - Long 70.3' -- NOTE: UPDATED 3/16/26
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND ma.distance_type_id_ma IN (5) THEN 'Bronze - Ultra 140.6' -- NOTE: UPDATED 3/16/26
            -- NOTE: MODIFY AS ABOVE; CAN'T DELETE B/C THE REG COMPANY DEFAULT PRODUCT DOESN'T INCLUDE RACE TPE OR RACE DISTANCE
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND mf.max_membership_fee_6 IN (23, 28, 34.99) THEN 'Bronze - Ultra'
            
            -- NOTE: CATCH ALL DISTANCE UPGRADE / CLUB
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115) AND mf.max_membership_fee_6 IN (5, 7, 8, 10, 12, 14, 15, 17, 19) THEN 'Bronze - Distance Upgrade'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) THEN 'Club'
            
            -- ANNUAL
            WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mp.purchased_on < '2024-01-16 09:00:00' THEN '1-Year $50'
            WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mp.purchased_on IS NULL AND mp.created_at < '2024-01-16 09:00:00' THEN '1-Year $50'

            WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104, 112) THEN 'Silver' 
            -- WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104, 112) AND mf.max_membership_fee_6 = 60 THEN 'Silver'

            WHEN mp.membership_type_id IN (113) THEN 'Gold'
            
            WHEN mp.membership_type_id IN (2, 52, 65, 70, 73, 91, 93, 96, 98) THEN '2-Year'
            WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) THEN '3-Year'

            WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 'Elite'
            WHEN mp.membership_type_id IN (121) THEN 'Elite 2-Year membership'

            WHEN mp.membership_type_id IN (114) THEN 'Platinum - Team USA'
            WHEN mp.membership_type_id IN (117) THEN 'Platinum - Foundation'

            WHEN mp.membership_type_id IN (74, 103) THEN 'Lifetime'

            WHEN mp.membership_type_id IN (4, 51, 54, 61, 94) THEN 'Youth Annual'
            WHEN mp.membership_type_id IN (107) AND mp.purchased_on < '2024-01-16 09:00:00' THEN 'Youth Premier - $25'
            WHEN mp.membership_type_id IN (107) AND mp.purchased_on IS NULL AND mp.created_at < '2024-01-16 09:00:00' THEN 'Youth Premier - $25'
            WHEN mp.membership_type_id IN (107) THEN 'Youth Premier - $30'
            -- WHEN mp.membership_type_id IN (107) AND mf.max_membership_fee_6 = 30 THEN 'Youth Premier - $30'
            
            -- YOUNG ADULT
            WHEN mp.membership_type_id IN (55) AND mp.purchased_on < '2024-01-16 09:00:00' THEN 'Young Adult - $36'
            WHEN mp.membership_type_id IN (55) AND mp.purchased_on IS NULL AND mp.created_at < '2024-01-16 09:00:00' THEN 'Young Adult - $36'
            WHEN mp.membership_type_id IN (55) THEN 'Young Adult - $40'
            WHEN mp.membership_type_id IN (55) AND mf.max_membership_fee_6 = 40 THEN 'Young Adult - $40'
            
            ELSE 'Unknown'

        END AS new_member_category_6,
        COUNT(*) AS count

    FROM actual_membership_fee_6 AS mf
        LEFT JOIN actual_membership_fee_6_rule AS r ON mf.id_membership_periods = r.id_membership_periods
        LEFT JOIN membership_applications AS ma ON mf.id_membership_periods = ma.membership_period_id
        LEFT JOIN membership_periods AS mp ON mf.id_membership_periods = mp.id

    GROUP BY mf.id_membership_periods
`;

module.exports = { query_new_member_category_6_logic };
const query_new_member_category_6_logic = 
`
    SELECT 
        mf.id_membership_periods AS id_membership_periods,
        mf.source_2 AS source_2,
        mf.is_koz_acception,
        mf.real_membership_types AS real_membership_types,
        mf.max_membership_fee_6 AS max_membership_fee_6,
        r.max_membership_fee_6_rule, -- todo: rule additional field

        -- new_member_category_6
        CASE
            WHEN mp.membership_type_id IN (2, 52, 65, 70, 73, 91, 93, 96, 98) THEN '2-Year'
            WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) THEN '3-Year'
            WHEN mp.membership_type_id IN (74, 103) THEN 'Lifetime'
            WHEN mp.membership_type_id IN (4, 51, 54, 61, 94) THEN 'Youth Annual'
            WHEN mp.membership_type_id IN (112) THEN 'Silver'
            WHEN mp.membership_type_id IN (113) THEN 'Gold'
            WHEN mp.membership_type_id IN (114) THEN 'Platinum - Team USA'
            WHEN mp.membership_type_id IN (117) THEN 'Platinum - Foundation'
            WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mf.max_membership_fee_6 = 60 THEN 'Silver' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mf.max_membership_fee_6 = 60 THEN 'Silver' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (107) AND mf.max_membership_fee_6 = 30 THEN 'Youth Premier - $30' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (55) AND mf.max_membership_fee_6 = 40 THEN 'Young Adult - $40' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (107) AND mp.purchased_on < '2024-01-16 09:00:00' THEN 'Youth Premier - $25'
            WHEN mp.membership_type_id IN (55) AND mp.purchased_on < '2024-01-16 09:00:00' THEN 'Young Adult - $36'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mp.purchased_on < '2024-01-16 09:00:00' THEN 'One Day - $15'
            WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mp.purchased_on < '2024-01-16 09:00:00' THEN '1-Year $50'
            WHEN mp.membership_type_id IN (107) AND mp.purchased_on IS NULL AND mp.created_at < '2024-01-16 09:00:00' THEN 'Youth Premier - $25'
            WHEN mp.membership_type_id IN (55) AND mp.purchased_on IS NULL AND mp.created_at < '2024-01-16 09:00:00' THEN 'Young Adult - $36'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mp.purchased_on IS NULL AND mp.created_at < '2024-01-16 09:00:00' THEN 'One Day - $15'
            WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) AND mp.purchased_on IS NULL AND mp.created_at < '2024-01-16 09:00:00' THEN '1-Year $50'
            WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 'Elite'
            WHEN mp.membership_type_id IN (107) THEN 'Youth Premier - $30'
            WHEN mp.membership_type_id IN (55) THEN 'Young Adult - $40'
            WHEN mp.membership_type_id IN (1, 60, 62, 64, 67, 71, 75, 104) THEN 'Silver'
            WHEN mp.membership_type_id IN (118) AND ma.membership_type_id = 118 THEN 'Bronze - AO'
            WHEN mp.membership_type_id IN (115) AND ma.membership_type_id = 118 THEN 'Bronze - AO'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 6 THEN 'Bronze - $6' -- 'Actual Membership Fee 6'
            
            WHEN events.id IN ('32774', '32775') AND mp.membership_type_id IN (115) THEN 'Bronze - $13' -- tri for cure rule; sale is at $0 then race director is billed the membership fee; added 2/4/25

            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 13 THEN 'Bronze - $13' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 15 THEN 'One Day - $15' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 18 THEN 'Bronze - $18' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 23 THEN 'Bronze - $23' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 0 THEN 'Bronze - $0' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 17 THEN 'Bronze - Distance Upgrade' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 5 THEN 'Bronze - Distance Upgrade' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 7 THEN 'Bronze - Distance Upgrade' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 10 THEN 'Bronze - Distance Upgrade' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (115) AND mf.max_membership_fee_6 = 12 THEN 'Bronze - Distance Upgrade' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 6 THEN 'Bronze - $6' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 13 THEN 'Bronze - $13' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 15 THEN 'One Day - $15' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 18 THEN 'Bronze - $18' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 23 THEN 'Bronze - $23' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 0 THEN 'Bronze - $0' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 17 THEN 'Bronze - Distance Upgrade' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 5 THEN 'Bronze - Distance Upgrade' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 7 THEN 'Bronze - Distance Upgrade' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) AND mf.max_membership_fee_6 = 10 THEN 'Bronze - Distance Upgrade' -- 'Actual Membership Fee 6'
            WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100) THEN 'Club'
            ELSE 'Unknown'
        END AS new_member_category_6,
        COUNT(*) AS count

    FROM actual_membership_fee_6 AS mf
        LEFT JOIN actual_membership_fee_6_rule AS r ON mf.id_membership_periods = r.id_membership_periods -- todo: rule additional field
        LEFT JOIN membership_applications AS ma ON mf.id_membership_periods = ma.membership_period_id
        LEFT JOIN membership_periods AS mp ON mf.id_membership_periods = mp.id
        LEFT JOIN events ON ma.event_id = events.id

    GROUP BY mf.id_membership_periods

`;

module.exports = { query_new_member_category_6_logic };
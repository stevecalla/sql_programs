function query_slack_sales_data() {
    return `
        SELECT 
            DATE_FORMAT(DATE(CONVERT_TZ(mp.purchased_on, '+00:00', '-07:00')), '%Y-%m-%d') AS purchased_on_mtn,
            CASE
                WHEN mp.origin_flag IS NULL THEN 'direct'
                WHEN mp.origin_flag IN ('SUBSCRIPTION_RENEWAL') THEN 'sub'
                WHEN mp.origin_flag IN ('ADMIN_BULK_UPLOADER') THEN 'bulk'
                WHEN mp.origin_flag IN ('AUDIT_API') THEN 'audit'
                WHEN mp.origin_flag IN ('RTAV_CLASSIC') THEN 'rtav'
                ELSE 'other'
            END AS origin_flag_category,
            
            -- Combined logic for adult_annual
            CAST(SUM(CASE 
                WHEN mp.membership_type_id IN (1, 2, 3, 52, 55, 60, 62, 64, 65, 66, 67, 68, 70, 71, 73, 74, 75, 85, 89, 91, 93, 96, 98, 99, 101, 103, 104, 112, 113, 114, 117, 119)
                    OR mp.membership_type_id IN (56, 58, 81, 105) -- club
                THEN 1 ELSE 0 END) AS UNSIGNED) AS 'Adult',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'One Day',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (4, 51, 54, 61, 94, 107) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'Youth',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'Elite',

            CAST(SUM(CASE WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) THEN 1 ELSE 0 END) AS UNSIGNED) AS '3-Year',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (112) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'Silver',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (113) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'Gold',
            CAST(SUM(CASE 
                WHEN mp.membership_type_id NOT IN (3, 66, 68, 85, 89, 99, 119, 112, 113) 
                THEN 1 ELSE 0 END) AS UNSIGNED) AS 'Other',

            CAST(COUNT(mp.id) AS UNSIGNED) AS 'Total',

            -- for some reason utc returns 7 hours ahead of utc via node query but not in mysql thus subtract 7
            DATE_SUB(NOW(), INTERVAL 7 HOUR) AS queried_at_utc,
            -- for some reason utc returns 7 hours ahead of utc via node query but not in mysql thus subtract 14
            DATE_SUB(NOW(), INTERVAL 14 HOUR) AS queried_at_mtn 


        FROM membership_periods AS mp
        WHERE DATE(CONVERT_TZ(mp.purchased_on, '+00:00', '-07:00')) >= '2024-11-22'
        GROUP BY DATE(CONVERT_TZ(mp.purchased_on, '+00:00', '-7:00')), 2;
    `;
}

module.exports = {
    query_slack_sales_data,
}
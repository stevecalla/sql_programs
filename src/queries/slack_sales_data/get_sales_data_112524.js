function query_slack_sales_data() {
    return `
        SELECT 
            IFNULL(CAST(DATE(purchased_on) AS CHAR), 'Total') AS purchase_on,
            
            -- Combined logic for adult_annual
            CAST(SUM(CASE 
                WHEN mp.membership_type_id IN (1, 2, 3, 52, 55, 60, 62, 64, 65, 66, 67, 68, 70, 71, 73, 74, 75, 85, 89, 91, 93, 96, 98, 99, 101, 103, 104, 112, 113, 114, 117, 119)
                    OR mp.membership_type_id IN (56, 58, 81, 105) -- club
                THEN 1 ELSE 0 END) AS UNSIGNED) AS 'adult',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'one_day',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (4, 51, 54, 61, 94, 107) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'youth',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'elite',

            CAST(SUM(CASE WHEN mp.membership_type_id IN (3, 66, 68, 85, 89, 99, 119) THEN 1 ELSE 0 END) AS UNSIGNED) AS '3-yyear',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (112) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'silver',
            CAST(SUM(CASE WHEN mp.membership_type_id IN (113) THEN 1 ELSE 0 END) AS UNSIGNED) AS 'gold',
            CAST(SUM(CASE 
                WHEN mp.membership_type_id NOT IN (3, 66, 68, 85, 89, 99, 119, 112, 113) 
                THEN 1 ELSE 0 END) AS UNSIGNED) AS 'other',

            CAST(COUNT(mp.id) AS UNSIGNED) AS 'total',
             CONVERT_TZ(NOW(), '+00:00', '-07:00') AS queried_at
        FROM membership_periods AS mp
        WHERE DATE(mp.purchased_on) >= '2024-11-25'
        GROUP BY DATE(purchased_on) WITH ROLLUP;
    `;
}

module.exports = {
    query_slack_sales_data,
}
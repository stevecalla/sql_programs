const query_annual_sales_units_logic = 
`
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
    ) IS NULL
`;

module.exports = { query_annual_sales_units_logic };
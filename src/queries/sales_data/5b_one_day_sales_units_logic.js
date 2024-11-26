const query_one_day_sales_units_logic = 
`
    AND (
        CASE 
            WHEN membership_periods.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 1
            ELSE 0 
        END ) = 1 -- one_day only
`;

module.exports = { query_one_day_sales_units_logic };
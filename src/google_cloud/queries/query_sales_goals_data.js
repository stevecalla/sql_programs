const query_sales_goals_data = `
    SELECT 
        -- purchased_on_year_adjusted_mp
        purchased_on_month_adjusted_mp_desc
    FROM usat_sales_db.sales_goal_data;
    -- LIMIT 100;
`;

module.exports = {
    query_sales_goals_data
}
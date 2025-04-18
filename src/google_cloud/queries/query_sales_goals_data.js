// const query_sales_goals_data = `
//     SELECT 
//         -- purchased_on_year_adjusted_mp
//         purchased_on_month_adjusted_mp_desc
//     FROM usat_sales_db.sales_goal_data;
//     -- LIMIT 100;
// `;

async function query_sales_goals_data(batch_size = 10, offset = 0) {
    return `
        SELECT 
            -- purchased_on_year_adjusted_mp
            purchased_on_month_adjusted_mp_desc
        FROM usat_sales_db.sales_goal_data
        ORDER BY purchased_on_month_adjusted_mp_desc
        LIMIT ${batch_size} OFFSET ${offset}
        -- LIMIT 100
        ;
    `;
};

module.exports = {
    query_sales_goals_data
}
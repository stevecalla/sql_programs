async function query_sales_goals_data(batch_size = 10, offset = 0) {
    return `
        SELECT 
            purchased_on_year_adjusted_mp,
            purchased_on_month_adjusted_mp,
            purchased_on_month_adjusted_mp_desc,

            is_current_month,
            real_membership_types_sa,
            new_member_category_6_sa,

            sales_revenue,
            sales_units,
            rev_per_unit,

            revenue_2024,
            units_2024,
            rev_per_unit_2024,
            
            DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at

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
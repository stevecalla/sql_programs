const derived_fields = `
  purchased_on_year_adjusted_mp INT,
  purchased_on_month_adjusted_mp INT,
  purchased_on_month_adjusted_mp_desc VARCHAR(50),
  is_current_month BOOLEAN,
  real_membership_types_sa VARCHAR(50),
  new_member_category_6_sa VARCHAR(50),
  sales_revenue DECIMAL(10,2),
  sales_units INT, 
  rev_per_unit DECIMAL(10,2),
  revenue_2024 DECIMAL(10,2),
  units_2024 INT,
  rev_per_unit_2024	 DECIMAL(10,2),
  created_at DATE
`;

const index_fields = `
`;

async function query_create_sales_goal_table(table_name) {

  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${derived_fields}
    );
  `;

  return query;
}

module.exports = {
  query_create_sales_goal_table,
}
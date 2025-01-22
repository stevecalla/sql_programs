  const derived_fields = `
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
      @created_at

  `;

  const transform_fields = `
      -- CONVERTS '1969-01-13 00:00:00' TO '1969-01-13'
      created_at = CASE
          WHEN @created_at IS NOT NULL AND @created_at != 'Invalid Date' THEN
              STR_TO_DATE(@created_at, '%Y-%m-%d')
          ELSE
              NULL
      END
  `;

  // "C:\ProgramData\MySQL\MySQL Server 8.0\Uploads\data\usat_sales_goal_data\2025_sales_model_010325_v7_big_query.csv"
  function query_load_sales_goal_data(filePath, table) {
    return `
      LOAD DATA LOCAL INFILE '${filePath}'
      INTO TABLE ${table}
      FIELDS TERMINATED BY ','
      ENCLOSED BY '"'
      LINES TERMINATED BY '\\n'
      IGNORE 1 LINES
      -- REMOVES HEADER & ROW WITH ALL NULLS DUE TO RIGHT JOINS
      -- IGNORE 2 LINES
      (
        ${derived_fields}
      )   
        SET 
          ${transform_fields};
    `
  }

  module.exports = {
    query_load_sales_goal_data,
  };
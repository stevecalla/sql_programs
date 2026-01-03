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
      created_at = CASE
        WHEN @created_at IS NULL THEN NULL
        WHEN TRIM(@created_at) = '' THEN NULL
        WHEN LOWER(TRIM(@created_at)) IN ('null', 'invalid date') THEN NULL

        -- If Excel exported a serial day number (e.g., 45658)
        WHEN TRIM(@created_at) REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN
          DATE_ADD('1899-12-30', INTERVAL FLOOR(TRIM(@created_at)) DAY)

        ELSE
          COALESCE(
            -- Excel 4-digit year: 1/3/2025
            STR_TO_DATE(TRIM(@created_at), '%c/%e/%Y'),
            -- Excel short year: 1/3/25
            STR_TO_DATE(TRIM(@created_at), '%c/%e/%y'),
            STR_TO_DATE(TRIM(@created_at), '%Y-%m-%d %H:%i:%s'),
            STR_TO_DATE(TRIM(@created_at), '%Y-%m-%d')
          )
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
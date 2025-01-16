const derived_fields = `
    purchased_on_year_adjusted_mp,
    purchased_on_month_adjusted_mp,
    purchased_on_month_adjusted_mp_desc,
    is_current_month,
    real_membership_types_sa,
    new_member_category_6_sa,
    sales_revenue,
    sales_units, 
    rev_per_unit
`;

// "C:\ProgramData\MySQL\MySQL Server 8.0\Uploads\data\usat_sales_goal_data\2025_sales_model_010325_v7_big_query.csv"
function query_load_sales_goal_data(filePath, table) {
  return `
    LOAD DATA LOCAL INFILE '${filePath}'
    INTO TABLE ${table}
    FIELDS TERMINATED BY ','
    ENCLOSED BY '"'
    LINES TERMINATED BY '\\n'
    -- todo:
    IGNORE 1 LINES
    -- REMOVES HEADER & ROW WITH ALL NULLS DUE TO RIGHT JOINS
    -- IGNORE 2 LINES
    (
      ${derived_fields}
    ) 
  `
  }
    
  module.exports = {
    query_load_sales_goal_data,
  };
  const derived_fields = `
      state_id,	
      region_code,
      state_name,	
      state_code,	
      region_name,
      region_abbr,
      @created_at
  `;

  const transform_fields = `
      -- CONVERTS TO '1969-01-13'
      created_at = CASE
          WHEN @created_at IS NOT NULL AND @created_at != 'Invalid Date' THEN
              STR_TO_DATE(@created_at, '%Y-%m-%d')
          ELSE
              NULL
      END
  `;

  // "C:\ProgramData\MySQL\MySQL Server 8.0\Uploads\data\usat_sales_goal_data\2025_sales_model_010325_v7_big_query.csv"
  function query_load_region_data(filePath, table) {
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
    query_load_region_data,
  };
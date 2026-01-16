const members_sales_actual_vs_goal_schema = [
    // SALES GOAL DATA
    {
      name: "year_goal",
      type: "INTEGER",
      mode: "NULLABLE",
      description: "The goal year.",
      fields: []
    },
    {
      name: "month_goal",
      type: "INTEGER",
      mode: "NULLABLE",
      description: "The goal month (1-12).",
      fields: []
    },
    {
      name: "type_goal",
      type: "STRING",
      mode: "NULLABLE",
      description: "The goal membership type.",
      fields: []
    },
    {
      name: "category_goal",
      type: "STRING",
      mode: "NULLABLE",
      description: "The goal member category.",
      fields: []
    },
    {
      name: "sales_rev_2025_goal",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "The 2025 goal revenue.",
      fields: []
    },
    {
      name: "sales_rev_2024_goal",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "The 2024 goal revenue.",
      fields: []
    },
    {
      name: "sales_units_2025_goal",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "The 2025 goal units.",
      fields: []
    },
    {
      name: "sales_units_2024_goal",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "The 2024 goal units.",
      fields: []
    },
    {
      name: "rev_per_unit_2025_goal",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Revenue per unit for the 2025 goal.",
      fields: []
    },
    {
      name: "rev_per_unit_2024_goal",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Revenue per unit for the 2024 goal.",
      fields: []
    },
  
    // SALES ACTUAL DATA
    {
      name: "month_actual",
      type: "INTEGER",
      mode: "NULLABLE",
      description: "The actual sales month.",
      fields: []
    },
    {
      name: "quarter_actual",
      type: "INTEGER",
      mode: "NULLABLE",
      description: "The actual sales quarter.",
      fields: []
    },
    {
      name: "year_actual",
      type: "INTEGER",
      mode: "NULLABLE",
      description: "The actual sales year.",
      fields: []
    },
    {
      name: "is_current_month",
      type: "BOOLEAN",
      mode: "NULLABLE",
      description: "The current month.",
      fields: []
    },
    {
      name: "is_year_to_date",
      type: "BOOLEAN",
      mode: "NULLABLE",
      description: "The year to date.",
      fields: []
    },

    // SEGMENTS
    {
      name: "type_actual",
      type: "STRING",
      mode: "NULLABLE",
      description: "The actual membership type.",
      fields: []
    },
    {
      name: "category_actual",
      type: "STRING",
      mode: "NULLABLE",
      description: "The actual member category.",
      fields: []
    },
    {
      name: "category_sort_order_actual",
      type: "INTEGER",
      mode: "NULLABLE",
      description: "The category sort order.",
      fields: []
    },

    // METRICS
    {
      name: "sales_rev_2025_actual",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "The actual revenue in 2025.",
      fields: []
    },
    {
      name: "sales_rev_2024_actual",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "The actual revenue in 2024.",
      fields: []
    },
    {
      name: "sales_units_2025_actual",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "The actual units in 2025.",
      fields: []
    },
    {
      name: "sales_units_2024_actual",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "The actual units in 2024.",
      fields: []
    },
    {
      name: "rev_per_unit_2025_actual",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Revenue per unit for the 2025 actuals.",
      fields: []
    },
    {
      name: "rev_per_unit_2024_actual",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Revenue per unit for the 2024 actuals.",
      fields: []
    },
  
    // ABSOLUTE DIFFERENCE = GOAL VS 2025 ACTUALS
    {
      name: "goal_v_actual_rev_diff_abs",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Absolute difference in revenue between 2025 goal and actual.",
      fields: []
    },
    {
      name: "goal_v_actual_units_diff_abs",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Absolute difference in units between 2025 goal and actual.",
      fields: []
    },
    {
      name: "goal_v_actual_rev_per_unit_diff_abs",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Absolute difference in revenue per unit between 2025 goal and actual.",
      fields: []
    },
  
    // ABSOLUTE DIFFERENCE = 2025 ACTUALS VS 2024 ACTUALS
    {
      name: "2025_v_2024_rev_diff_abs",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Absolute revenue difference between 2025 and 2024 actuals.",
      fields: []
    },
    {
      name: "2025_v_2024_units_diff_abs",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Absolute units difference between 2025 and 2024 actuals.",
      fields: []
    },
    {
      name: "2025_v_2024_rev_per_unit_diff_abs",
      type: "FLOAT",
      mode: "NULLABLE",
      description: "Absolute difference in revenue per unit between 2025 and 2024 actuals.",
      fields: []
    },
  
    // Created at timestamps
    {
      name: "created_at_mtn",
      type: "STRING",
      mode: "NULLABLE",
      description: "The creation timestamp in Mountain Time (formatted as YYYY-MM-DD HH:MM:SS).",
      fields: []
    },
    {
      name: "created_at_utc",
      type: "STRING",
      mode: "NULLABLE",
      description: "The creation timestamp in UTC (formatted as YYYY-MM-DD HH:MM:SS).",
      fields: []
    }
  ];
  
// console.log(members_sales_actual_vs_goal_schema.length);

module.exports = {
    members_sales_actual_vs_goal_schema,
}

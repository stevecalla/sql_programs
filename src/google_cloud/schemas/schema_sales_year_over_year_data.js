const members_sales_year_over_year_schema = [
    {
        "name": "common_purchased_on_date_adjusted",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "The common adjusted purchase date in YYYY-MM-DD format.",
        "fields": []
    },
    {
        "name": "combined_date_field",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "A combined date field indicating the current and prior year dates with day abbreviations.",
        "fields": []
    },
    {
        "name": "current_year_date",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "The current year purchase date in YYYY-MM-DD format.",
        "fields": []
    },
    {
        "name": "current_year_day_of_week",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "The day of the week for the current year date.",
        "fields": []
    },
    {
        "name": "prior_year_date",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "The prior year purchase date in YYYY-MM-DD format.",
        "fields": []
    },
    {
        "name": "prior_year_day_of_week",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "The day of the week for the prior year date.",
        "fields": []
    },
    {
        "name": "real_membership_types_sa",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "The membership type.",
        "fields": []
    },
    {
        "name": "new_member_category_6_sa",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "The category for members.",
        "fields": []
    },
    {
        "name": "origin_flag_ma",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "The origin flag.",
        "fields": []
    },
    {
        "name": "origin_flag_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "The category of the origin flag.",
        "fields": []
    },
    {
        "name": "member_created_at_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "The category indicating when the member was created.",
        "fields": []
    },
    {
        "name": "revenue_current",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The revenue for the current year.",
        "fields": []
    },
    {
        "name": "revenue_prior",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The revenue for the prior year.",
        "fields": []
    },
    {
        "name": "revenue_diff_abs",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The absolute difference in revenue between the current and prior years.",
        "fields": []
    },
    {
        "name": "revenue_diff_pct",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The percentage difference in revenue between the current and prior years.",
        "fields": []
    },
    {
        "name": "units_current_year",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The units for the current year.",
        "fields": []
    },
    {
        "name": "units_prior_year",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The units for the prior year.",
        "fields": []
    },
    {
        "name": "units_diff_abs",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The absolute difference in units between the current and prior years.",
        "fields": []
    },
    {
        "name": "units_diff_pct",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The percentage difference in units between the current and prior years.",
        "fields": []
    },
    {
        "name": "rev_per_unit_current_year",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The revenue per unit for the current year.",
        "fields": []
    },
    {
        "name": "rev_per_unit_prior_year",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The revenue per unit for the prior year.",
        "fields": []
    },
    {
        "name": "rev_per_unit_diff_abs",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The absolute difference in revenue per unit between the current and prior years.",
        "fields": []
    },
    {
        "name": "rev_per_unit_diff_pct",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The percentage difference in revenue per unit between the current and prior years.",
        "fields": []
    },
    {
        "name": "created_at_mtn",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "The creation date in Mountain Time (MTN) in YYYY-MM-DD format.",
        "fields": []
    },
    {
        "name": "created_at_utc",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "The creation date in UTC in YYYY-MM-DD format.",
        "fields": []
    }
];

console.log(members_sales_year_over_year_schema.length);

module.exports = {
    members_sales_year_over_year_schema,
}

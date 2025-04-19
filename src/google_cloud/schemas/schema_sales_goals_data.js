const members_sales_goals_schema = [
    {
        "name": "purchased_on_year_adjusted_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "The adjusted purchase year for the membership.",
        "fields": []
    },
    {
        "name": "purchased_on_month_adjusted_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "The adjusted purchase month for the membership.",
        "fields": []
    },
    {
        "name": "purchased_on_month_adjusted_mp_desc",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "The month name or label for the adjusted purchase month.",
        "fields": []
    },
    {
        "name": "is_current_month",
        "mode": "NULLABLE",
        "type": "BOOLEAN",
        "description": "Indicates whether the purchase occurred in the current month.",
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
        "description": "The membership category.",
        "fields": []
    },
    {
        "name": "sales_revenue",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The total sales revenue for the given period.",
        "fields": []
    },
    {
        "name": "sales_units",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "The number of units sold for the given period.",
        "fields": []
    },
    {
        "name": "rev_per_unit",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "Revenue per unit for the given period.",
        "fields": []
    },
    {
        "name": "revenue_2024",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "Revenue generated in the year 2024.",
        "fields": []
    },
    {
        "name": "units_2024",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "Number of units sold in 2024.",
        "fields": []
    },
    {
        "name": "rev_per_unit_2024",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "Revenue per unit in 2024.",
        "fields": []
    },
    {
        "name": "created_at",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "The creation date in MTN in YYYY-MM-DD format.",
        "fields": []
    }
];

// console.log(members_sales_goals_schema.length);

module.exports = {
    members_sales_goals_schema,
}

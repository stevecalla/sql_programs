const members_sales_goals_schema = [
    {
        "name": "common_purchased_on_date_adjusted",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "The common adjusted purchase date in YYYY-MM-DD format.",
        "fields": []
    },
];

// console.log(members_sales_year_over_year_schema.length);

module.exports = {
    members_sales_goals_schema,
}

const members_schema = [
    {
        "name": "member_number_members_sa",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "id_profiles",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "origin_flag_ma",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "origin_flag_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "created_at_mp",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "2025-01-24 15:00:39",
        "fields": []
    },
    {
        "name": "created_at_date_mp",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "id_membership_periods_sa",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "real_membership_types_sa",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "new_member_category_6_sa",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "purchased_on_mp",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "purchased_on_date_mp",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "purchased_on_year_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "purchased_on_quarter_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "purchased_on_month_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "purchased_on_adjusted_mp",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },{
        "name": "purchased_on_date_adjusted_mp",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "purchased_on_year_adjusted_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "purchased_on_quarter_adjusted_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "purchased_on_month_adjusted_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "starts_mp",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "starts_year_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "starts_quarter_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "starts_month_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "ends_mp",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "ends_year_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "ends_quarter_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "ends_month_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "member_min_created_at",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": null,
        "fields": []
    },
    {
        "name": "member_min_created_at_year",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "member_min_created_at_quarter",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "member_min_created_at_month",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },{
        "name": "member_created_at_years_out",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "member_created_at_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_purchase_date",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_prior_purchase_date",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_mp_ends_date",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_prior_mp_ends_date",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "member_lapsed_renew_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_prior_purchase_membership_type",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_prior_purchase_membership_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "member_upgrade_downgrade_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "member_upgrade_downgrade_major",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "member_lifetime_purchases",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "member_lifetime_frequency",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "member_first_purchase_year",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "member_first_purchase_years_out",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "member_first_purchase_year_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },{
        "name": "date_of_birth_profiles",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "date_of_birth_year_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "date_of_birth_quarter_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "date_of_birth_month_mp",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "age_now",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "age_now_bin",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "age_as_of_sale_date",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "age_as_sale_bin",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "age_at_end_of_year",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "age_as_year_end_bin",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "id_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "id_sanctioning_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "event_type_id_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "cleaned_name_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_events_lower",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "created_at_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "created_at_month_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "created_at_quarter_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "created_at_year_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "starts_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "starts_month_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "starts_quarter_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "starts_year_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "ends_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "ends_month_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "ends_quarter_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "ends_year_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "status_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "race_director_id_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "last_season_event_id",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "sales_units",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "sales_revenue",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": null,
        "fields": []
    },
    {
        "name": "actual_membership_fee_6_rule_sa",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    }, 
    // could not get this field to load in BQ
    // {
    //     "name": "city_member",
    //     "mode": "NULLABLE",
    //     "type": "STRING",
    //     "description": null,
    //     "fields": []
    // },          
    {
        "name": "postal_code_member",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "lng_member",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "lat_member",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "state_code_member",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "country_code_member",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "region_name_member",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "region_abbr_member",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "address_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "city_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },

    {
        "name": "zip_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "state_code_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "country_code_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "region_name_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "region_abbr_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },

    // OTHER
    {
        "name": "created_at_ma",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "order_id_orders_products",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "id_registration_audit",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "confirmation_number_registration_audit",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_registration_companies",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },

    // CREATED AT DATES
    {
        "name": "created_at_mtn",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "created_at_utc",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "date '2024-02-12'",
        "fields": []
    }
]

// console.log(members_schema.length);

module.exports = {
    members_schema,
}

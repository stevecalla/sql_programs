const {
    join_members_profiles_users,
    join_membership_applications,
    join_orders_transactions,
    join_races,
    join_registration_audit,
    join_metadata_addresses,
    join_metadata_events,
    join_metadata_event_types,
    join_metadata_membership_types,
    join_metadata_registration_companies,
} = require('./join_library_080325');

const derived_fields = `
    -- ALL FIELDS / ONE DAY SALES / ACTUAL MEMBER FEE TABLE (CTE)
    -- sa = sales actual
    sa.member_number_members AS member_number_members_sa,
    sa.max_membership_period_id AS id_membership_periods_sa,

    -- DERIVED FIELDS
    sa.real_membership_types AS real_membership_types_sa,
    sa.new_member_category_6 AS new_member_category_6_sa,
    sa.max_membership_fee_6 AS actual_membership_fee_6_sa,
    sa.max_membership_fee_6_rule AS actual_membership_fee_6_rule_sa,
    sa.source_2 AS source_2_sa,
    sa.is_koz_acception AS is_koz_acception_sa
`;

const addresses_table = `
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(addresses.city, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS city_addresses,
    addresses.postal_code AS postal_code_addresses,
    addresses.lng AS lng_addresses,
    addresses.lat AS lat_addresses,
    addresses.state_code AS state_code_addresses,
    addresses.country_code AS country_code_addresses
`;

const events_table = `
    -- EVENTS TABLE
    events.id AS id_events,

    events.sanctioning_event_id AS id_sanctioning_events,

    -- CASE 
    --     WHEN races.designation IS NOT NULL AND races.designation != '' 
    --         THEN CONCAT(events.sanctioning_event_id, '-', races.designation)
    --     ELSE events.sanctioning_event_id
    -- END AS id_sanctioning_events_and_type,
    CASE 
        WHEN races.designation IS NOT NULL AND races.designation != '' THEN CONCAT(events.sanctioning_event_id, '-', races.designation)
        WHEN events.event_type_id = 1 THEN CONCAT(events.sanctioning_event_id, '-', 'Adult Race')
        WHEN events.event_type_id = 2 THEN CONCAT(events.sanctioning_event_id, '-', 'Adult Clinic')
        WHEN events.event_type_id = 3 THEN CONCAT(events.sanctioning_event_id, '-', 'Youth Race')
        WHEN events.event_type_id = 4 THEN CONCAT(events.sanctioning_event_id, '-', 'Youth Clinic')
        ELSE events.sanctioning_event_id
    END AS id_sanctioning_events_and_type,

    events.event_type_id AS event_type_id_events,

    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(events.name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS name_events,

    CONCAT('"', 
    REPLACE(
        REPLACE(
            REPLACE(SUBSTRING(events.address, 1, 255), '''', ''), 
            '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS address_events,
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(events.city, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS city_events,
    events.zip AS zip_events,
    events.state_code AS state_code_events,
    events.country_code AS country_code_events,
    
    events.created_at AS created_at_events,
    MONTH(events.created_at) AS created_at_month_events,
    QUARTER(events.created_at) AS created_at_quarter_events,
    YEAR(events.created_at) AS created_at_year_events,

    events.starts AS starts_events,
    MONTH(events.starts) AS starts_month_events,
    QUARTER(events.starts) AS starts_quarter_events,
    YEAR(events.starts) AS starts_year_events,

    events.ends AS ends_events,
    MONTH(events.ends) AS ends_month_events,
    QUARTER(events.ends) AS ends_quarter_events,
    YEAR(events.ends) AS ends_year_events,

    events.status AS status_events,

    events.race_director_id AS race_director_id_events,
    events.last_season_event_id AS last_season_event_id
`;

const event_types_table = `
    -- EVENT TYPES TABLE
    event_types.id AS id_event_types,
    events.event_type_id AS id_event_type_events,
    CASE
        WHEN races.designation IS NOT NULL THEN races.designation
        WHEN races.designation IS NULL AND events.event_type_id = 1 THEN 'Adult Race'
        WHEN races.designation IS NULL AND events.event_type_id = 2 THEN 'Adult Clinic'
        WHEN races.designation IS NULL AND events.event_type_id = 3 THEN 'Youth Race'
        WHEN races.designation IS NULL AND events.event_type_id = 4 THEN 'Youth Clinic'
        ELSE "missing_event_type_race_designation"
    END AS name_event_type
`;

const membership_applications_table = `
    -- MEMBERSHIP APPLICATIONS TABLE
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(membership_applications.address, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS address_ma, 

    membership_applications.application_type AS application_type_ma,
    membership_applications.approval_status AS approval_status_ma,
    
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(membership_applications.city, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS city_ma, 

    membership_applications.confirmation_code AS confirmation_code_ma,
    membership_applications.country AS country_ma,
    membership_applications.created_at AS created_at_ma,
    membership_applications.date_of_birth AS date_of_birth_ma,
    membership_applications.deleted_at AS deleted_at_ma,
    membership_applications.distance_type_id AS distance_type_id_ma,
    membership_applications.email AS email_ma,
    membership_applications.event_id AS event_id_ma,
    membership_applications.extension_type AS extension_type_ma,

    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(membership_applications.first_name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS first_name_ma, 

    ma.id AS id_ma,
    
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(membership_applications.last_name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS last_name_ma, 
    membership_applications.membership_type_id AS membership_type_id_ma,
    membership_applications.middle_name AS middle_name_ma,
    membership_applications.origin_flag AS origin_flag_ma,
    membership_applications.outside_payment AS outside_payment_ma,
    membership_applications.paper_waivers_signed AS paper_waivers_signed_ma,
    membership_applications.payment_id AS payment_id_ma,
    membership_applications.payment_type AS payment_type_ma,
    membership_applications.phone AS phone_ma,
    membership_applications.plan_id AS plan_id_ma,
    membership_applications.profile_id AS profile_id_ma,
    membership_applications.race_id AS race_id_ma,
    membership_applications.race_type_id AS race_type_id_ma,
    membership_applications.referral_code AS referral_code_ma,

    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(membership_applications.state, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS state_ma, 

    membership_applications.status AS status_ma,
    membership_applications.updated_at AS updated_at_ma,
    membership_applications.uuid AS uuid_ma,
    membership_applications.zip AS zip_ma,
    CONCAT('"', SUBSTRING(membership_applications.club_affiliations, 1, 1024), '"') AS club_affiliations_ma, 
    CONCAT('"', SUBSTRING(membership_applications.denial_reason, 1, 1024), '"') AS denial_reason_ma, 
    CONCAT('"', SUBSTRING(membership_applications.payment_explanation, 1, 1024), '"') AS payment_explanation_ma, 
    SUBSTRING(membership_applications.upgrade_code, 1, 1024) AS upgrade_code_ma  
`;

const membership_period_table = `     
    -- MEMBERSHIP PERIODS TABLE
    membership_periods.created_at AS created_at_mp,
    membership_periods.deleted_at AS deleted_at_mp,
    membership_periods.ends AS ends_mp,
    membership_periods.member_id AS member_id_mp,
    membership_periods.membership_type_id AS membership_type_id_mp,
    membership_periods.origin_flag AS origin_flag_mp,
    membership_periods.origin_status AS origin_status_mp,
    membership_periods.origin AS origin_mp,
    membership_periods.period_status AS period_status_mp,
    membership_periods.progress_status AS progress_status_mp,

    membership_periods.purchased_on AS purchased_on_mp,
    DATE_FORMAT(STR_TO_DATE(membership_periods.purchased_on, '%Y-%m-%d %H:%i:%s'), '%Y-%m-%d') AS purchased_on_date_mp,
    YEAR(membership_periods.purchased_on) AS purchased_on_year_mp,
    QUARTER(membership_periods.purchased_on) AS purchased_on_quarter_mp,
    MONTH(membership_periods.purchased_on) AS purchased_on_month_mp,

    -- adjusts purchased on to starts on date if starts < purchase on
    CASE   
        WHEN membership_periods.starts < DATE_FORMAT(membership_periods.purchased_on, '%Y-%m-%d') THEN membership_periods.starts
        ELSE membership_periods.purchased_on
    END AS purchased_on_adjusted_mp,
    CASE   
        WHEN membership_periods.starts < DATE_FORMAT(membership_periods.purchased_on, '%Y-%m-%d') THEN membership_periods.starts
        ELSE DATE_FORMAT(STR_TO_DATE(membership_periods.purchased_on, '%Y-%m-%d %H:%i:%s'), '%Y-%m-%d')
    END AS purchased_on_date_adjusted_mp,
    CASE   
        WHEN membership_periods.starts < DATE_FORMAT(membership_periods.purchased_on, '%Y-%m-%d') THEN YEAR(membership_periods.starts)
        ELSE YEAR(membership_periods.purchased_on)
    END AS purchased_on_year_adjusted_mp,
    CASE   
        WHEN membership_periods.starts < DATE_FORMAT(membership_periods.purchased_on, '%Y-%m-%d') THEN QUARTER(membership_periods.starts)
        ELSE QUARTER(membership_periods.purchased_on)
    END AS purchased_on_quarter_adjusted_mp,
    CASE   
        WHEN membership_periods.starts < DATE_FORMAT(membership_periods.purchased_on, '%Y-%m-%d') THEN MONTH(membership_periods.starts)
        ELSE MONTH(membership_periods.purchased_on)
    END AS purchased_on_month_adjusted_mp,

    membership_periods.remote_id AS remote_id_mp,
    membership_periods.renewed_membership_period_id AS renewed_membership_period_id,
    membership_periods.starts AS starts_mp,
    membership_periods.state AS state_mp,
    membership_periods.status AS status_mp,
    membership_periods.terminated_on AS terminated_on_mp,
    membership_periods.updated_at AS updated_at_mp,
    membership_periods.upgraded_from_id AS upgraded_from_id_mp,
    membership_periods.upgraded_to_id AS upgraded_to_id_mp,
    membership_periods.waiver_status AS waiver_status_mp
`;

const members_table = `
    -- MEMBERS TABLE
    members.active AS active_members, 
    members.created_at AS created_at_members,
    members.deleted_at AS deleted_at_members,
    members.id AS id_members,
    members.longevity_status AS longevity_status_members,
    members.member_number AS member_number_members,
    members.memberable_id AS memberable_id_members,
    members.memberable_type AS memberable_type_members,
    members.period_status AS period_status_members,
    members.referrer_code AS referrer_code_members,
    members.updated_at AS updated_at_members
`;

const membership_types_table = `
    -- MEMBERSHIP TYPES TABLE
    membership_types.created_at AS created_at_mt,
    membership_types.deleted_at AS deleted_at_mt,
    membership_types.extension_type AS extension_type_mt,
    membership_types.id AS id_mt,
    membership_types.membership_card_template_id AS membership_card_template_id_mt,
    membership_types.membership_licenses_type_id AS membership_licenses_type_id_mt,
    membership_types.name AS name_mt,
    membership_types.priority AS priority_mt,
    membership_types.published AS published_mt,
    membership_types.require_admin_approval AS require_admin_approval_mt,
    membership_types.tag_id AS tag_id_mt,
    membership_types.updated_at AS updated_at_mt,
    CONCAT('"', SUBSTRING(membership_types.short_description, 1, 1024), '"') AS short_description_mt
`;

const profiles_table = ` -- todo:
    -- PROFILES TABLE
    profiles.id AS id_profiles,
    profiles.gender_id AS gender_id_profiles, -- todo:

    profiles.created_at AS created_at_profiles,
    profiles.date_of_birth AS date_of_birth_profiles,
    profiles.primary_address_id AS primary_address_id_profiles,
    profiles.deleted_at AS deleted_at_profiles,
    profiles.updated_at AS updated_at_profiles
`;

const orders_products_table = `
    -- ORDERS PRODUCTS TABLE
    order_products.order_id AS order_id_orders_products
`;

const races_table = `
    -- RACES TABLE
    races.designation as designation_races
`;

const registration_audit_table = `
    -- REGISTRATION AUDIT
    registration_audit.id AS id_registration_audit,
    registration_audit.confirmation_number AS confirmation_number_registration_audit,
    registration_audit.date_of_birth AS date_of_birth_registration_audit,
    registration_audit.created_at AS created_at_registration_audit,
    registration_audit.updated_at AS updated_at_registration_audit,
    registration_audit.processed_at AS processed_at_registration_audit
`;

const registration_companies = `
    -- REGISTRATION COMPANY TABLE
    registration_companies.name AS name_registration_companies
`;

const users_table = `
    -- USERS TABLE
    users.created_at AS created_at_users
`;

const select_fields = `
    order_products.order_id AS order_id_op,
    order_products.cart_label AS cart_label_op,
    order_products.amount_per AS amount_per_op,
    order_products.discount AS discount_op,
    order_products.amount_refunded AS amount_refunded_op
`;

// SECTION: VERSION 1
const from_statement_left = `
    FROM one_day_sales_actual_member_fee AS sa

        LEFT JOIN membership_periods        ON sa.max_membership_period_id = membership_periods.id
        LEFT JOIN membership_applications   ON sa.max_membership_period_id = membership_applications.membership_period_id

        ${join_members_profiles_users}

        ${join_metadata_events}
        ${join_races}
        
        ${join_registration_audit}
        ${join_orders_transactions}

        ${join_metadata_addresses}
        ${join_metadata_event_types}
        ${join_metadata_membership_types}
        ${join_metadata_registration_companies}
`;

const query_all_fields_logic = `
    SELECT 
        ${derived_fields},
        ${addresses_table},
        ${events_table},
        ${event_types_table},
        ${membership_applications_table},
        ${membership_period_table},
        ${members_table},
        ${membership_types_table},
        ${profiles_table},
        ${orders_products_table},
        ${races_table},
        ${registration_audit_table},
        ${registration_companies},
        ${users_table},
        ${select_fields}
    ${from_statement_left}

    WHERE 1 = 1
        -- moved these to the join
        -- AND profiles.id IS NOT NULL
        -- AND profiles.deleted_at IS NULL
    GROUP BY membership_periods.id
`;

module.exports = { 
    query_all_fields_logic,
};

// ORIGINAL LEFT JOIN

// FROM one_day_sales_actual_member_fee AS sa

//     LEFT JOIN membership_periods ON sa.max_membership_period_id = membership_periods.id
//     LEFT JOIN membership_applications ON sa.max_membership_period_id = membership_applications.membership_period_id

//     LEFT JOIN order_products ON membership_applications.id = order_products.purchasable_id
//     LEFT JOIN orders ON order_products.order_id = orders.id

//     LEFT JOIN registration_audit ON sa.max_membership_period_id = registration_audit.membership_period_id
//     LEFT JOIN registration_audit_membership_application ON registration_audit.id = registration_audit_membership_application.audit_id
//     LEFT JOIN registration_companies ON registration_audit.registration_company_id = registration_companies.id

//     LEFT JOIN membership_types ON membership_applications.membership_type_id = membership_types.id

//     LEFT JOIN members ON membership_periods.member_id = members.id

//     LEFT JOIN profiles ON members.memberable_id = profiles.id 
//     LEFT JOIN users ON profiles.user_id = users.id           
//     LEFT JOIN addresses ON profiles.primary_address_id = addresses.id

//     LEFT JOIN events ON membership_applications.event_id = events.id  
//     LEFT JOIN races ON events.id = races.event_id
//         AND races.deleted_at IS NULL
//     LEFT JOIN event_types ON events.event_type_id = event_types.id

//     LEFT JOIN transactions ON orders.id = transactions.order_id 
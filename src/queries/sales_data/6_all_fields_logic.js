const derived_fields = `
    -- ALL FIELDS / ONE DAY SALES / ACTUAL MEMBER FEE TABLE (CTE)
    -- sa = sales actual
    sa.member_number_members AS member_number_members_sa,
    sa.max_membership_period_id AS id_membership_periods_sa,

    -- DERIVED FIELDS
    sa.real_membership_types AS real_membership_types_sa,
    sa.new_member_category_6 AS new_member_category_6_sa,
    sa.max_membership_fee_6 AS actual_membership_fee_6_sa,
    sa.source_2 AS source_2_sa,
    sa.is_koz_acception AS is_koz_acception_sa,
`;

const events_table = `
    -- EVENTS TABLE
    events.id AS id_events,
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
    ) AS name_events, -- todo:
    
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
    events.last_season_event_id AS last_season_event_id,

    -- events.city AS city_events,
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(events.city, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS city_events, -- todo:

    -- events.state AS state_events,
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(events.state, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS state_events, -- todo:

    events.country_name AS country_name_events,
    events.country AS country_events,
`;

const membership_applications_table = `
    -- MEMBERSHIP APPLICATIONS TABLE
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(ma.address, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS address_ma, -- todo:

    ma.application_type AS application_type_ma,
    ma.approval_status AS approval_status_ma,
    
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(ma.city, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS city_ma, -- todo:

    ma.confirmation_code AS confirmation_code_ma,
    ma.country AS country_ma,
    ma.created_at AS created_at_ma,
    ma.date_of_birth AS date_of_birth_ma,
    ma.deleted_at AS deleted_at_ma,
    ma.distance_type_id AS distance_type_id_ma,
    ma.email AS email_ma,
    ma.event_id AS event_id_ma,
    ma.extension_type AS extension_type_ma,

    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(ma.first_name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS first_name_ma, -- todo:

    ma.gender AS gender_ma,
    ma.id AS id_ma,
    
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(ma.last_name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS last_name_ma, -- todo:
    ma.membership_type_id AS membership_type_id_ma,
    ma.middle_name AS middle_name_ma,
    ma.origin_flag AS origin_flag_ma,
    ma.outside_payment AS outside_payment_ma,
    ma.paper_waivers_signed AS paper_waivers_signed_ma,
    ma.payment_id AS payment_id_ma,
    ma.payment_type AS payment_type_ma,
    ma.phone AS phone_ma,
    ma.plan_id AS plan_id_ma,
    ma.profile_id AS profile_id_ma,
    ma.race_id AS race_id_ma,
    ma.race_type_id AS race_type_id_ma,
    ma.referral_code AS referral_code_ma,

    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(ma.state, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS state_ma, -- todo:

    ma.status AS status_ma,
    ma.updated_at AS updated_at_ma,
    ma.uuid AS uuid_ma,
    ma.zip AS zip_ma,
    CONCAT('"', SUBSTRING(ma.club_affiliations, 1, 1024), '"') AS club_affiliations_ma, -- todo:
    CONCAT('"', SUBSTRING(ma.denial_reason, 1, 1024), '"') AS denial_reason_ma, -- todo:
    CONCAT('"', SUBSTRING(ma.payment_explanation, 1, 1024), '"') AS payment_explanation_ma, -- todo:
    SUBSTRING(ma.upgrade_code, 1, 1024) AS upgrade_code_ma,    
`;

const membership_period_table = `     
    -- MEMBERSHIP PERIODS TABLE
    mp.created_at AS created_at_mp,
    mp.deleted_at AS deleted_at_mp,
    mp.ends AS ends_mp,
    mp.member_id AS member_id_mp,
    mp.membership_type_id AS membership_type_id_mp,
    mp.origin_flag AS origin_flag_mp,
    mp.origin_status AS origin_status_mp,
    mp.origin AS origin_mp,
    mp.period_status AS period_status_mp,
    mp.progress_status AS progress_status_mp,
    mp.purchased_on AS purchased_on_mp,

    MONTH(mp.purchased_on) AS purchased_on_month_mp,
    QUARTER(mp.purchased_on) AS purchased_on_quarter_mp,
    YEAR(mp.purchased_on) AS purchase_on_year_mp,

    -- todo: adjusts purchased on to starts on date if starts < purchase on
    CASE   
        WHEN mp.starts < DATE_FORMAT(mp.purchased_on, '%Y-%m-%d') THEN mp.starts
        ELSE mp.purchased_on
    END AS purchase_on_adjusted_mp,
    CASE   
        WHEN mp.starts < DATE_FORMAT(mp.purchased_on, '%Y-%m-%d') THEN MONTH(mp.starts)
        ELSE MONTH(mp.purchased_on)
    END AS purchased_on_month_adjusted_mp,
    CASE   
        WHEN mp.starts < DATE_FORMAT(mp.purchased_on, '%Y-%m-%d') THEN QUARTER(mp.starts)
        ELSE QUARTER(mp.purchased_on)
    END AS purchased_on_quarter_adjusted_mp,
    CASE   
        WHEN mp.starts < DATE_FORMAT(mp.purchased_on, '%Y-%m-%d') THEN YEAR(mp.starts)
        ELSE YEAR(mp.purchased_on)
    END AS purchased_on_year_adjusted_mp,

    mp.remote_id AS remote_id_mp,
    mp.renewed_membership_period_id AS renewed_membership_period_id,
    mp.starts AS starts_mp,
    mp.state AS state_mp,
    mp.status AS status_mp,
    mp.terminated_on AS terminated_on_mp,
    mp.updated_at AS updated_at_mp,
    mp.upgraded_from_id AS upgraded_from_id_mp,
    mp.upgraded_to_id AS upgraded_to_id_mp,
    mp.waiver_status AS waiver_status_mp,
`;

const members_table = `
    -- MEMBERS TABLE
    members.active AS active_members, -- todo:
    members.created_at AS created_at_members,
    members.deleted_at AS deleted_at_members,
    members.id AS id_members,
    members.longevity_status AS longevity_status_members,
    members.member_number AS member_number_members,
    members.memberable_id AS memberable_id_members,
    members.memberable_type AS memberable_type_members,
    members.period_status AS period_status_members,
    members.referrer_code AS referrer_code_members,
    members.updated_at AS updated_at_members,
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
    CONCAT('"', SUBSTRING(membership_types.short_description, 1, 1024), '"') AS short_description_mt,
`;

const profiles_table = `
    -- PROFILES TABLE
    profiles.created_at AS created_at_profiles,
    profiles.date_of_birth AS date_of_birth_profiles, -- todo:
`;

const registration_audit_table = `
    -- REGISTRATION AUDIT
    registration_audit.date_of_birth AS date_of_birth_registration_audit, -- todo:
`;

const users_table = `
    -- USERS TABLE
    users.created_at AS created_at_users,
`;

const select_fields = `
    op.order_id AS order_id_op,
    op.cart_label AS cart_label_op,
    op.amount_per AS amount_per_op,
    op.discount AS discount_op,
    op.amount_refunded AS amount_refunded_op
`;

// SECTION: VERSION 1
const from_statement_left = `
    FROM one_day_sales_actual_member_fee AS sa
        LEFT JOIN membership_periods AS mp ON sa.max_membership_period_id = mp.id
        LEFT JOIN membership_applications AS ma ON sa.max_membership_period_id = ma.membership_period_id
        LEFT JOIN order_products AS op ON ma.id = op.purchasable_id
        LEFT JOIN orders ON op.order_id = orders.id
        LEFT JOIN registration_audit ON sa.max_membership_period_id = registration_audit.membership_period_id
        LEFT JOIN registration_audit_membership_application ON registration_audit.id = registration_audit_membership_application.audit_id
        LEFT JOIN membership_types ON ma.membership_type_id = membership_types.id

        LEFT JOIN members ON mp.member_id = members.id -- DONE = CHANGED FROM RIGHT JOIN TO LEFT
        LEFT JOIN profiles ON members.memberable_id = profiles.id -- DONE = CHANGED FROM RIGHT JOIN TO LEFT

        LEFT JOIN users ON profiles.user_id = users.id
        LEFT JOIN events ON ma.event_id = events.id
        LEFT JOIN transactions ON orders.id = transactions.order_id
`;

// SECTION: VERSION 2
// const from_statement_right = `
//     FROM one_day_sales_actual_member_fee AS sa
//         LEFT JOIN membership_periods AS mp ON sa.max_membership_period_id = mp.id -- DONE
//         LEFT JOIN membership_applications AS ma ON sa.max_membership_period_id = ma.membership_period_id -- DONE   
//         LEFT JOIN order_products AS op ON ma.id = op.purchasable_id -- DONE
//         LEFT JOIN orders ON op.order_id = orders.id -- DONE
//         LEFT JOIN registration_audit ON sa.max_membership_period_id = registration_audit.membership_period_id
//         LEFT JOIN registration_audit_membership_application ON registration_audit.id = registration_audit_membership_application.audit_id
        
//         -- RIGHT JOIN membership_periods ON (membership_applications.membership_period_id = membership_periods.id) -- DONE LINE 879

//         LEFT JOIN membership_types ON ma.membership_type_id = membership_types.id -- DONE

//         -- RIGHT JOIN members ON membership_periods.member_id = members.id
//         -- LEFT JOIN members ON mp.member_id = members.id -- DONE = CHANGED FROM RIGHT JOIN TO LEFT
//         RIGHT JOIN members ON mp.member_id = members.id -- DONE = CHANGED FROM RIGHT JOIN TO LEFT

//         -- RIGHT JOIN profiles ON members.memberable_id = profiles.id
//         -- LEFT JOIN profiles ON members.memberable_id = profiles.id -- DONE = CHANGED FROM RIGHT JOIN TO LEFT
//         RIGHT JOIN profiles ON members.memberable_id = profiles.id -- DONE = CHANGED FROM RIGHT JOIN TO LEFT

//         LEFT JOIN users ON profiles.user_id = users.id
//         LEFT JOIN events ON ma.event_id = events.id
//         LEFT JOIN transactions ON orders.id = transactions.order_id   
// `;

const query_all_fields_logic = `
    SELECT 
        ${derived_fields}
        ${events_table}
        ${membership_applications_table}
        ${membership_period_table}
        ${members_table}
        ${membership_types_table}
        ${profiles_table}
        ${registration_audit_table}
        ${users_table}
        ${select_fields}
    ${from_statement_left}

    GROUP BY mp.id
`;

module.exports = { query_all_fields_logic };

// profiles.active AS active_profiles,
// profiles.created_at AS created_at_profiles,
// profiles.deceased_recorded_on AS deceased_recorded_on_profiles,
// profiles.deleted_at AS deleted_at_profiles,

// CONCAT('"', 
//     REPLACE(
//         REPLACE(
//             REPLACE(SUBSTRING(profiles.first_name, 1, 255), '''', ''), 
//             '"', ''
//         ), 
//         ',', ''
//     ), 
//     '"'
// ) AS first_name_profiles, -- todo:

// profiles.gender_id AS gender_id_profiles,

// CONCAT('"', 
//     REPLACE(
//         REPLACE(
//             REPLACE(SUBSTRING(profiles.last_name, 1, 255), '''', ''), 
//             '"', ''
//         ), 
//         ',', ''
//     ), 
//     '"'
// ) AS last_name_profiles, -- todo:

// CONCAT('"', 
//     REPLACE(
//         REPLACE(
//             REPLACE(SUBSTRING(profiles.name, 1, 255), '''', ''), 
//             '"', ''
//         ), 
//         ',', ''
//     ), 
//     '"'
// ) AS name_profiles, -- todo:

// profiles.primary_email_id AS primary_email_id_profiles,
// profiles.primary_phone_id AS primary_phone_id_profiles,
// profiles.updated_at AS updated_at_profiles,

// registration_audit.registration_company_id,
// registration_audit_membership_application.price_paid AS price_paid_rama,

// users.active AS active_users,
// users.created_at AS created_at_users,
// users.deleted_at AS deleted_at_users,
// users.email AS email_users,
// users.invalid_email AS invalid_email_users,

// -- CONCAT('"', SUBSTRING(users.name, 1, 1024), '"') AS name_users, -- todo:
// CONCAT('"', 
//     REPLACE(
//         REPLACE(
//             REPLACE(SUBSTRING(users.name, 1, 255), '''', ''), 
//             '"', ''
//         ), 
//         ',', ''
//     ), 
//     '"'
// ) AS name_users, -- todo:

// users.opted_out_of_notifications AS opted_out_of_notifications_users,
// users.updated_at AS updated_at_users
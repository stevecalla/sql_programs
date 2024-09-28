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
    events.address AS address_events,
    events.allow_one_day_purchases AS allow_one_day_purchases_events,
    events.athlete_guide_url AS athlete_guide_url_events,
    events.certified_race_director AS certified_race_director_events,
    CONCAT('"', SUBSTRING(events.city, 1, 255), '"') AS city_events, -- todo:
    events.country_code AS country_code_events,
    events.country_name AS country_name_events,
    events.country AS country_events,
    events.created_at AS created_at_events,
    events.deleted_at AS deleted_at_events,
    events.distance AS distance_events,
    events.ends AS ends_events,
    events.event_type_id AS type_id_events,
    events.event_website_url AS website_url_events,
    events.facebook_url AS facebook_url_events,
    events.featured_at AS featured_at_events,
    events.id AS id_events,
    events.instagram_url AS instagram_url_events,
    events.last_season_event_id AS last_season_event_id,
    CONCAT('"', REPLACE(SUBSTRING(events.name, 1, 254), '"', ''), '"') AS name_events, -- todo:
    events.qualification_deadline AS qualification_deadline_events,
    events.qualification_url AS qualification_url_events,
    events.race_director_id AS race_director_id_events,
    events.registration_company_event_id AS registration_company_event_id,
    events.registration_policy_url AS registration_policy_url_events,
    events.remote_id AS remote_id_events,
    events.sanctioning_event_id AS id_sanctioning_event,
    events.starts AS starts_events,
    events.state_code AS state_code_events,
    events.state_id AS state_id_events,
    events.state_name AS state_name_events,
    events.state AS state_events,
    events.status AS status_events,
    events.twitter_url AS twitter_url_events,
    events.updated_at AS updated_at_events,
    events.virtual AS virtual_events,
    events.youtube_url AS youtube_url_events,
    events.zip AS zip_events,
    CONCAT('"', SUBSTRING(events.overview, 1, 1024), '"') AS overview_events, -- todo:
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(events.name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS registration_information, -- todo:
    SUBSTRING(events.registration_url, 1, 1024) AS registration_url_events,
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

const membership_period_table = `     
    -- MEMBERSHIP PERIODS TABLE
    mp.id AS id_mp,
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

    MONTH(mp.purchased_on) AS purchase_on_month_mp,
    QUARTER(mp.purchased_on) AS purchased_on_quarter_mp,
    YEAR(mp.purchased_on) AS purchase_on_year_mp,

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

const membership_applications_table = `
    -- MEMBERSHIP APPLICATIONS TABLE
    CONCAT('"', SUBSTRING(ma.address, 1, 1024), '"') AS address_ma, -- todo:

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
    
    CONCAT('"', SUBSTRING(ma.first_name, 1, 1024), '"') AS first_name_ma, -- todo:

    ma.gender AS gender_ma,
    ma.id AS id_ma,

    CONCAT('"', SUBSTRING(ma.last_name, 1, 1024), '"') AS last_name_ma, -- todo:

    ma.membership_period_id AS membership_period_id_ma,
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

const order_products_table = `    
    -- ORDER PRODUCTS TABLE
    op.amount_charged_back AS amount_charged_back_orders_products,
    op.amount_per AS amount_per_orders_products,
    op.amount_refunded AS amount_refunded_orders_products,
    op.base_price AS base_price_orders_products,
    op.cart_description AS cart_description_orders_products,
    op.cart_label AS cart_label_orders_products,
    op.created_at AS created_at_orders_products,
    op.deleted_at AS deleted_at_orders_products, 
    op.discount AS discount_orders_products,
    op.id AS id_order_products_orders_products,
    op.option_amount_per AS option_amount_per_orders_products,
    op.order_id AS order_id_orders_products,
    op.original_tax AS original_tax_orders_products,
    op.original_total AS original_total_orders_products,
    op.processed_at AS processed_at_orders_products,
    op.product_description AS product_description_orders_products,
    op.product_id AS product_id_orders_products,
    op.purchasable_id AS purchasable_id_orders_products,
    op.purchasable_processed_at AS purchasable_processed_at_orders_products,
    op.purchasable_type AS purchasable_type,
    op.quantity_refunded AS quantity_refunded_orders_products,
    op.quantity AS quantity_orders_products,
    op.sku AS sku_orders_products,
    op.status_id AS status_id_orders_products,
    op.tax AS tax_orders_products,
    op.title AS title_orders_products,
    op.total AS total_orders_products,
    op.tracking_number AS tracking_number_orders_products,
    op.updated_at AS updated_at_order_products,
    SUBSTRING(op.options_given, 1, 1024) AS options_given_orders_products,
    SUBSTRING(op.tax_info, 1, 1024) AS tax_info_orders_products,
`;

// -- todo:
const orders_table = `
    -- ORDERS TABLE
    orders.active AS active_orders,
    orders.address_2 AS address_2_orders,
    orders.address AS address_orders,
    orders.amount_charged_back AS amount_charged_back_orders,
    orders.amount_refunded AS amount_refunded_orders,
    orders.city AS city_orders,
    orders.confirmation_number AS confirmation_number_orders,
    orders.country AS country_orders,
    orders.created_at AS created_at_orders,
    orders.deleted_at AS deleted_at_orders,
    orders.discount_code AS discount_code_orders,
    orders.discount AS discount_orders,
    orders.email AS email_orders,
    orders.first_name AS first_name_orders,
    orders.group_id AS group_id_orders,
    orders.handling_charge AS handling_charge_orders,
    orders.handling_tax AS handling_tax_orders,
    orders.id AS id_orders,
    orders.in_hand_date AS in_hand_date_orders,
    orders.last_name AS last_name_orders,
    orders.original_tax AS original_tax_orders,
    orders.original_total AS original_total_orders,
    orders.phone AS phone_orders,
    orders.post_process_finished_at AS post_process_finished_at_orders,
    orders.post_process_started_at AS post_process_started_at_orders,
    orders.processed AS processed_orders,
    orders.quote_id AS quote_id_orders,
    orders.ship_on AS ship_on_orders,
    orders.shipping_address_2 AS shipping_address_2_orders,
    orders.shipping_address AS shipping_address_orders,
    orders.shipping_city AS shipping_city_orders,
    orders.shipping_company AS shipping_company_orders,
    orders.shipping_country AS shipping_country_orders,
    orders.shipping_first_name AS shipping_first_name_orders,
    orders.shipping_last_name AS shipping_last_name_orders,
    orders.shipping_method AS shipping_method_orders,
    orders.shipping_rate AS shipping_rate_orders,
    orders.shipping_state AS shipping_state_orders,
    orders.shipping_tax AS shipping_tax_orders,
    orders.shipping_zip AS shipping_zip_orders,
    orders.state AS state_orders_orders,
    orders.status_id AS status_id_orders,
    orders.store AS store_orders,
    orders.subtotal AS subtotal_orders,
    orders.tax_transaction_code AS tax_transaction_code_orders,
    orders.tax AS tax_orders,
    orders.total AS total_orders,
    orders.tracking AS tracking_orders,
    orders.upcharge AS upcharge_orders,
    orders.updated_at AS updated_at_orders,
    orders.user_id AS user_id_orders,
    orders.uuid AS uuid_orders,
    orders.zip AS zip_orders,
    SUBSTRING(orders.customer_note, 1, 1024) AS customer_note_orders,
    SUBSTRING(orders.internal_note, 1, 1024) AS internal_note_orders
`;

const profiles_table = `
    -- PROFILES TABLE
    profiles.active AS active_profiles,
    profiles.anonymous AS anonymous_profiles,
    profiles.created_at AS created_at_profiles,
    profiles.date_of_birth AS date_of_birth_profiles,
    profiles.deceased_recorded_on AS deceased_recorded_on_profiles,
    profiles.deleted_at AS deleted_at_profiles,
    profiles.education_id AS education_id_profiles,
    profiles.ethnicity_id AS ethnicity_id_profiles,
    profiles.first_name AS first_name_profiles_profiles,
    profiles.gender_id AS gender_id_profiles,
    profiles.gender_opt_out AS gender_opt_out_profiles,
    profiles.id AS id_profiles,
    profiles.income_id AS income_id_profiles,
    profiles.is_us_citizen AS is_us_citizen_profiles,
    profiles.last_name AS last_name_profiles,
    profiles.marketo_lead_id_old AS marketo_lead_id_old_profiles,
    profiles.marketo_lead_id AS marketo_lead_id_profiles,
    profiles.merged_from_profile_id AS merged_from_profile_id,
    profiles.merged_to_profile_id AS merged_to_profile_id,
    profiles.middle_name AS middle_name_profiles,
    profiles.military_id AS military_id_profiles,
    profiles.name AS name_profiles,
    profiles.occupation_id AS occupation_id_profiles,
    profiles.para AS para_profiles,
    profiles.primary_address_id AS primary_address_id_profiles,
    profiles.primary_citizenship_id AS primary_citizenship_id_profiles,
    profiles.primary_email_id AS primary_email_id_profiles,
    profiles.primary_emergency_contact_id AS primary_emergency_contact_id_profiles,
    profiles.primary_phone_id AS primary_phone_id_profiles,
    profiles.remote_id AS remote_id_profiles_profiles,
    profiles.suffix AS suffix_profiles,
    profiles.updated_at AS updated_at_profiles,
    profiles.user_id AS user_id_profiles,
    profiles.uuid AS uuid_profiles,
    SUBSTRING(profiles.merge_info, 1, 1024) AS merge_info_profiles,
`;

const registration_audit_membership_application_table = `
    -- REGISTRATION AUDIT MEMBERSHIP APPLICATION TABLE
    registration_audit_membership_application.audit_id AS audit_id_rama,
    registration_audit_membership_application.created_at AS created_at_rama,
    registration_audit_membership_application.distance_type_id AS distance_type_id_rama,
    registration_audit_membership_application.id AS id_rama,
    registration_audit_membership_application.membership_application_id AS membership_application_id_rama,
    registration_audit_membership_application.membership_type_id AS membership_type_id_rama,
    registration_audit_membership_application.price_paid AS price_paid_rama,
    registration_audit_membership_application.race_id AS race_id_rama,
    registration_audit_membership_application.race_type_id AS race_type_id_rama,
    registration_audit_membership_application.status AS status_rama,
    registration_audit_membership_application.updated_at AS updated_at_rama,
    SUBSTRING(registration_audit_membership_application.upgrade_codes, 1, 1024) AS upgrade_codes_rama,
`;

const registration_audit_table = `
    -- REGISTRATION AUDIT TABLE
    registration_audit.address AS address_ra,
    registration_audit.billing_address AS billing_address_ra,
    registration_audit.billing_city AS billing_city_ra,
    registration_audit.billing_country AS billing_country_ra,
    registration_audit.billing_email AS billing_email_ra,
    registration_audit.billing_first_name AS billing_first_name_ra,
    registration_audit.billing_last_name AS billing_last_name_ra,
    registration_audit.billing_middle_name AS billing_middle_name_ra,
    registration_audit.billing_phone AS billing_phone_ra,
    registration_audit.billing_state AS billing_state_ra,
    registration_audit.billing_zip AS billing_zip_ra,
    registration_audit.city AS city_ra,
    registration_audit.confirmation_number AS confirmation_number_ra,
    registration_audit.country AS country_ra,
    registration_audit.created_at AS created_at_ra,
    registration_audit.date_of_birth AS date_of_birth_ra,
    registration_audit.deleted_at AS deleted_at_ra,
    registration_audit.email AS email_ra,
    registration_audit.ethnicity AS ethnicity_ra,
    registration_audit.event_id AS event_id_ra,
    registration_audit.first_name AS first_name_ra,
    registration_audit.gender AS gender_ra,
    registration_audit.id AS id_ra,
    registration_audit.invoice_product_id AS invoice_product_id_ra,
    registration_audit.last_name AS last_name_ra,
    registration_audit.member_number AS member_number_ra,
    registration_audit.membership_period_id AS membership_period_id_ra,
    registration_audit.middle_name AS middle_name_ra,
    registration_audit.phone_number AS phone_number_ra,
    registration_audit.processed_at AS processed_at_ra,
    registration_audit.profile_id AS profile_id_ra,
    registration_audit.registration_company_id AS registration_company_id_ra,
    registration_audit.remote_audit_code AS remote_audit_code_ra,
    registration_audit.remote_id AS remote_id_ra,
    registration_audit.state AS state_ra,
    registration_audit.status AS status_ra,
    registration_audit.updated_at AS updated_at_ra,
    registration_audit.user_id AS user_id_ra,
    registration_audit.zip AS zip_ra,
`;

const transactions_table = `
    -- TRANSACTIONS TABLE
    transactions.amount AS amount_tr,
    transactions.captured AS captured_tr,
    transactions.created_at AS created_at_tr,
    transactions.date AS date_tr,
    transactions.deleted_at AS deleted_at_tr,
    transactions.exported_at AS exported_at_tr,
    transactions.id AS id_tr,
    transactions.order_id AS order_id_tr,
    transactions.payment_id AS payment_id_tr,
    transactions.payment_method AS payment_method_tr,
    transactions.processed AS processed_tr,
    transactions.refunded_amount AS refunded_amount_tr,
    transactions.tax_transaction_code AS tax_transaction_code_tr,
    transactions.tax AS tax_tr,
    transactions.updated_at AS updated_at_tr,
    transactions.user_id AS user_id_tr,
    SUBSTRING(events.description, 1, 1024) AS description_tr,
    SUBSTRING(transactions.note, 1, 1024) AS note_tr,
    SUBSTRING(transactions.tax_transaction, 1, 1024) AS tax_transaction_tr,
`;

const users_table = `
    -- USERS TABLE
    users.active AS active_users,
    users.api_token AS api_token_users,
    users.claimed AS claimed_users,
    users.created_at AS created_at_users,
    users.deleted_at AS deleted_at_users,
    users.email_verified_at AS email_verified_at_users,
    users.email AS email_users,
    users.id AS id_users,
    users.invalid_email AS invalid_email_users,
    users.logged_in_at AS logged_in_at_users,
    users.merged_from_user_id AS merged_from_user_id_users,
    users.merged_to_user_id AS merged_to_user_id_users,
    users.name AS name_users_users,
    users.old_email AS old_email,
    users.opted_out_of_notifications AS opted_out_of_notifications_users,
    users.password AS password_users,
    users.primary AS primary_users,
    users.remember_token AS remember_token_users,
    users.remote_id AS remote_id_users,
    users.updated_at AS updated_at_users,
    users.username AS username_users,
    users.uuid AS uuid_users,
    SUBSTRING(users.invalid_email_value, 1, 1024) AS invalid_email_value_users,
    SUBSTRING(users.merge_info, 1, 1024) AS merge_info_users,
    SUBSTRING(users.personal_access_token, 1, 1024) AS personal_access_token_users
`;

const select_fields = `
    op.order_id AS order_id_op,
    op.cart_label AS cart_label_op,
    op.amount_per AS amount_per_op,
    op.discount AS discount_op,
    op.amount_refunded AS amount_refunded_op,

    profiles.active AS active_profiles,
    profiles.created_at AS created_at_profiles,
    profiles.date_of_birth AS date_of_birth_profiles,
    profiles.deceased_recorded_on AS deceased_recorded_on_profiles,
    profiles.deleted_at AS deleted_at_profiles,
    
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(profiles.first_name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS first_name_profiles, -- todo:

    profiles.gender_id AS gender_id_profiles,
    
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(profiles.last_name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS last_name_profiles, -- todo:

    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(profiles.name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS name_profiles, -- todo:

    profiles.primary_email_id AS primary_email_id_profiles,
    profiles.primary_phone_id AS primary_phone_id_profiles,
    profiles.updated_at AS updated_at_profiles,

    registration_audit.registration_company_id,
    registration_audit_membership_application.price_paid AS price_paid_rama,

    users.active AS active_users,
    users.created_at AS created_at_users,
    users.deleted_at AS deleted_at_users,
    users.email AS email_users,
    users.invalid_email AS invalid_email_users,

    -- CONCAT('"', SUBSTRING(users.name, 1, 1024), '"') AS name_users, -- todo:
    CONCAT('"', 
        REPLACE(
            REPLACE(
                REPLACE(SUBSTRING(users.name, 1, 255), '''', ''), 
                '"', ''
            ), 
            ',', ''
        ), 
        '"'
    ) AS name_users, -- todo:

    users.opted_out_of_notifications AS opted_out_of_notifications_users,
    users.updated_at AS updated_at_users
`;

const from_statement = `
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

const query_all_fields_logic = `
    SELECT 
        ${derived_fields}
        ${members_table}
        ${membership_period_table}
        ${membership_types_table}
        ${membership_applications_table}
        ${select_fields}

        ${from_statement}

    GROUP BY mp.id
`;

module.exports = { query_all_fields_logic };
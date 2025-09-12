const derived_fields = `
    -- ALL FIELDS / ONE DAY SALES / ACTUAL MEMBER FEE TABLE (CTE)
    -- alias "sa" = sales actual
    member_number_members_sa,
    id_membership_periods_sa,

    -- DERIVED FIELDS
    real_membership_types_sa,
    new_member_category_6_sa,
    actual_membership_fee_6_sa,
    actual_membership_fee_6_rule_sa,
    source_2_sa,
    is_koz_acception_sa,
`;

const addresses_table = `
    city_addresses,
    postal_code_addresses,
    lng_addresses,
    lat_addresses,
    state_code_addresses,
    country_code_addresses,
`;

const events_table = `
    -- EVENTS TABLE
    id_events,
    id_sanctioning_events,
    id_sanctioning_events_and_type,
    event_type_id_events,
    name_events,
    
    address_events,
    city_events,
    zip_events,
    state_code_events,
    country_code_events,

    @created_at_events, 
    created_at_month_events,
    created_at_quarter_events,
    created_at_year_events,

    @starts_events,  
    starts_month_events,
    starts_quarter_events,
    starts_year_events,

    @ends_events, 
    ends_month_events,
    ends_quarter_events,
    ends_year_events,

    status_events,
    
    race_director_id_events,
    last_season_event_id,
`;

const event_types_table = `
    -- EVENT TYPES TABLE
    id_event_types, 
    id_event_type_events,
    name_event_type,
`;

const membership_applications_table = `
    -- MEMBERSHIP APPLICATIONS TABLE
    address_ma,
    application_type_ma,
    approval_status_ma,
    city_ma,
    confirmation_code_ma,
    country_ma,
    @created_at_ma, 
    @date_of_birth_ma, 
    @deleted_at_ma, 
    distance_type_id_ma,
    email_ma,
    event_id_ma,
    extension_type_ma,
    first_name_ma,
    id_ma,
    last_name_ma,
    membership_type_id_ma,
    middle_name_ma,
    origin_flag_ma,
    outside_payment_ma,
    paper_waivers_signed_ma,
    payment_id_ma,
    payment_type_ma,
    phone_ma,
    plan_id_ma,
    profile_id_ma,
    race_id_ma,
    race_type_id_ma,
    referral_code_ma,
    state_ma,
    status_ma,
    @updated_at_ma, 
    uuid_ma,
    zip_ma,
    club_affiliations_ma,
    denial_reason_ma,
    payment_explanation_ma,
    upgrade_code_ma,   
`;

const membership_period_table = `
    -- MEMBERSHIP PERIODS TABLE
    @created_at_mp, 
    @deleted_at_mp, 
    @ends_mp, 
    member_id_mp,
    membership_type_id_mp,
    origin_flag_mp,
    origin_status_mp,
    origin_mp,
    period_status_mp,
    progress_status_mp,

    @purchased_on_mp, 
    purchased_on_date_mp, 
    purchased_on_year_mp,
    purchased_on_quarter_mp,
    purchased_on_month_mp,

    @purchased_on_adjusted_mp, 
    purchased_on_date_adjusted_mp, 
    purchased_on_year_adjusted_mp,
    purchased_on_quarter_adjusted_mp,
    purchased_on_month_adjusted_mp,

    remote_id_mp,
    renewed_membership_period_id,
    @starts_mp, 
    state_mp,
    status_mp,
    @terminated_on_mp, 
    @updated_at_mp, 
    upgraded_from_id_mp,
    upgraded_to_id_mp,
    waiver_status_mp,
`;

const members_table = `
    -- MEMBERS TABLE
    active_members,
    @created_at_members, 
    @deleted_at_members, 
    id_members,
    longevity_status_members,
    member_number_members,
    memberable_id_members,
    memberable_type_members,
    period_status_members,
    referrer_code_members,
    @updated_at_members, 
`;

const membership_types_table = `
    -- MEMBERSHIP TYPES TABLE
    @created_at_mt, 
    @deleted_at_mt, 
    extension_type_mt,
    id_mt,
    membership_card_template_id_mt,
    membership_licenses_type_id_mt,
    name_mt,
    priority_mt,
    published_mt,
    require_admin_approval_mt,
    tag_id_mt,
    @updated_at_mt, 
    short_description_mt,
`;

const profiles_table = ` -- todo:
    -- PROFILES TABLE
    id_profiles,
    gender_id_profiles, -- todo:
    
    @created_at_profiles,
    @date_of_birth_profiles,
    primary_address_id_profiles,
`;

const orders_products_table = `
    -- ORDERS PRODUCTS TABLE
    order_id_orders_products,
`;

const races_table = `
    -- RACES TABLE
    designation_races,
`;

const registration_audit_table = `
    -- REGISTRATION AUDIT
    id_registration_audit,
    confirmation_number_registration_audit,
    @date_of_birth_registration_audit, 
`;

const registration_companies = `
    -- REGISTRATION COMPANY TABLE
    name_registration_companies,
`;

const users_table = `
    -- USERS TABLE
    @created_at_users, 
`;

const select_fields = `
    order_id_op,
    cart_label_op,
    amount_per_op,
    discount_op,
    amount_refunded_op
`;

const transform_fields = `
    -- SECTION: EVENTS
    -- CONVERTS "Fri Jun 11 2021 12:03:17 GMT-0600 (Mountain Daylight Time)" TO '2021-06-11 12:03:17' TO MAINTAIN MTN TIME
    created_at_events = CASE 
        WHEN @created_at_events IS NOT NULL AND @created_at_events != 'Invalid Date' THEN 
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR) 
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_events, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s') 
        ELSE
            NULL  -- Or specify a default value or an error message
    END,

    -- CONVERTS "Fri Jun 11 2021 12:03:17 GMT-0600 (Mountain Daylight Time)" TO '2021-06-11'; THE DATE TYPE EXCLUDES THE H M S
    ends_events = CASE
        WHEN @ends_events IS NOT NULL AND @ends_events != 'Invalid Date' THEN
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@ends_events, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    starts_events = CASE
        WHEN @starts_events IS NOT NULL AND @starts_events != 'Invalid Date' THEN
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@starts_events, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,


    -- SECTION: Memmbership periods
    -- CONVERTS "Fri Jun 11 2021 12:03:17 GMT-0600 (Mountain Daylight Time)" TO '2021-06-11 12:03:17' TO MAINTAIN MTN TIME
    created_at_mp = CASE
        WHEN @created_at_mp IS NOT NULL AND @created_at_mp != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL  -- Or specify a default value or an error message
    END,

    deleted_at_mp = CASE
        WHEN @deleted_at_mp IS NOT NULL AND @deleted_at_mp != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    purchased_on_mp = CASE
        WHEN @purchased_on_mp IS NOT NULL AND @purchased_on_mp != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@purchased_on_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@purchased_on_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    purchased_on_adjusted_mp = CASE
        WHEN @purchased_on_adjusted_mp IS NOT NULL AND @purchased_on_adjusted_mp != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@purchased_on_adjusted_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@purchased_on_adjusted_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,
    
    updated_at_mp = CASE
        WHEN @updated_at_mp IS NOT NULL AND @updated_at_mp != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    -- CONVERTS "Fri Jun 11 2021 12:03:17 GMT-0600 (Mountain Daylight Time)" TO '2021-06-11'; THE DATE TYPE EXCLUDES THE H M S
    ends_mp = CASE
        WHEN @ends_mp IS NOT NULL AND @ends_mp != 'Invalid Date' THEN
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@ends_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    starts_mp = CASE
        WHEN @starts_mp IS NOT NULL AND @starts_mp != 'Invalid Date' THEN
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@starts_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    terminated_on_mp = CASE
        WHEN @terminated_on_mp IS NOT NULL AND @terminated_on_mp != 'Invalid Date' THEN
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@terminated_on_mp, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    -- SECTION: MEMBERSHIP APPLICATIONS
    created_at_ma = CASE
        WHEN @created_at_ma IS NOT NULL AND @created_at_ma != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_ma, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_ma, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    deleted_at_ma = CASE
        WHEN @deleted_at_ma IS NOT NULL AND @deleted_at_ma != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_ma, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_ma, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    updated_at_ma = CASE
        WHEN @updated_at_ma IS NOT NULL AND @updated_at_ma != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_ma, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_ma, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    -- CONVERTS '1969-01-13 00:00:00' TO '1969-01-13'
    date_of_birth_ma = CASE
        WHEN @date_of_birth_ma IS NOT NULL AND @date_of_birth_ma != 'Invalid Date' THEN
            STR_TO_DATE(@date_of_birth_ma, '%Y-%m-%d %H:%i:%s')
        ELSE
            NULL
    END,

    -- SECTION: MEMBERS
    created_at_members = 
        CASE 
            WHEN @created_at_members IS NOT NULL THEN 
                -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_members, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR) 
                STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_members, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
            ELSE 
                NULL 
        END,

    deleted_at_members = 
        CASE 
            WHEN @deleted_at_members IS NOT NULL THEN 
                -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_members, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR) 
                STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_members, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
            ELSE 
                NULL 
        END,

    updated_at_members = 
        CASE 
            WHEN @updated_at_members IS NOT NULL THEN 
                -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_members, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR) 
                STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_members, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
            ELSE 
                NULL 
        END,

    -- SECTION: MEMBERSHIP TYPES
    created_at_mt = 
        CASE 
            WHEN @created_at_mt IS NOT NULL THEN 
                -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_mt, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR) 
                STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_mt, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
            ELSE 
                NULL 
        END,

    deleted_at_mt = 
        CASE 
            WHEN @deleted_at_mt IS NOT NULL THEN 
                -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_mt, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR) 
                STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_mt, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s') 
            ELSE 
                NULL 
        END,

    updated_at_mt = 
        CASE 
            WHEN @updated_at_mt IS NOT NULL THEN 
                -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_mt, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR) 
                STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_mt, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s') 
            ELSE 
                NULL 
        END,

    -- REMOVE DOUBLE QUOTES FROM FIELDS
    short_description_mt = TRIM(BOTH '"' FROM short_description_mt),

    -- SECTION: PROFILES
    created_at_profiles = CASE
        WHEN @created_at_profiles IS NOT NULL AND @created_at_profiles != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_profiles, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_profiles, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    -- CONVERTS "Wed Apr 03 1968 00:00:00 GMT-0700 (Mountain Daylight Time)" TO '1968-04-03'; THE DATE TYPE EXCLUDES THE H M S
    date_of_birth_profiles = CASE
        WHEN @date_of_birth_profiles IS NOT NULL AND @date_of_birth_profiles != 'Invalid Date' THEN
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@date_of_birth_profiles, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    -- SECTION: REGISTRATION AUDIT
    -- CONVERTS "Wed Apr 03 1968 00:00:00 GMT-0700 (Mountain Daylight Time)" TO '1968-04-03'; THE DATE TYPE EXCLUDES THE H M S
    date_of_birth_registration_audit = CASE
        WHEN @date_of_birth_registration_audit IS NOT NULL AND @date_of_birth_registration_audit != 'Invalid Date' THEN
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@date_of_birth_registration_audit, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END,

    -- SECTION: USERS
    created_at_users = CASE
        WHEN @created_at_users IS NOT NULL AND @created_at_users != 'Invalid Date' THEN
            -- ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_users, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s'), INTERVAL 6 HOUR)
            STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_users, ' GMT', 1), ' ', -5), '%a %b %d %Y %H:%i:%s')
        ELSE
            NULL
    END;

`;

// LOAD DATA INFILE 'C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/usat_sales_data/results_2024-10-26_17-48-05_annual_sales_units_2011.csv'
function query_load_sales_data(filePath, table) {
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
        ${addresses_table}
        ${events_table}
        ${event_types_table}
        ${membership_applications_table}
        ${membership_period_table}
        ${members_table}
        ${membership_types_table}
        ${profiles_table}
        ${orders_products_table}
        ${races_table}
        ${registration_audit_table}
        ${registration_companies}
        ${users_table}
        ${select_fields}
    )   
      SET 
        ${transform_fields};
  `
  }
    
  module.exports = {
    query_load_sales_data,
  };

// SECTION: EVENTS
  // registration_information_events = TRIM(BOTH '"' FROM registration_information_events),

  // deleted_at_events   =   STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_events, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
  // updated_at_events   =   STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_events, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
    
  // qualification_deadline_events = STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@qualification_deadline_events, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),

// SECTION: PROFILES
  // date of birth profiles format = Wed Apr 03 1968 00:00:00 GMT-0700 (Mountain Daylight Time)
  // date_of_birth_profiles = STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@date_of_birth_profiles, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
  // deceased_recorded_on_profiles = STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deceased_recorded_on_profiles, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),

  // active_profiles,
  // @date_of_birth_profiles, 
  // @deceased_recorded_on_profiles, 
  // @deleted_at_profiles, 
  // first_name_profiles,
  // gender_id_profiles,
  // last_name_profiles,
  // name_profiles,
  // primary_email_id_profiles,
  // primary_phone_id_profiles,
  // @updated_at_profiles, 

  // registration_company_id,
  // price_paid_rama,

  // active_users,
  // @deleted_at_users, 
  // email_users,
  // invalid_email_users,
  // name_users,
  // opted_out_of_notifications_users,
  // @updated_at_users 
const transform_fields = `
    -- SECTION: CONVERTS "Fri Jun 11 2021 12:03:17 GMT-0600 (Mountain Daylight Time)" TO '2021-06-11 18:03:17' TO UTC FROM MTN
    created_at_mp   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_mp, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    deleted_at_mp   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_mp, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    purchased_on_mp =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@purchased_on_mp, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    updated_at_mp   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_mp, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),

    created_at_members   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_members, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    deleted_at_members   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_members, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    updated_at_members   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_members, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    
    created_at_mt   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_mt, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    deleted_at_mt   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_mt, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    updated_at_mt   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_mt, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    
    created_at_ma   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_ma, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    deleted_at_ma   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_ma, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    updated_at_ma   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_ma, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    
    created_at_profiles   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_profiles, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    deleted_at_profiles   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_profiles, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    updated_at_profiles   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_profiles, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    
    created_at_users   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_users, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    deleted_at_users   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_users, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    updated_at_users   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_users, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
  
    -- SECTION: CONVERTS "Fri Jun 11 2021 12:03:17 GMT-0600 (Mountain Daylight Time)" TO '2021-06-11'; THE DATE TYPE EXCLUDES THE H M S
    ends_mp             =   STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@ends_mp, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
    starts_mp           =   STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@starts_mp, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
    terminated_on_mp    =   STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@terminated_on_mp, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
  
    date_of_birth_profiles = STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@date_of_birth_profiles, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
  
    deceased_recorded_on_profiles = STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deceased_recorded_on_profiles, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),

    -- SECTION: CONVERTS '1969-01-13 00:00:00' TO '1969-01-13'
    date_of_birth_ma = STR_TO_DATE(@date_of_birth_ma, "%Y-%m-%d %H:%i:%s"),

    -- SECTION: REMOVE DOUBLE QUOTES FROM FIELDS
    short_description_mt = TRIM(BOTH '"' FROM short_description_mt)
`;

const derived_fields = `
    -- ALL FIELDS / ONE DAY SALES / ACTUAL MEMBER FEE TABLE (CTE)
    -- sa = sales actual
    member_number_members_sa,
    id_membership_periods_sa,

    -- DERIVED FIELDS
    real_membership_types_sa,
    new_member_category_6_sa,
    actual_membership_fee_6_sa,
    source_2_sa,
    is_koz_acception_sa,
`;

const events_table = `
    -- EVENTS TABLE
    address_events,
    allow_one_day_purchases_events,
    athlete_guide_url_events,
    certified_race_director_events,
    city_events,
    country_code_events,
    country_name_events,
    country_events,
    @created_at_events, -- TODO:
    @deleted_at_events, -- TODO:
    distance_events,
    @ends_events, -- TODO:
    type_id_events,
    website_url_events,
    facebook_url_events,
    featured_at_events,
    id_events,
    instagram_url_events,
    last_season_event_id,
    name_events,
    @qualification_deadline_events,
    qualification_url_events,
    race_director_id_events,
    registration_company_event_id,
    registration_policy_url_events,
    remote_id_events,
    id_sanctioning_event,
    @starts_events, -- TODO:
    state_code_events,
    state_id_events,
    state_name_events,
    state_events,
    status_events,
    twitter_url_events,
    @updated_at_events, -- todo:
    virtual_events,
    youtube_url_events,
    zip_events,
    overview_events,
    registration_information_events,
    registration_url_events,
`;

const members_table = `
  -- MEMBERS TABLE
  active_members,
  @created_at_members, -- todo:
  @deleted_at_members, -- todo:
  id_members,
  longevity_status_members,
  member_number_members,
  memberable_id_members,
  memberable_type_members,
  period_status_members,
  referrer_code_members,
  @updated_at_members, -- todo:
`;

const membership_period_table = `
    -- MEMBERSHIP PERIODS TABLE
    id_mp,
    @created_at_mp, -- TODO:
    @deleted_at_mp, -- TODO:
    @ends_mp, -- TODO:
    member_id_mp,
    membership_type_id_mp,
    origin_flag_mp,
    origin_status_mp,
    origin_mp,
    period_status_mp,
    progress_status_mp,
    @purchased_on_mp, -- TODO:

    purchase_on_month_mp,
    purchased_on_quarter_mp,
    purchased_on_year_mp,

    remote_id_mp,
    renewed_membership_period_id,
    @starts_mp, -- TODO:
    state_mp,
    status_mp,
    @terminated_on_mp, -- TODO:
    @updated_at_mp, -- TODO:
    upgraded_from_id_mp,
    upgraded_to_id_mp,
    waiver_status_mp,
`;

const membership_types_table = `
    -- MEMBERSHIP TYPES TABLE
    @created_at_mt, -- todo:
    @deleted_at_mt, -- todo:
    extension_type_mt,
    id_mt,
    membership_card_template_id_mt,
    membership_licenses_type_id_mt,
    name_mt,
    priority_mt,
    published_mt,
    require_admin_approval_mt,
    tag_id_mt,
    @updated_at_mt, -- todo:
    short_description_mt,
`;

const membership_applications_table = `
    -- MEMBERSHIP APPLICATIONS TABLE
    address_ma,
    application_type_ma,
    approval_status_ma,
    city_ma,
    confirmation_code_ma,
    country_ma,
    @created_at_ma, -- todo:
    @date_of_birth_ma, -- todo:
    @deleted_at_ma, -- todo:
    distance_type_id_ma,
    email_ma,
    event_id_ma,
    extension_type_ma,
    first_name_ma,
    gender_ma,
    id_ma,
    last_name_ma,
    membership_period_id_ma,
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
    @updated_at_ma, -- todo:
    uuid_ma,
    zip_ma,
    club_affiliations_ma,
    denial_reason_ma,
    payment_explanation_ma,
    upgrade_code_ma,   
`;
  
const order_products_table = `
  -- ORDER PRODUCTS TABLE
  amount_charged_back_orders_products,
  amount_per_orders_products,
  amount_refunded_orders_products,
  base_price_orders_products,
  cart_description_orders_products,
  cart_label_orders_products,
  @created_at_orders_products, -- TODO:
  @deleted_at_orders_products, -- TODO:
  discount_orders_products,
  id_order_products_orders_products,
  option_amount_per_orders_products,
  order_id_orders_products,
  original_tax_orders_products,
  original_total_orders_products,
  @processed_at_orders_products, -- todo:
  product_description_orders_products,
  product_id_orders_products,
  purchasable_id_orders_products,
  @purchasable_processed_at_orders_products, -- TODO:
  purchasable_type,
  quantity_refunded_orders_products,
  quantity_orders_products,
  sku_orders_products,
  status_id_orders_products,
  tax_orders_products,
  title_orders_products,
  total_orders_products,
  tracking_number_orders_products,
  @updated_at_orders_products, -- TODO:
  options_given_orders_products,
  tax_info_orders_products
`;

const orders_table = `
  -- ORDERS TABLE
  active_orders,
  address_2_orders,
  address_orders,
  amount_charged_back_orders,
  amount_refunded_orders,
  city_orders,
  confirmation_number_orders,
  country_orders,
  @created_at_orders, -- todo:
  @deleted_at_orders, -- todo:
  discount_code_orders,
  discount_orders,
  email_orders,
  first_name_orders,
  group_id_orders,
  handling_charge_orders,
  handling_tax_orders,
  id_orders,
  in_hand_date_orders, -- todo:
  last_name_orders,
  original_tax_orders,
  original_total_orders,
  phone_orders,
  post_process_finished_at_orders,
  post_process_started_at_orders,
  processed_orders,
  quote_id_orders,
  ship_on_orders,
  shipping_address_2_orders,
  shipping_address_orders,
  shipping_city_orders,
  shipping_company_orders,
  shipping_country_orders,
  shipping_first_name_orders,
  shipping_last_name_orders,
  shipping_method_orders,
  shipping_rate_orders,
  shipping_state_orders,
  shipping_tax_orders,
  shipping_zip_orders,
  state_orders,
  status_id_orders,
  store_orders,
  subtotal_orders,
  tax_transaction_code_orders,
  tax_orders,
  total_orders,
  tracking_orders,
  upcharge_orders,
  @updated_at_orders, -- todo:
  user_id_orders,
  uuid_orders,
  zip_orders,
  customer_note_orders,
  internal_note_orders,
`;

const profiles_table = `
  -- PROFILES TABLE
  active_profiles,
  anonymous_profiles,
  created_at_profiles, -- todo:
  date_of_birth_profiles, -- todo:
  deceased_recorded_on_profiles,
  deleted_at_profiles, -- todo:
  education_id_profiles,
  ethnicity_id_profiles,
  first_name_profiles,
  gender_id_profiles,
  gender_opt_out_profiles,
  id_profiles,
  income_id_profiles,
  is_us_citizen_profiles,
  last_name_profiles,
  marketo_lead_id_old_profiles,
  marketo_lead_id_profiles,
  merged_from_profile_id_profiles,
  merged_to_profile_id_profiles,
  middle_name_profiles,
  military_id_profiles,
  name_profiles,
  occupation_id_profiles,
  para_profiles,
  primary_address_id_profiles,
  primary_citizenship_id_profiles,
  primary_email_id_profiles,
  primary_emergency_contact_id_profiles,
  primary_phone_id_profiles,
  remote_id_profiles,
  suffix_profiles,
  updated_at_profiles, -- todo:
  user_id_profiles,
  uuid_profiles,
  merge_info_profiles,
`;

const registration_audit_membership_application_table = `
  -- REGISTRATION AUDIT MEMBERSHIP APPLICATION TABLE
  audit_id_rama,
  created_at_rama, -- todo:
  distance_type_id_rama,
  id_rama,
  membership_application_id_rama,
  membership_type_id_rama,
  price_paid_rama,
  race_id_rama,
  race_type_id_rama,
  status_rama,
  updated_at_rama, -- todo:
  upgrade_codes_rama,
`;

const registration_audit_table = `
  -- REGISTRATION AUDIT TABLE
  address_ra,
  billing_address_ra,
  billing_city_ra,
  billing_country_ra,
  billing_email_ra,
  billing_first_name_ra,
  billing_last_name_ra,
  billing_middle_name_ra,
  billing_phone_ra,
  billing_state_ra,
  billing_zip_ra,
  city_ra,
  confirmation_number_ra,
  country_ra,
  created_at_ra, -- todo:
  date_of_birth_ra, -- todo:
  deleted_at_ra, -- todo:
  email_ra,
  ethnicity_ra,
  event_id_ra,
  first_name_ra,
  gender_ra,
  id_ra,
  invoice_product_id_ra,
  last_name_ra,
  member_number_ra,
  membership_period_id_ra,
  middle_name_ra,
  phone_number_ra,
  processed_at_ra, -- todo:
  profile_id_ra,
  registration_company_id_ra,
  remote_audit_code_ra,
  remote_id_ra,
  state_ra,
  status_ra,
  updated_at_ra, -- todo:
  user_id_ra,
  zip_ra,
`;

const transactions_table = `
  -- TRANSACTIONS TABLE
  amount_tr,
  captured_tr,
  created_at_tr, -- todo:
  date_tr, -- todo:
  deleted_at_tr, -- todo:
  exported_at_tr, -- todo:
  id_tr,
  order_id_tr,
  payment_id_tr,
  payment_method_tr,
  processed_tr,
  refunded_amount_tr,
  tax_transaction_code_tr,
  tax_tr,
  updated_at_tr, -- todo:
  user_id_tr,
  description_tr,
  note_tr,
  tax_transaction_tr,
`;

const users_table = `
  -- USERS TABLE
  active_users,
  api_token_users,
  claimed_users,
  created_at_users,
  deleted_at_users,
  email_verified_at_users,
  email_users,
  id_users,
  invalid_email_users,
  logged_in_at_users,
  merged_from_user_id_users,
  merged_to_user_id_users,
  name_users,
  old_email_users,
  opted_out_of_notifications_users,
  password_users,
  primary_users,
  remember_token_users,
  remote_id_users,
  updated_at_users,
  username_users,
  uuid_users,
  invalid_email_value_users,
  merge_info_users,
  personal_access_token_users
`;

const select_fields = `
    order_id_op,
    cart_label_op,
    amount_per_op,
    discount_op,
    amount_refunded_op,

    active_profiles,
    @created_at_profiles, -- todo:
    @date_of_birth_profiles, -- todo:
    @deceased_recorded_on_profiles, -- todo:
    @deleted_at_profiles, -- todo:
    first_name_profiles,
    gender_id_profiles,
    last_name_profiles,
    name_profiles,
    primary_email_id_profiles,
    primary_phone_id_profiles,
    @updated_at_profiles, -- todo:

    registration_company_id,
    price_paid_rama,

    active_users,
    @created_at_users, -- todo:
    @deleted_at_users, -- todo:
    email_users,
    invalid_email_users,
    name_users,
    opted_out_of_notifications_users,
    @updated_at_users -- todo:
`;

function query_load_sales_data(filePath, table) {
  return `
    LOAD DATA INFILE '${filePath}'
    INTO TABLE ${table}
    FIELDS TERMINATED BY ','
    ENCLOSED BY '"'
    LINES TERMINATED BY '\\n'
    IGNORE 1 LINES
    (
      ${derived_fields}
      ${members_table}
      ${membership_period_table}
      ${membership_types_table}
      ${membership_applications_table}
      ${select_fields}
    )    
    SET 
      ${transform_fields};
  `
  }
    
  module.exports = {
    query_load_sales_data,
  };

  // city_events = TRIM(BOTH '"' FROM city_events),
  // name_events = TRIM(BOTH '"' FROM name_events),
  // registration_information_events = TRIM(BOTH '"' FROM registration_information_events),

  // created_at_events   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@created_at_events, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
  // deleted_at_events   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@deleted_at_events, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
  // updated_at_events   =   ADDDATE(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@updated_at_events, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),INTERVAL 6 HOUR),
    
  // ends_events         =   STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@ends_events, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
  // starts_events       =   STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@starts_events, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
  // qualification_deadline_events = STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(@qualification_deadline_events, ' GMT', 1),' ', -5),'%a %b %d %Y %H:%i:%s'),
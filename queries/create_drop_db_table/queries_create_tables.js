const index_fields = `
  PRIMARY KEY (member_number_members_sa, id_membership_periods_sa),

  INDEX idx_real_membership_types (real_membership_types_sa),
  INDEX idx_new_member_category_6 (new_member_category_6_sa),
  INDEX idx_source_2 (source_2_sa)

`;

const derived_fields = `
  -- ALL FIELDS / ONE DAY SALES / ACTUAL MEMBER FEE TABLE (CTE)
  -- sa = sales actual
  member_number_members_sa VARCHAR(255) NOT NULL,
  id_membership_periods_sa INT,

  -- DERIVED FIELDS
  real_membership_types_sa VARCHAR(255),
  new_member_category_6_sa VARCHAR(255),
  actual_membership_fee_6_sa DECIMAL(10,2),
  source_2_sa VARCHAR(255),
  is_koz_acception_sa BOOLEAN,
`;

const events_table = `
  -- EVENTS TABLE
  address_events VARCHAR(255),
  allow_one_day_purchases_events BOOLEAN,
  athlete_guide_url_events VARCHAR(1024),
  certified_race_director_events BOOLEAN,
  city_events VARCHAR(255),
  country_code_events VARCHAR(10),
  country_name_events VARCHAR(255),
  country_events VARCHAR(255),
  created_at_events DATETIME, -- TODO:
  deleted_at_events DATETIME, -- TODO:
  distance_events DECIMAL(10, 2),
  ends_events DATE, -- todo:
  type_id_events INT,
  website_url_events VARCHAR(1024),
  facebook_url_events VARCHAR(1024),
  featured_at_events  VARCHAR(255),
  id_events INT,
  instagram_url_events VARCHAR(1024),
  last_season_event_id INT,
  name_events VARCHAR(255),
  qualification_deadline_events DATETIME, -- todo:
  qualification_url_events TEXT,
  race_director_id_events INT,
  registration_company_event_id INT,
  registration_policy_url_events VARCHAR(1024),
  remote_id_events VARCHAR(255),
  id_sanctioning_event INT,
  starts_events DATE, -- TODO:
  state_code_events VARCHAR(10),
  state_id_events INT,
  state_name_events VARCHAR(255),
  state_events VARCHAR(255),
  status_events VARCHAR(50),
  twitter_url_events VARCHAR(1024),
  updated_at_events DATETIME, -- todo:
  virtual_events BOOLEAN,
  youtube_url_events VARCHAR(1024),
  zip_events VARCHAR(20),
  overview_events TEXT,
  registration_information_events TEXT,
  registration_url_events TEXT,
`;

const members_table = `
  -- MEMBERS TABLE
  active_members BOOLEAN,
  created_at_members DATETIME,
  deleted_at_members DATETIME,
  id_members INT,
  longevity_status_members VARCHAR(255),
  member_number_members VARCHAR(255), -- todo: changed from INT due to alphas i.e. 'davesoroka'
  memberable_id_members VARCHAR(255),
  memberable_type_members VARCHAR(255),
  period_status_members VARCHAR(255),
  referrer_code_members VARCHAR(255),
  updated_at_members DATETIME,
`;

const membership_period_table = `
  -- MEMBERSHIP PERIODS TABLE
  id_mp INT,
  created_at_mp DATETIME,
  deleted_at_mp DATETIME, 
  ends_mp DATE, 
  member_id_mp INT, -- todo: was INT
  membership_type_id_mp INT, -- todo: was INT 96548
  origin_flag_mp VARCHAR(255),
  origin_status_mp VARCHAR(255),
  origin_mp VARCHAR(255),
  period_status_mp VARCHAR(255),
  progress_status_mp VARCHAR(255),
  purchased_on_mp DATETIME, 
  
  purchase_on_month_mp INT,
  purchased_on_quarter_mp INT,
  purchased_on_year_mp YEAR,

  remote_id_mp VARCHAR(255),
  renewed_membership_period_id INT,
  starts_mp DATE, 
  state_mp VARCHAR(255),
  status_mp VARCHAR(255),
  terminated_on_mp DATE, 
  updated_at_mp DATETIME, 
  upgraded_from_id_mp INT,
  upgraded_to_id_mp INT,
  waiver_status_mp VARCHAR(255),
`;

const membership_types_table = `
  -- MEMBERSHIP TYPES TABLE
  created_at_mt DATETIME,
  deleted_at_mt DATETIME,
  extension_type_mt VARCHAR(255),
  id_mt INT,
  membership_card_template_id_mt INT,
  membership_licenses_type_id_mt INT,
  name_mt VARCHAR(255),
  priority_mt INT,
  published_mt BOOLEAN,
  require_admin_approval_mt BOOLEAN,
  tag_id_mt INT,
  updated_at_mt DATETIME,
  short_description_mt TEXT,
`;

const membership_applications_table = `
  -- MEMBERSHIP APPLICATIONS TABLE
  address_ma TEXT,
  application_type_ma VARCHAR(50),
  approval_status_ma VARCHAR(50),
  city_ma VARCHAR(100),
  confirmation_code_ma VARCHAR(100),
  country_ma VARCHAR(100),
  created_at_ma DATETIME,
  date_of_birth_ma DATE,
  deleted_at_ma DATETIME,
  distance_type_id_ma VARCHAR(255),
  email_ma TEXT,
  event_id_ma INT,
  extension_type_ma VARCHAR(50),
  first_name_ma VARCHAR(255),
  gender_ma VARCHAR(50),
  id_ma INT,
  last_name_ma VARCHAR(100),
  membership_period_id_ma INT,
  membership_type_id_ma INT,
  middle_name_ma VARCHAR(100),
  origin_flag_ma TEXT,
  outside_payment_ma DECIMAL(10, 2),
  paper_waivers_signed_ma BOOLEAN,
  payment_id_ma VARCHAR(50),
  payment_type_ma VARCHAR(50),
  phone_ma VARCHAR(20),
  plan_id_ma INT,
  profile_id_ma INT,
  race_id_ma INT,
  race_type_id_ma INT,
  referral_code_ma VARCHAR(50),
  state_ma VARCHAR(100),
  status_ma VARCHAR(50),
  updated_at_ma DATETIME,
  uuid_ma TEXT,
  zip_ma VARCHAR(20),
  club_affiliations_ma TEXT,
  denial_reason_ma TEXT,
  payment_explanation_ma TEXT,
  upgrade_code_ma TEXT, 
`;
  
const order_products_table = `
    amount_charged_back_orders_products DECIMAL(10, 2),
    amount_per_orders_products DECIMAL(10, 2),
    amount_refunded_orders_products DECIMAL(10, 2),
    base_price_orders_products DECIMAL(10, 2),
    cart_description_orders_products TEXT,
    cart_label_orders_products TEXT,
    created_at_orders_products DATETIME,
    deleted_at_orders_products DATETIME,
    discount_orders_products DECIMAL(10, 2), -- todo:
    id_order_products_orders_products BIGINT,
    option_amount_per_orders_products DECIMAL(10, 2),
    order_id_orders_products BIGINT,
    original_tax_orders_products DECIMAL(10, 2),
    original_total_orders_products DECIMAL(10, 2),
    processed_at_orders_products DATETIME,
    product_description_orders_products TEXT,
    product_id_orders_products BIGINT,
    purchasable_id_orders_products BIGINT,
    purchasable_processed_at_orders_products DATETIME,
    purchasable_type TEXT,
    quantity_refunded_orders_products INT,
    quantity_orders_products INT,
    sku_orders_products TEXT,
    status_id_orders_products INT,
    tax_orders_products DECIMAL(10, 2),
    title_orders_products TEXT,
    total_orders_products DECIMAL(10, 2),
    tracking_number_orders_products TEXT,
    updated_at_orders_products DATETIME,
    options_given_orders_products TEXT,
    tax_info_orders_products TEXT,
`;

const orders_table = `
  active_orders TINYINT(1),
  address_2_orders VARCHAR(100),  -- Reduced from 255
  address_orders VARCHAR(100),    -- Reduced from 255
  amount_charged_back_orders DECIMAL(10, 2),
  amount_refunded_orders DECIMAL(10, 2),
  city_orders VARCHAR(50),        -- Reduced from 100
  confirmation_number_orders VARCHAR(50),  -- Reduced from 100
  country_orders VARCHAR(50),     -- Reduced from 100
  created_at_orders DATETIME,
  deleted_at_orders DATETIME,
  discount_code_orders VARCHAR(20),  -- Reduced from 50
  discount_orders DECIMAL(5, 2),
  email_orders VARCHAR(100),      -- Reduced from 255
  first_name_orders VARCHAR(50),  -- Reduced from 100
  group_id_orders INT,
  handling_charge_orders DECIMAL(10, 2),
  handling_tax_orders DECIMAL(5, 2),
  id_orders BIGINT,
  in_hand_date_orders DATETIME,
  last_name_orders VARCHAR(50),   -- Reduced from 100
  original_tax_orders DECIMAL(10, 2),
  original_total_orders DECIMAL(10, 2),
  phone_orders VARCHAR(15),       -- Reduced from 20
  post_process_finished_at_orders DATETIME,
  post_process_started_at_orders DATETIME,
  processed_orders TINYINT(1),
  quote_id_orders VARCHAR(50),    -- Reduced from 100
  ship_on_orders DATE,
  shipping_address_2_orders VARCHAR(100),  -- Reduced from 255
  shipping_address_orders VARCHAR(100),    -- Reduced from 255
  shipping_city_orders VARCHAR(50),        -- Reduced from 100
  shipping_company_orders VARCHAR(50),     -- Reduced from 100
  shipping_country_orders VARCHAR(50),     -- Reduced from 100
  shipping_first_name_orders VARCHAR(50),  -- Reduced from 100
  shipping_last_name_orders VARCHAR(50),   -- Reduced from 100
  shipping_method_orders VARCHAR(50),      -- Reduced from 100
  shipping_rate_orders DECIMAL(10, 2),
  shipping_state_orders VARCHAR(50),       -- Reduced from 100
  shipping_tax_orders DECIMAL(5, 2),
  shipping_zip_orders VARCHAR(10),         -- Reduced from 20
  state_orders VARCHAR(50),                -- Reduced from 100
  status_id_orders INT,
  store_orders VARCHAR(50),                -- Reduced from 100
  subtotal_orders DECIMAL(10, 2),
  tax_transaction_code_orders VARCHAR(50), -- Reduced from 100
  tax_orders DECIMAL(10, 2),
  total_orders DECIMAL(10, 2),
  tracking_orders VARCHAR(50),             -- Reduced from 100
  upcharge_orders DECIMAL(10, 2),
  updated_at_orders DATETIME,
  user_id_orders BIGINT,
  uuid_orders CHAR(36),
  zip_orders VARCHAR(10),                 -- Reduced from 20
  customer_note_orders TEXT,
  internal_note_orders TEXT,
`;

const profiles_table = `
  active_profiles TINYINT(1),
  anonymous_profiles TINYINT(1),
  created_at_profiles DATETIME,
  date_of_birth_profiles DATE,
  deceased_recorded_on_profiles DATE,
  deleted_at_profiles DATETIME,
  education_id_profiles INT,
  ethnicity_id_profiles INT,
  first_name_profiles VARCHAR(100),
  gender_id_profiles INT,
  gender_opt_out_profiles TINYINT(1),
  id_profiles BIGINT,
  income_id_profiles INT,
  is_us_citizen_profiles TINYINT(1),
  last_name_profiles VARCHAR(100),
  marketo_lead_id_old_profiles VARCHAR(100),
  marketo_lead_id_profiles VARCHAR(100),
  merged_from_profile_id_profiles BIGINT,
  merged_to_profile_id_profiles BIGINT,
  middle_name_profiles VARCHAR(100),
  military_id_profiles VARCHAR(100),
  name_profiles VARCHAR(255),
  occupation_id_profiles INT,
  para_profiles TEXT,
  primary_address_id_profiles INT,
  primary_citizenship_id_profiles INT,
  primary_email_id_profiles INT,
  primary_emergency_contact_id_profiles INT,
  primary_phone_id_profiles INT,
  remote_id_profiles VARCHAR(100),
  suffix_profiles VARCHAR(50),
  updated_at_profiles DATETIME,
  user_id_profiles BIGINT,
  uuid_profiles CHAR(36),
  merge_info_profiles TEXT,
`;

const registration_audit_membership_application_table = `
  audit_id_rama BIGINT,
  created_at_rama DATETIME,
  distance_type_id_rama INT,
  id_rama BIGINT,
  membership_application_id_rama BIGINT,
  membership_type_id_rama INT,
  price_paid_rama DECIMAL(10, 2),
  race_id_rama INT,
  race_type_id_rama INT,
  status_rama VARCHAR(50),
  updated_at_rama DATETIME,
  upgrade_codes_rama TEXT,
`;

const registration_audit_table = `
  address_ra VARCHAR(255),
  billing_address_ra VARCHAR(255),
  billing_city_ra VARCHAR(100),
  billing_country_ra VARCHAR(100),
  billing_email_ra VARCHAR(255),
  billing_first_name_ra VARCHAR(100),
  billing_last_name_ra VARCHAR(100),
  billing_middle_name_ra VARCHAR(100),
  billing_phone_ra VARCHAR(20),
  billing_state_ra VARCHAR(100),
  billing_zip_ra VARCHAR(20),
  city_ra VARCHAR(100),
  confirmation_number_ra VARCHAR(100),
  country_ra VARCHAR(100),
  created_at_ra DATETIME,
  date_of_birth_ra DATE,
  deleted_at_ra DATETIME,
  email_ra VARCHAR(255),
  ethnicity_ra VARCHAR(100),
  event_id_ra INT,
  first_name_ra VARCHAR(100),
  gender_ra VARCHAR(50),
  id_ra BIGINT,
  invoice_product_id_ra BIGINT,
  last_name_ra VARCHAR(100),
  member_number_ra VARCHAR(100),
  membership_period_id_ra INT,
  middle_name_ra VARCHAR(100),
  phone_number_ra VARCHAR(20),
  processed_at_ra DATETIME,
  profile_id_ra BIGINT,
  registration_company_id_ra BIGINT,
  remote_audit_code_ra VARCHAR(100),
  remote_id_ra VARCHAR(100),
  state_ra VARCHAR(100),
  status_ra VARCHAR(50),
  updated_at_ra DATETIME,
  user_id_ra BIGINT,
  zip_ra VARCHAR(20),
`;

const transactions_table = `
  amount_tr DECIMAL(10, 2),
  captured_tr TINYINT(1),
  created_at_tr DATETIME,
  date_tr DATE,
  deleted_at_tr DATETIME,
  exported_at_tr DATETIME,
  id_tr BIGINT,
  order_id_tr BIGINT,
  payment_id_tr BIGINT,
  payment_method_tr VARCHAR(100),
  processed_tr TINYINT(1),
  refunded_amount_tr DECIMAL(10, 2),
  tax_transaction_code_tr VARCHAR(100),
  tax_tr DECIMAL(10, 2),
  updated_at_tr DATETIME,
  user_id_tr BIGINT,
  description_tr TEXT,
  note_tr TEXT,
  tax_transaction_tr TEXT,
`;

const users_table = `
  active_users TINYINT(1),
  api_token_users VARCHAR(255),
  claimed_users TINYINT(1),
  created_at_users DATETIME,
  deleted_at_users DATETIME,
  email_verified_at_users DATETIME,
  email_users VARCHAR(255),
  id_users BIGINT,
  invalid_email_users TINYINT(1),
  logged_in_at_users DATETIME,
  merged_from_user_id_users BIGINT,
  merged_to_user_id_users BIGINT,
  name_users VARCHAR(255),
  old_email_users VARCHAR(255),
  opted_out_of_notifications_users TINYINT(1),
  password_users VARCHAR(255),
  primary_users TINYINT(1),
  remember_token_users VARCHAR(100),
  remote_id_users VARCHAR(100),
  updated_at_users DATETIME,
  username_users VARCHAR(100),
  uuid_users CHAR(36),
  invalid_email_value_users TEXT,
  merge_info_users TEXT,
  personal_access_token_users TEXT,
`;

const select_fields = `
  order_id_op INT,
  cart_label_op VARCHAR(255),
  amount_per_op DECIMAL(10, 2),
  discount_op DECIMAL(10, 2),
  amount_refunded_op DECIMAL(10, 2),

  active_profiles TINYINT(1),
  created_at_profiles DATETIME, -- todo:
  date_of_birth_profiles DATE, -- todo:
  deceased_recorded_on_profiles DATE, -- todo:
  deleted_at_profiles DATETIME, -- todo:
  first_name_profiles VARCHAR(255),
  gender_id_profiles INT,
  last_name_profiles VARCHAR(255),
  name_profiles VARCHAR(255),
  primary_email_id_profiles VARCHAR(255),
  primary_phone_id_profiles VARCHAR(20),
  updated_at_profiles DATETIME, -- todo:

  registration_company_id INT,
  price_paid_rama DECIMAL(10, 2),

  active_users TINYINT(1),
  created_at_users DATETIME, -- todo:
  deleted_at_users DATETIME, -- todo:
  email_users VARCHAR(255),
  invalid_email_users TINYINT(1),
  name_users VARCHAR(255),
  opted_out_of_notifications_users TINYINT(1),
  updated_at_users DATETIME, -- todo:
`;

const table = `all_membership_sales_data_2019`;
// const table = `all_membership_sales_data`;

const query_create_all_membership_sales_table = `
  CREATE TABLE IF NOT EXISTS ${table} (
    ${derived_fields}
    ${members_table}
    ${membership_period_table}
    ${membership_types_table}
    ${membership_applications_table}
    ${select_fields}
    ${index_fields}
  );
`;

const tables_library = [
  { 
    table_name: `${table}`,
    create_query: query_create_all_membership_sales_table,
    step: "STEP #2.1:",
    step_info: "all membership sales_data",
  },
];

module.exports = {
  tables_library,
  query_create_all_membership_sales_table,
}
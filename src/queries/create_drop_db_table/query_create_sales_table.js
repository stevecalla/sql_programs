const derived_fields = `
  -- ALL FIELDS / ONE DAY SALES / ACTUAL MEMBER FEE TABLE (CTE)
  -- sa = sales actual
  member_number_members_sa VARCHAR(255) NOT NULL,
  id_membership_periods_sa INT,

  -- DERIVED FIELDS
  real_membership_types_sa VARCHAR(255),
  new_member_category_6_sa VARCHAR(255),
  actual_membership_fee_6_sa DECIMAL(10,2),
  actual_membership_fee_6_rule_sa VARCHAR(255),
  source_2_sa VARCHAR(255),
  is_koz_acception_sa BOOLEAN,
`;

const addresses_table = `
    city_addresses VARCHAR(255),
    postal_code_addresses VARCHAR(255),
    lng_addresses FLOAT,
    lat_addresses FLOAT,
    state_code_addresses VARCHAR(50),
    country_code_addresses VARCHAR(255),
`;

const events_table = ` -- todo:
  -- EVENTS TABLE
  id_events INT,
  id_sanctioning_events INT, -- todo:                   
  event_type_id_events INT,                     
  name_events VARCHAR(255),                      

  address_events VARCHAR(255),
  city_events varchar(191), 
  zip_events VARCHAR(50),          
  state_code_events varchar(10),              
  country_code_events varchar(10),             

  created_at_events DATETIME,
  created_at_month_events INT,
  created_at_quarter_events INT,
  created_at_year_events INT,

  starts_events DATE,
  starts_month_events INT,
  starts_quarter_events INT,
  starts_year_events INT,

  ends_events DATE,  
  ends_month_events INT,
  ends_quarter_events INT,
  ends_year_events INT,                        

  status_events VARCHAR(50),        
  
  race_director_id_events INT,                
  last_season_event_id INT,                
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

const membership_period_table = `
  -- MEMBERSHIP PERIODS TABLE
  created_at_mp DATETIME,
  deleted_at_mp DATETIME, 
  ends_mp DATE, 
  member_id_mp INT,
  membership_type_id_mp INT,
  origin_flag_mp VARCHAR(255),
  origin_status_mp VARCHAR(255),
  origin_mp VARCHAR(255),
  period_status_mp VARCHAR(255),
  progress_status_mp VARCHAR(255),

  purchased_on_mp DATETIME,
  purchased_on_date_mp DATE,
  purchased_on_year_mp YEAR,
  purchased_on_quarter_mp INT,
  purchased_on_month_mp INT,
  
  purchased_on_adjusted_mp DATETIME, 
  purchased_on_date_adjusted_mp DATE,
  purchased_on_year_adjusted_mp YEAR,
  purchased_on_quarter_adjusted_mp INT,
  purchased_on_month_adjusted_mp INT,

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

const members_table = `
  -- MEMBERS TABLE
  active_members BOOLEAN,
  created_at_members DATETIME,
  deleted_at_members DATETIME,
  id_members INT,
  longevity_status_members VARCHAR(255),
  member_number_members VARCHAR(255), -- changed to VARCHAR due to i.e. 'davesoroka'
  memberable_id_members VARCHAR(255),
  memberable_type_members VARCHAR(255),
  period_status_members VARCHAR(255),
  referrer_code_members VARCHAR(255),
  updated_at_members DATETIME,
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

const profiles_table = `
  -- PROFILES TABLE
  id_profiles INT,
  created_at_profiles DATETIME,
  date_of_birth_profiles DATE,
  primary_address_id_profiles INT,
`;

const orders_products_table = ` -- todo:
    -- ORDERS PRODUCTS TABLE
    order_id_orders_products INT,
`;

const registration_audit_table = ` -- todo:
  -- REGISTRATION AUDIT
  id_registration_audit INT,
  date_of_birth_registration_audit DATE,
`;

const registration_companies = ` -- todo:
    -- REGISTRATION COMPANY TABLE
    name_registration_companies VARCHAR(255),
`;

const users_table = `
  -- USERS TABLE
  created_at_users DATETIME,
`;

const select_fields = `
  order_id_op INT,
  cart_label_op VARCHAR(255),
  amount_per_op DECIMAL(10, 2),
  discount_op DECIMAL(10, 2),
  amount_refunded_op DECIMAL(10, 2),
`;

const index_fields = `
  PRIMARY KEY (member_number_members_sa, id_membership_periods_sa),
   
  INDEX idx_id_events (id_events),
  INDEX idx_name_events (name_events),
  INDEX idx_name_events_starts_events (name_events, starts_events),
  
  INDEX idx_real_membership_types (real_membership_types_sa),
  INDEX idx_new_member_category_6 (new_member_category_6_sa),
  INDEX idx_source_2 (source_2_sa),
  
  INDEX idx_created_at (created_at_ma),

  INDEX idx_starts (starts_mp),
  INDEX idx_ends (ends_mp),
  
  INDEX idx_date_of_birth_profiles (date_of_birth_profiles),
  INDEX idx_date_of_birth_ma (date_of_birth_ma),
  INDEX idx_date_of_birth_registration_audit (date_of_birth_registration_audit),

  INDEX idx_member_number (member_number_members),

  INDEX idx_origin_flag_ma (origin_flag_ma(255))
`;

async function query_create_all_membership_sales_table(table_name) {

  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${derived_fields}
      ${addresses_table}
      ${events_table}
      ${membership_applications_table}
      ${membership_period_table}
      ${members_table}
      ${membership_types_table}
      ${profiles_table}
      ${orders_products_table}
      ${registration_audit_table}
      ${registration_companies}
      ${users_table}
      ${select_fields}
      ${index_fields}
    );
  `;

  return query;
}

module.exports = {
  query_create_all_membership_sales_table,
}
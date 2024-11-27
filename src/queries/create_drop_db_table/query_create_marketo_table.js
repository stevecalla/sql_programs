// Define the fields for the table
// Define the fields for the table with exact field names
const email_fields = `
  id INT PRIMARY KEY,
  marketo_GUID VARCHAR(255) NOT NULL,
  lead_id INT NOT NULL,
  activity_date_utc DATETIME,
  activity_type_id INT,
  campaign_id INT,
  primary_attribute_value_id INT,
  primary_attribute_value VARCHAR(255),
  bot_activity_pattern VARCHAR(255),
  browser VARCHAR(255),
  campaign_run_id INT,
  choice_number INT,
  device VARCHAR(255),
  is_bot_activity VARCHAR(255),
  is_mobile_device VARCHAR(255),
  platform VARCHAR(255),
  step_id INT,
  user_agent VARCHAR(255),
  campaign VARCHAR(255),
  activity_type_desc VARCHAR(255),
  segment VARCHAR(255),
  created_at_utc DATETIME
`;

// Define the index fields for the table
const index_fields = `
  INDEX idx_lead_id (lead_id),
  INDEX idx_activity_date_utc (activity_date_utc),
  INDEX idx_campaign_id (campaign_id),
  INDEX idx_is_bot_activity (is_bot_activity),
  INDEX idx_is_mobile_device (is_mobile_device),
  INDEX idx_primary_attribute_value (primary_attribute_value),
  INDEX idx_activity_type_desc (activity_type_desc),
  INDEX idx_segment (segment)
`;

// The table name
const table_name = 'marketo_email_data';

// The query to create the table
async function query_create_marketo_table(table_name) {
  return `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${email_fields},
      ${index_fields}
    );
  `
}

// Function to initialize the tables library with the create queries
async function initializeTables() {
  const email_table_name = 'marketo_email_data';
  const temp_table_name = 'marketo_temp_table';

  const tables_library = [
    { 
      table_name: email_table_name,
      create_query: await query_create_marketo_table(email_table_name),
      step: "STEP #2:",
      step_info: "marketo_email_data",
    },
    { 
      table_name: temp_table_name,
      create_query: await query_create_marketo_table(temp_table_name),
      step: "STEP TBD:",
      step_info: "temp table",
    },
  ];

  return tables_library;
}

module.exports = {
  initializeTables,
  query_create_marketo_table,
};

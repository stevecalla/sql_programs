// Define the fields for the table (these should match the columns in the CSV and table)
const email_fields = `
    id,
    marketo_GUID,
    lead_id,

    @activity_date_utc,

    activity_type_id,
    campaign_id,
    primary_attribute_value_id,
    primary_attribute_value,
    bot_activity_pattern,
    browser,
    campaign_run_id,
    choice_number,
    device,
    is_bot_activity,
    is_mobile_device,
    platform,
    step_id,
    user_agent,
    campaign,
    activity_type_desc,
    segment,

    @created_at_utc
`;

// Define any necessary transformations (e.g., date format handling)
const transform_fields = `
    -- CONVERT 2024-11-06T00:00:01Z TO '2024-11-06 00:00:00'
    activity_date_utc = IFNULL(STR_TO_DATE(REPLACE(@activity_date_utc, 'Z', ''), '%Y-%m-%dT%H:%i:%s'), NOW()),

    -- CONVERT 2024-11-09T21:14:04.190Z TO '2024-11-09 21:14:04'
    created_at_utc = IFNULL(STR_TO_DATE(REPLACE(SUBSTRING_INDEX(@created_at_utc, '.', 1), 'Z', ''), '%Y-%m-%dT%H:%i:%s'), NOW())
`;

// Function to generate the LOAD DATA query for loading data into the table
    // LOAD DATA INFILE 'C:\ProgramData\MySQL\MySQL Server 8.0\Uploads\data\usat_marketo_data\activity_data_11-09-2024_five_rows.csv`
async function query_load_marketo_data(filePath, table) {
    return `
        LOAD DATA LOCAL INFILE '${filePath}'
        INTO TABLE ${table}
        FIELDS TERMINATED BY ','      -- Assuming CSV columns are comma-separated
        ENCLOSED BY '"'               -- Assuming values are enclosed in double quotes
        LINES TERMINATED BY '\\n'     -- Each line is a new record
        IGNORE 1 LINES                -- Ignore the first line (header)
        (
            ${email_fields}           -- Fields to load into the table
        )   
        SET 
            ${transform_fields};      -- Apply transformations (e.g., date format)
        `;
}

module.exports = {
    email_fields,
    query_load_marketo_data,
};



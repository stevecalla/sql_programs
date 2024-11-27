async function query_update_or_insert_into_main(email_table_name, temp_table_name) {
    
    return `
        -- Step 3: Insert into the main table_name or update if the record already exists
        INSERT INTO ${email_table_name} (
                id,
                marketo_GUID,
                lead_id,
                activity_date_utc,
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
                created_at_utc
            )
            SELECT 
                t.id,
                t.marketo_GUID,
                t.lead_id,
                t.activity_date_utc,
                t.activity_type_id,
                t.campaign_id,
                t.primary_attribute_value_id,
                t.primary_attribute_value,
                t.bot_activity_pattern,
                t.browser,
                t.campaign_run_id,
                t.choice_number,
                t.device,
                t.is_bot_activity,
                t.is_mobile_device,
                t.platform,
                t.step_id,
                t.user_agent,
                t.campaign,
                t.activity_type_desc,
                t.segment,
                t.created_at_utc
            FROM ${temp_table_name} AS t
            ON DUPLICATE KEY UPDATE
                activity_date_utc = t.activity_date_utc,
                activity_type_id = t.activity_type_id,
                campaign_id = t.campaign_id,
                primary_attribute_value_id = t.primary_attribute_value_id,
                primary_attribute_value = t.primary_attribute_value,
                bot_activity_pattern = t.bot_activity_pattern,
                browser = t.browser,
                campaign_run_id = t.campaign_run_id,
                choice_number = t.choice_number,
                device = t.device,
                is_bot_activity = t.is_bot_activity,
                is_mobile_device = t.is_mobile_device,
                platform = t.platform,
                step_id = t.step_id,
                user_agent = t.user_agent,
                campaign = t.campaign,
                activity_type_desc = t.activity_type_desc,
                segment = t.segment,
                created_at_utc = t.created_at_utc;
    `;
}

module.exports = {
    query_update_or_insert_into_main,
};

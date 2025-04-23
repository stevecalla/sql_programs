function step_2_query_event_data() {
    return `
        SELECT 
            e.*,
            rg.state_code AS region_state_code,	
            rg.region_name,
            rg.region_abbr

        FROM all_event_data_raw AS e
            LEFT JOIN region_data AS rg ON rg.state_code = e.state_code_events

        WHERE 1 = 1
        ORDER BY id_events DESC, id_races ASC
        -- LIMIT 10 OFFSET 0
        ;
    `;
}

module.exports = {
    step_2_query_event_data,
}
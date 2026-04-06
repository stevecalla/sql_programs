const { fields_recognition_allocation_data } = require("./query_rev_recognition_allocation_data");

const fields_recognition_allocation_data_history = `
    DATE_FORMAT(as_of_snapshot_date_mtn, '%Y-%m-%d %H:%i:%s') AS as_of_snapshot_date_mtn,
    snapshot_version,
`;

async function query_rev_recognition_allocation_data_history(batch_size = 10, offset = 0) {
    return `
        SELECT
            ${fields_recognition_allocation_data_history}
            ${fields_recognition_allocation_data}
                
        FROM rev_recognition_allocation_data_history
        WHERE 1 = 1
        ORDER BY 
            DATE_FORMAT(as_of_snapshot_date_mtn, '%Y-%m-%d %H:%i:%s'),
            snapshot_version,
            id_profiles, 
            id_membership_periods_sa, 
            revenue_year_month
        LIMIT ${batch_size} OFFSET ${offset}
        -- LIMIT 1 OFFSET 1
        ;
    `;
}

module.exports = {
    query_rev_recognition_allocation_data_history
}
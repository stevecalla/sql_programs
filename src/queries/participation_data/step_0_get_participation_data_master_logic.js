const { step_1_get_participation_data } = require('./step_1_get_participation_data'); // step 1

async function query_step_0_participant_data_master_logic(start_date, end_date, offset, batch_size) {
    const query_list = step_1_get_participation_data(start_date, end_date, offset, batch_size);

    return query_list;
}

module.exports = {
    query_step_0_participant_data_master_logic,
}
const { getFormattedDateAmPm } = require('../utilities/getCurrentDate');
const { slack_sales_data_seed } = require('./slack_seed_data');
const { slack_sales_data_format } = require('./slack_sales_data_format');

// CREATE DATE INFO
async function date_info(data) {
  // DATE INFO
  const query_date = `${getFormattedDateAmPm(data[0].queried_at_mtn)} MTN`;
  const queried_at_message = `*Info Queried At:* ${query_date}`;

  const most_recent_date = `${getFormattedDateAmPm(data[0].max_purchased_on_mtn)} MTN`;
  const most_recent_date_message = `*Most Recent Purchase At:* ${most_recent_date}`;

  return { queried_at_message, most_recent_date_message };
}

async function create_slack_sales_message(data) {

  // TEXT OUTPUT
  const { table_output_by_real_membership_type, table_output_by_origin_flag, table_output_by_new_membership_type, table_output_is_incentive_eligible } = await slack_sales_data_format(data);

  let { queried_at_message, most_recent_date_message } = await date_info(data);

  // 📈🤼🚴‍♂️🥇👀📢🏊‍♂️🏃‍♀️🚴‍♂️🕕

  // FINAL MESSAGE
  const slackMessage = 
    `\n**************\n` +    
    `👀 *MEMBERSHIP SNAPSHOT - SALES UNITS*\n` +
    `📢 ${queried_at_message}\n` +
    `🕕 ${most_recent_date_message}\n` + // took this out because the most recent lead at looks wrong
    `--------------\n` +
    `*🥇 BFTD Gift Card Eligible (Direct Only >= 11/29/24 6 AM):* \n` + 
    `\`\`\`${table_output_is_incentive_eligible}\n* Total sales units. Review necessary to identify stacking.\`\`\`` + `\n`+
    `*🏊‍♂️ By Product:* \n` + 
    `\`\`\`${table_output_by_new_membership_type}\n * Other = Elite, Platinum, Youth Annual/Premier, Young Adult.\`\`\`` + `\n` + 
    `*🏃‍♀️ By Type:* \n` +
    `\`\`\`${table_output_by_real_membership_type}\`\`\`` + `\n`+
    `*🚴‍♂️ By Channel:* \n` + 
    `\`\`\`${table_output_by_origin_flag}\n* Sub = Subscription Renewal.\`\`\`` + `\n`+

    // `* Sub = Subscription Renewal\n` +
    // `* Other = Elite, Platinum, Youth Annual/Premier, Young Adult\n` +
    `**************\n`
  ;

  // console.log('slack_sales_message.js = ', slackMessage);

  return slackMessage;
}

// TESTING FUNCTION
// async function testing() {

  // TEST WITH SEED DATA
  // let slack_message = await create_slack_sales_message(slack_sales_data_seed);
  // console.log(slack_message);
  
  // const { slack_message_api } = require('./slack_message_api');
  // await slack_message_api(slack_message, "steve_calla_slack_channel");
  
  // TEST VIA THE API
  // const { execute_get_daily_sales_data_seed } = require('../daily_lead_setup/step_1_sql_get_daily_sales_data_seed');
  // let data = await execute_get_daily_sales_data_seed();

  // let slack_message= await create_daily_lead_slack_message(data);
  
  // const { slack_message_steve_calla_channel } = require('./slack_steve_calla_channel');
  // await slack_message_steve_calla_channel(slack_message);
// }

// testing();

module.exports = {
  create_slack_sales_message,
}
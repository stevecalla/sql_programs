const { getFormattedDateAmPm } = require('../../utilities/getCurrentDate');
const { generate_revenue_markdown_table } = require('./step_1b_generate_revenue_markdown');

const { revenue_seed_data } = require('./step_4_slack_seed_data');

// CREATE DATE INFO
async function date_info(data) {
  // DATE INFO
  const query_date = `${getFormattedDateAmPm(data[0].created_at_mtn)} MTN`;
  const updated_at_message = `*Info Updated At:* ${query_date}`;

  return { updated_at_message };
}

  // CREATE LOOKER STUDIO LINKS
async function looker_links() {
  const link_dashboard = `https://lookerstudio.google.com/u/0/reporting/f457edb4-c842-4632-8844-4273ecf05da5/page/p_bc9xthh1rd`;
  
  const looker_forecast_dashboard_link = `<${link_dashboard}|Link to Goals Dashboard>`;

  return looker_forecast_dashboard_link;
}

async function get_month_name(month_num) {
  const month_names = [
    "Year-to-Date", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const month_name = month_num === "ytd" ? month_names[0] : month_names[month_num];

  console.log(`********** month_num = `, month_num, month_name);

  return month_name;
}

async function create_slack_revenue_message(result, type_input = "All", category_input = "All", month) {

  const { data } = result[0];

  // TABLE OUTPUT
  // Ensure `month` is a number (or null/undefined if not set)
  let month_name = "";
  let is_ytd_row = "";
  if (month === 'ytd') {
    month = "";
    is_ytd_row = 1;
    month_name = await get_month_name(0);
  } else {
    month = month !== undefined && month !== null ? Number(month) : new Date().getMonth() + 1;
    month_name = await get_month_name(month);
  }
  const options = { data: data, is_ytd_row: is_ytd_row, month: month, month_name: month_name};
  
  // console.log(data);
  // console.log(options);

  const table = await generate_revenue_markdown_table(options);

  let { updated_at_message } = await date_info(data);

  // MESSAGE
  // 📈🤼🚴‍♂️🥇👀📢🏊‍♂️🏃‍♀️🚴‍♂️🕕ℹ️
  const slackMessage =    
    `📢 *MEMBERSHIP - REVENUE SNAPSHOT*\n` +
    `🕕 ${updated_at_message}\n` +
    `📈 ${await looker_links()}` + `\n` +
    `ℹ️ *Month:* ${month_name}, *Type:* ${type_input}, *Category:* ${category_input}` + `\n` +
      `\`\`\`${table}\n \`\`\``
  ;

  // console.log('slack_sales_message.js = ', slackMessage);

  return slackMessage;
}

// TESTING FUNCTION
// async function testing() {

//   // TEST WITH SEED DATA
//   const { revenue_seed_data } = require('./step_4_slack_seed_data');

//   // const { generate_revenue_markdown_table } = require('./step_3_slack_sales_data_format');
//   // const options = { data: revenue_seed_data, is_current_month: "", is_ytd_row: "", month: 5 }; // result = may
//   // generate_revenue_markdown_table(options);
  
//   let slack_message = await create_slack_sales_message(revenue_seed_data);
//   console.log(slack_message);
  
//   // const { slack_message_api } = require('./slack_message_api');
//   // await slack_message_api(slack_message, "steve_calla_slack_channel");
// }

// testing();

module.exports = {
  create_slack_revenue_message,
}
const { getFormattedDateAmPm } = require('../utilities/getCurrentDate');
const { sales_data_seed, slack_sales_data_seed } = require('./slack_seed_data');
const { slack_sales_data_format } = require('./slack_sales_data_format');

function generateLeadSummary(outputText, segment) {
  // Destructure the values from the output object
  const {
    yesterday_leads,
    today_leads,
    yesterday_booking_cancelled,
    yesterday_booking_confirmed,
    yesterday_booking_total,
    today_booking_cancelled,
    today_booking_confirmed,
    today_booking_total,
    yesterday_booking_conversion,
    today_booking_conversion,
  } = outputText;

  // Generate the lead summary based on the segment
  let leadSummary = '';

  if (segment === 'all') {
    leadSummary = `LEADS - ALL COUNTRIES\n` +
      `${today_leads}, Bookings Confirmed - ${today_booking_confirmed}, Conversion - ${today_booking_conversion}\n` +
      `${yesterday_leads}, Bookings Confirmed - ${yesterday_booking_confirmed}, Conversion - ${yesterday_booking_conversion}\n` +
      `--------------`;
  } else if (segment === 'uae_country') {
    leadSummary = `LEADS - UAE ONLY\n` +
      `${today_leads}, Bookings Confirmed - ${today_booking_confirmed}, Conversion - ${today_booking_conversion}\n` +
      `${yesterday_leads}, Bookings Confirmed- ${yesterday_booking_confirmed}, Conversion - ${yesterday_booking_conversion}\n` +
      `--------------`;
  } else if (segment === 'uae_source') {
    leadSummary = `SOURCE - UAE ONLY\n` +
      `${today_leads}\n${today_booking_conversion} (conversion)\n` +
      `${yesterday_leads}\n${yesterday_booking_conversion} (conversion)\n` +
      `--------------`;
  } else if (segment === 'all_countries') {
    leadSummary = `LEADS - ALL COUNTRIES\n` +
      `${today_leads}\n${today_booking_conversion} (conversion)\n` + 
      `${yesterday_leads}\n${yesterday_booking_conversion} (conversion)\n` +
      `UNK: Unknown = country blank\n` +
      `--------------`;
  } else if (segment === 'all_source') {
    leadSummary = `SOURCE - ALL COUNTRIES\n` +
      `${yesterday_leads}\n${yesterday_booking_conversion} (conversion)\n` +
      `${today_leads}\n${today_booking_conversion} (conversion)`;
  }

  return leadSummary;
}

// CREATE DATE INFO
async function date_info(data) {
  // DATE INFO
  const query_date = `${getFormattedDateAmPm(data[0].queried_at_gst)} GST`;
  const queried_at_message = `Info Queried At: ${query_date}`;

  const most_recent_date = `${getFormattedDateAmPm(data[0].max_created_on_gst)} GST`;
  const most_recent_date_message = `Most Recent Lead At: ${most_recent_date}`;

  return { queried_at_message, most_recent_date_message };
}

async function create_slack_sales_message(data) {

  // TEXT OUTPUT
  const { only_all_countries_output_text, all_countries_output_text, all_source_output_text, uae_only_country_output_text, uae_only_source_output_text, table_output_by_country, table_output_by_source } = await slack_sales_data_format(data);

  const all_summary = generateLeadSummary(only_all_countries_output_text, 'all');
  const lead_uae_country = generateLeadSummary(uae_only_country_output_text, 'uae_country');
  // const lead_uae_source = generateLeadSummary(uae_only_source_output_text, 'uae_source');
  // const lead_all_countries = generateLeadSummary(all_countries_output_text, 'all_countries');
  // const lead_all_source = generateLeadSummary(all_source_output_text, 'all_source');

  // TABLES OUTPUT
  const { today_table_by_segment: today_table_by_country, yesterday_table_by_segment: yesterday_table_by_country } = table_output_by_country;
  const { today_table_by_segment: today_table_by_source, yesterday_table_by_segment: yesterday_table_by_source } = table_output_by_source;

  let { queried_at_message, most_recent_date_message } = await date_info(data);

  // FINAL MESSAGE
  const slackMessage = 
  `\n**************\n` +
  `LEADS DATA\n` +
  `${queried_at_message}\n` +
  //`${most_recent_date_message}\n` + // took this out because the most recent lead at looks wrong
  `--------------\n` +
  `${lead_uae_country}\n` +
  `${all_summary}\n` +
    // `${lead_uae_source}\n` +
    // `${lead_all_countries}\n` +
    // `${lead_all_source}\n` + 
    "*Today - By Country:* \n" + 
    `\`\`\`${today_table_by_country}\`\`\`` + `\n` + 
    // "*Yesterday - By Country:* \n" + 
    // `\`\`\`${yesterday_table_by_country}\`\`\`` + `\n`+
    "*Today - By Source:* \n" +
    `\`\`\`${today_table_by_source}\`\`\`` + `\n`+

    `"Conv %" = Conversion Ratio; "Conf" = Confirmed; "Same" = Same \n` +
    `**************\n` +
    // `"Conf" = Confirmed\n` +
    // `"Same" = Same Day\n` +  
    `Response Time: IN PROGRESS\n` +
    `Conversion - Same Day: IN PROGRESS\n` +
    `**************\n`
  ;

  console.log('slack_sales_message.js = ', slackMessage);

  return slackMessage;
}

// TESTING FUNCTION
async function testing() {

  // TEST WITH SEED DATA
  let slack_message = await create_slack_sales_message(sales_data_seed);
  let slack_message_v2 = await create_slack_sales_message(slack_sales_data_seed);
  
  // console.log(slack_message);
  
  // const { slack_message_api } = require('./slack_message_api');
  // await slack_message_api(slack_message, "steve_calla_slack_channel");
  
  // TEST VIA THE API
  // const { execute_get_daily_sales_data_seed } = require('../daily_lead_setup/step_1_sql_get_daily_sales_data_seed');
  // let data = await execute_get_daily_sales_data_seed();

  // let slack_message= await create_daily_lead_slack_message(data);
  
  // const { slack_message_steve_calla_channel } = require('./slack_steve_calla_channel');
  // await slack_message_steve_calla_channel(slack_message);
}

testing();

module.exports = {
  create_slack_sales_message,
}
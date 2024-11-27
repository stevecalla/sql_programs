const dayjs = require('dayjs');
const { slack_sales_data_seed } = require('./slack_seed_data');

async function sort_segment(data, criteria) {
  // Step 1: Separate 'Other', 'Elite', '3-Year', and 'Total'
  const other_or_elite = data.filter(item => item[criteria] === 'Other' || item[criteria] === 'Elite');
  const three_year = data.filter(item => item[criteria] === '3-Year');
  const total_entries = data.filter(item => item[criteria] === 'Total'); // Handle all 'Total' entries
  
  // Step 2: Filter out 'Other', 'Elite', '3-Year', and 'Total' for normal sorting
  const sortedData = data.filter(item =>
    item[criteria] !== 'Total' && item[criteria] !== 'Other' && item[criteria] !== 'Elite' && item[criteria] !== '3-Year'
  ).sort((a, b) => {
    if (a[criteria] < b[criteria]) return -1;
    if (a[criteria] > b[criteria]) return 1;
    return 0;
  });

  // Step 3: Add '3-Year' entries
  if (three_year.length > 0) {
    sortedData.push(...three_year);
  }

  // Step 4: Add 'Other' and 'Elite'
  if (other_or_elite.length > 0) {
    sortedData.push(...other_or_elite);
  }

  // Step 5: Add 'Total' entries at the end
  if (total_entries.length > 0) {
    sortedData.push(...total_entries);
  }

  return sortedData;
}

async function format_table(data, segment) {
  if (!data || data.length === 0) {
    return "No data provided";
  }

  // Extract unique purchased_on and membership types
  const purchasedOnValues = [...new Set(data.map(item => item.purchased_on))];
  const membershipTypes = [...new Set(data.map(item => item[segment]))];

  // Ensure 'Total' is included in membership types
  if (!membershipTypes.includes('Total')) {
    membershipTypes.push('Total');
  }

  const headers = ['purchased_on', ...membershipTypes];

  // Create the table data
  const formattedData = purchasedOnValues.map(date => {
    const row = { purchased_on: date };
    membershipTypes.forEach(type => {
      const matchingData = data.find(item => item.purchased_on === date && item[segment] === type);
      row[type] = matchingData ? matchingData.total_count_units : 0;
    });
    return row;
  });

    // Calculate the maximum width for each column
    const columnWidths = headers.map((header) =>
      Math.max(
        ...formattedData.map((row) => row[header].toString().length),
        header.length
      )
    );
  
    // Create the divider
    const divider =
      "+" +
      headers.map((header, i) => "-".repeat(columnWidths[i] + 2)).join("+") +
      "+";
  
    // Create the header row
    const headerRow =
      "|" +
      headers
        .map((header, i) => ` ${header.padEnd(columnWidths[i])} `)
        .join("|") +
      "|";
  
    // Generate each row of data
    const rows = formattedData.map(
      (row) =>
        "|" +
        headers
          .map((header, i) => ` ${row[header].toString().padEnd(columnWidths[i])} `)
          .join("|") +
        "|"
    );
  
    // Assemble the full table
    return [divider, headerRow, divider, ...rows, divider].join("\n");
}

async function rollup_by_segment(data, segment) {
    // Group the data by purchased_on_date_adjusted_mp_mtn and segment
    const grouped = data.reduce((acc, curr) => {
      const key = `${curr.purchased_on_date_adjusted_mp_mtn}_${curr[segment]}`;
      if (!acc[key]) {
        acc[key] = {
          purchased_on: curr.purchased_on_date_adjusted_mp_mtn,
          [segment]: curr[segment],
          total_count_units: 0
        };
      }
      acc[key].total_count_units += curr.count_units;
      return acc;
    }, {});
  
    // Convert grouped object to an array
    const result = Object.values(grouped);
  
    // Calculate grand totals for each purchased_on_date_adjusted_mp_mtn
    const grandTotals = data.reduce((acc, curr) => {
      if (!acc[curr.purchased_on_date_adjusted_mp_mtn]) {
        acc[curr.purchased_on_date_adjusted_mp_mtn] = {
          purchased_on: curr.purchased_on_date_adjusted_mp_mtn,
          [segment]: 'Total',
          total_count_units: 0
        };
      }
      acc[curr.purchased_on_date_adjusted_mp_mtn].total_count_units += curr.count_units;
      return acc;
    }, {});
  
    // Add the grand total objects to the result
    const grandTotalArray = Object.values(grandTotals);
    const finalResult = [...result, ...grandTotalArray];

    // console.log(finalResult);

    return finalResult;
}

async function create_table_output(data, segment) {
    // SEGMENT ROLLUPS
    const segment_rollup = await rollup_by_segment(data, segment);
    let segment_rollup_sorted = await sort_segment(segment_rollup, segment);

    // Format the tables
    // const table_by_segment = await format_table(segment_rollup, segment);
    const table_by_segment = await format_table(segment_rollup_sorted, segment);
    console.log(table_by_segment);

    return table_by_segment;
}

async function slack_sales_data_format(data) {
    const real_membership_types = 'real_membership_type';
    const origin_flag_category = 'origin_flag_category';
    const new_membership_type = 'new_membership_type';

    // CREATE TABLE OUTPUT
    const table_output_by_new_membership_type = await create_table_output(data, new_membership_type);
    const table_output_by_real_membership_type = await create_table_output(data, real_membership_types);
    const table_output_by_origin_flag = await create_table_output(data, origin_flag_category);

    return { table_output_by_real_membership_type, table_output_by_origin_flag, table_output_by_new_membership_type };
}

// slack_sales_data_format(slack_sales_data_seed);

module.exports = {
    slack_sales_data_format,
};

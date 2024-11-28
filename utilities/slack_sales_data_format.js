const { getDayOfWeek } = require('../utilities/getCurrentDate');
const { slack_sales_data_seed } = require('./slack_seed_data');

async function sortByDateAndSegment(data, dateField, segmentField) {
  // Define segment order for sorting
  const segmentOrder = {
    Bronze: 1,
    Silver: 2,
    Gold: 3,
    "3-Year": 4,
    Other: 5,
    Adult: 6,
    One_Day: 7,
    Youth: 8,
    Elite: 9,
    Audit: 10,
    Direct: 11,
    RTAV: 12,
    Sub: 13,
    default: 14, // Catch-all for other segments
  };

  // Step 1: Separate 'Total' entries
  const totalEntries = data.filter(item => item[segmentField] === "Total");
  const nonTotalEntries = data.filter(item => item[segmentField] !== "Total");

  // Step 2: Sort non-'Total' entries
  const sortedNonTotalEntries = nonTotalEntries.sort((a, b) => {
    // Compare by date
    const dateA = new Date(a[dateField]);
    const dateB = new Date(b[dateField]);
    if (dateA - dateB !== 0) {
      return dateA - dateB; // Sort by date (ascending)
    }

    // Compare by segment
    const segmentRankA = segmentOrder[a[segmentField]] || segmentOrder.default;
    const segmentRankB = segmentOrder[b[segmentField]] || segmentOrder.default;
    return segmentRankA - segmentRankB; // Sort by predefined segment order
  });

  // Step 3: Add 'Total' entries at the end
  return [...sortedNonTotalEntries, ...totalEntries];
}

async function format_table(data, segment) {
  if (!data || data.length === 0) {
    return "No data provided";
  }

  // Extract unique purchased dates and membership types
  const purchasedOnValues = [...new Set(data.map(item => item.purchased))];
  const membershipTypes = [...new Set(data.map(item => item[segment]))];

  // Ensure 'Total' is included in membership types
  if (!membershipTypes.includes("Total")) {
    membershipTypes.push("Total");
  }

  // Include 'day' column in headers
  const headers = ["purchased", "day", ...membershipTypes];

  // Create the table data
  const formattedData = purchasedOnValues.map(date => {
    // Find the day for the current date
    const matchingDayEntry = data.find(item => item.purchased === date);
    const day = matchingDayEntry ? matchingDayEntry.day : ""; // Use an empty string if day is missing

    const row = { purchased: date, day: day };
    membershipTypes.forEach(type => {
      const matchingData = data.find(
        item => item.purchased === date && item[segment] === type
      );
      row[type] = matchingData ? matchingData.total_count_units : 0;
    });
    return row;
  });

  // Calculate the maximum width for each column
  const columnWidths = headers.map(header =>
    Math.max(
      ...formattedData.map(row => row[header]?.toString().length || 0),
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
    row =>
      "|" +
      headers
        .map((header, i) => ` ${row[header]?.toString().padEnd(columnWidths[i])} `)
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
          purchased: curr.purchased_on_date_adjusted_mp_mtn,
          day: getDayOfWeek(curr.purchased_on_date_adjusted_mp_mtn),
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
          purchased: curr.purchased_on_date_adjusted_mp_mtn,
          day: getDayOfWeek(curr.purchased_on_date_adjusted_mp_mtn),
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
    const segment_rollup_sorted = await sortByDateAndSegment(segment_rollup, 'purchased', segment);

    // Format the tables
    const table_by_segment = await format_table(segment_rollup_sorted, segment);

    // console.log(table_by_segment);

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

slack_sales_data_format(slack_sales_data_seed);

module.exports = {
    slack_sales_data_format,
};

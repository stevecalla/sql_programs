const dayjs = require('dayjs');
const { lead_data } = require('./seed_data');

async function create_summary(data, option, segmentField, is_value_only) {
    let summary = '';
    let emoji = option.includes('today') ? '⏳' : '🍿';
    const day_label = option.includes('today') ? 'Today:       ' : 'Yesterday: ';
  
    if (segmentField === 'renting_in_country') {
        data.forEach(item => {
            const { renting_in_country } = item;
    
            // Get the first three characters in uppercase or 'UAE' for United Arab Emirates
            const countryCode = renting_in_country === 'United Arab Emirates' ? 'UAE' : renting_in_country.slice(0, 3).toUpperCase();
    
            // Dynamically access the value using the 'option' key
            const value = item[option] || 0;  // Default to 0 if the key is not found
    
            // Append to summary
            is_value_only ? summary += `${value}, ` : summary += `${countryCode}: ${value}, `;
            // is_value_only && option.includes('booking') ? summary += `${value}, ` : summary += `${countryCode}: ${value}, `;
        })
    } else if (
        data.forEach(item => {
            const { source_name } = item;
    
            // Dynamically access the value using the 'option' key
            const value = item[option] || 0;  // Default to 0 if the key is not found
    
            // Append to summary
            is_value_only ? summary += `${value}, ` : summary += `${source_name}: ${value}, `;
            // is_value_only && option.includes('booking') ? summary += `${value}, ` : summary += `${source_name}: ${value}, `;
        })
    );

    summary =  option.includes('booking') && is_value_only ? `${summary.slice(0, -2)}` : `${emoji} ${day_label} ${summary.slice(0, -2)}`;
    
    return summary
}

async function sort_segment(data, criteria) {
    // Validate criteria to be either 'renting_in_country' or 'source_name'
    if (criteria !== 'renting_in_country' && criteria !== 'source_name') {
        throw new Error("Invalid sort criteria. Use 'renting_in_country' or 'source_name'.");
    }

    // Sort based on the provided criteria
    return data.sort((a, b) => {
        if (a[criteria] < b[criteria]) return -1;
        if (a[criteria] > b[criteria]) return 1;
        return 0;
    });
}

async function format_table(data) {
    // source: https://knock.app/blog/how-to-render-tables-in-slack-markdown

    if (!data || data.length === 0) {
      return "No data provided";
    }
  
    // Extract headers from the first object's keys
    const headers = Object.keys(data[0]);
  
    // Calculate the maximum width for each column
    const columnWidths = headers.map((header) =>
      Math.max(
        ...data.map((row) => row[header].toString().length),
        header.length,
      ),
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
    const rows = data.map(
      (row) =>
        "|" +
        headers
          .map(
            (header, i) => ` ${row[header].toString().padEnd(columnWidths[i])} `,
          )
          .join("|") +
        "|",
    );
  
    // Assemble the full table
    return [divider, headerRow, divider, ...rows, divider].join("\n");
}

function conversion(booking_confirmed, leads) {
    let conversion = 0;

    // Ensure there's no division by zero
    if (leads > 0) {
        conversion = (booking_confirmed / leads) * 100;
    }

    // Format yesterday's conversion based on the value
    if (conversion === 0) {
        conversion = "0%";
    } else if (conversion >= 1) {
        conversion = conversion.toFixed(0) + "%";
    } else {
        conversion = conversion.toFixed(2) + "%";
    }

    return conversion;
}

async function rollup_by_segment(data, segmentField) {
    // Create a result object to store the rolled-up data for Yesterday and Today
    const result = {};

    // Track unique dates and segment values (e.g., country, source, etc.)
    const uniqueDates = new Set();
    const uniqueSegments = new Set();

    // Step 1: Gather all unique dates and segments from the data
    data.forEach(item => {
        const { created_on_gst, count_leads, count_booking_cancelled, count_booking_confirmed, count_booking_total } = item;
        let segmentValue = item[segmentField] || 'UNKNOWN';  // Get the segment value dynamically (e.g., renting_in_country, source_name, etc.)

        // Handle any special cases (e.g., converting "UNI" to "UAE")
        if (segmentField === 'renting_in_country' && segmentValue.slice(0, 3).toUpperCase() === "UNI") {
            segmentValue = "UAE";
        }

        // Add to unique sets
        uniqueDates.add(created_on_gst);
        uniqueSegments.add(segmentValue);

        const key = `${created_on_gst}_${segmentValue}`;  // Create a unique key based on the date and segment value

        // If the key does not exist in the result, initialize it
        if (!result[key]) {
            result[key] = {
                created_on_gst,
                [segmentField]: segmentValue,
                total_leads: 0,
                count_booking_cancelled: 0,
                count_booking_confirmed: 0,
                count_booking_total: 0,
            };
        }
        
        // Add the count_leads and other values to the totals for that key
        result[key].total_leads += count_leads;
        result[key].count_booking_cancelled += count_booking_cancelled;
        result[key].count_booking_confirmed += count_booking_confirmed;
        result[key].count_booking_total += count_booking_total;
    });

    // Step 2: Ensure each segment has entries for "Yesterday" and "Today" with total_leads set to 0 if missing
    const minDate = Math.min(...Array.from(uniqueDates).map(d => new Date(d).getTime()));
    const maxDate = Math.max(...Array.from(uniqueDates).map(d => new Date(d).getTime()));
    const minDateStr = new Date(minDate).toISOString().split('T')[0]; // format as 'YYYY-MM-DD'
    const maxDateStr = new Date(maxDate).toISOString().split('T')[0]; // format as 'YYYY-MM-DD'

    uniqueSegments.forEach(segment => {
        // Create entries for "Yesterday" and "Today" for each segment
        if (!result[`${minDateStr}_${segment}`]) {
            result[`${minDateStr}_${segment}`] = {
                created_on_gst: "Yesterday",
                [segmentField]: segment,
                total_leads: 0,
                count_booking_cancelled: 0,
                count_booking_confirmed: 0,
                count_booking_total: 0,
            };
        }
        if (!result[`${maxDateStr}_${segment}`]) {
            result[`${maxDateStr}_${segment}`] = {
                created_on_gst: "Today",
                [segmentField]: segment,
                total_leads: 0,
                count_booking_cancelled: 0,
                count_booking_confirmed: 0,
                count_booking_total: 0,
            };
        }
    });

    // Step 3: Organize the final output as [{ segment, yesterday: value, today: value }]
    const finalResult = [];
    let overallYesterdayTotal = 0;
    let overallTodayTotal = 0;
    let overallYesterdayBookingCancelled = 0;
    let overallTodayBookingCancelled = 0;
    let overallYesterdayBookingConfirmed = 0;
    let overallTodayBookingConfirmed = 0;
    let overallYesterdayBookingTotal = 0;
    let overallTodayBookingTotal = 0;

    uniqueSegments.forEach(segment => {
        const yesterdayLeads = result[`${minDateStr}_${segment}`] ? result[`${minDateStr}_${segment}`].total_leads : 0;
        const todayLeads = result[`${maxDateStr}_${segment}`] ? result[`${maxDateStr}_${segment}`].total_leads : 0;

        const yesterday_booking_cancelled = result[`${minDateStr}_${segment}`] ? result[`${minDateStr}_${segment}`].count_booking_cancelled : 0;
        const today_booking_cancelled = result[`${maxDateStr}_${segment}`] ? result[`${maxDateStr}_${segment}`].count_booking_cancelled : 0;

        const yesterday_booking_confirmed = result[`${minDateStr}_${segment}`] ? result[`${minDateStr}_${segment}`].count_booking_confirmed : 0;
        const today_booking_confirmed = result[`${maxDateStr}_${segment}`] ? result[`${maxDateStr}_${segment}`].count_booking_confirmed : 0;

        const yesterday_booking_total = result[`${minDateStr}_${segment}`] ? result[`${minDateStr}_${segment}`].count_booking_total : 0;
        const today_booking_total = result[`${maxDateStr}_${segment}`] ? result[`${maxDateStr}_${segment}`].count_booking_total : 0;       

        const yesterdayBookingConversion = conversion(yesterday_booking_confirmed, yesterdayLeads) || "error";
        const todayBookingConversion = conversion(today_booking_confirmed, todayLeads) || "error";

        finalResult.push({
            [segmentField]: segment,
            yesterday_leads: yesterdayLeads,
            today_leads: todayLeads,
            yesterday_booking_cancelled,
            yesterday_booking_confirmed,
            yesterday_booking_total,
            today_booking_cancelled,
            today_booking_confirmed,
            today_booking_total,
            // Convert to percentages and append '%' symbol
            yesterday_booking_conversion: yesterdayBookingConversion,
            today_booking_conversion: todayBookingConversion,
        });

        // Accumulate the overall totals for Yesterday and Today
        overallYesterdayTotal += yesterdayLeads;
        overallTodayTotal += todayLeads;

        overallYesterdayBookingCancelled += yesterday_booking_cancelled;
        overallTodayBookingCancelled += today_booking_cancelled;

        overallYesterdayBookingConfirmed += yesterday_booking_confirmed;
        overallTodayBookingConfirmed += today_booking_confirmed;

        overallYesterdayBookingTotal += yesterday_booking_total;
        overallTodayBookingTotal += today_booking_total;
    });

    // Step 4: Add the "ALL" total entry
    const overallYesterdayBookingConversion = conversion(overallYesterdayBookingConfirmed, overallYesterdayTotal) || "error";
    const overallTodayBookingConversion = conversion(overallTodayBookingConfirmed, overallTodayTotal) || "error";

    finalResult.push({
        [segmentField]: "ALL",
        yesterday_leads: overallYesterdayTotal,
        today_leads: overallTodayTotal,
        yesterday_booking_cancelled: overallYesterdayBookingCancelled,
        yesterday_booking_confirmed: overallYesterdayBookingConfirmed,
        yesterday_booking_total: overallYesterdayBookingTotal,
        today_booking_cancelled: overallTodayBookingCancelled,
        today_booking_confirmed: overallTodayBookingConfirmed,
        today_booking_total: overallTodayBookingTotal,
        // Conversion rates as percentages, multiply by 100
        yesterday_booking_conversion: overallYesterdayBookingConversion,
        today_booking_conversion: overallTodayBookingConversion,
    });

    // Step 5: Return the final result
    return finalResult;
}

async function create_text_output(data, segmentField, is_value_only) {
    const option_stats = [
        'yesterday_leads', 
        'today_leads',
        'yesterday_booking_cancelled',
        'yesterday_booking_confirmed',
        'yesterday_booking_total',
        'today_booking_cancelled',
        'today_booking_confirmed',
        'today_booking_total',
        'yesterday_booking_conversion',
        'today_booking_conversion',
    ];

    // SEGMENT ROLLUPS
    const segment_rollup = await rollup_by_segment(data, segmentField);
    let segment_rollup_sorted = await sort_segment(segment_rollup, segmentField);

    // Remove 'ALL' if there are only two objects in the array
    segment_rollup_sorted = segment_rollup_sorted.length === 2 ? segment_rollup_sorted.filter(item => item.renting_in_country !== 'ALL') : segment_rollup_sorted;

    // ALL COUNTRIES WITH YESTERDAY & TODAY
    const output_text = {};

    for (let i = 0; i < option_stats.length; i++) {
        const formatted_output = await create_summary(segment_rollup_sorted, option_stats[i], segmentField, is_value_only);
        output_text[option_stats[i]] = formatted_output;
    }

    return output_text;
}

async function create_all_country_rollup_text_output(data, segmentField, is_value_only) {
    const option_stats = [
        'yesterday_leads', 
        'today_leads',
        'yesterday_booking_cancelled',
        'yesterday_booking_confirmed',
        'yesterday_booking_total',
        'today_booking_cancelled',
        'today_booking_confirmed',
        'today_booking_total',
        'yesterday_booking_conversion',
        'today_booking_conversion',
    ];

    // SEGMENT ROLLUPS
    const segment_rollup = await rollup_by_segment(data, segmentField);
    let segment_rollup_sorted = await sort_segment(segment_rollup, segmentField);

    // Remove 'ALL' if there are only two objects in the array
    segment_rollup_sorted = segment_rollup_sorted.filter(item => item.renting_in_country === 'ALL');

    // ALL COUNTRIES WITH YESTERDAY & TODAY
    const output_text = {};

    for (let i = 0; i < option_stats.length; i++) {
        const formatted_output = await create_summary(segment_rollup_sorted, option_stats[i], segmentField, is_value_only);
        output_text[option_stats[i]] = formatted_output;
    }

    return output_text;
}

async function create_table_output(data, segmentField, is_value_only) {
    // SEGMENT ROLLUPS
    const segment_rollup = await rollup_by_segment(data, segmentField);
    let segment_rollup_sorted = await sort_segment(segment_rollup, segmentField);

    // Helper function to map data based on whether it is "Today" or "Yesterday"
    const mapDataBySegment = (segmentData, dateType) => {
        return segmentData.map(item => {
            return {
                [dateType]: item.renting_in_country || item.source_name, // Changed 'renting_in_country' to 'renting_in_segment'
                Leads: item[`${dateType.toLowerCase()}_leads`] === 0 ? "" : item[`${dateType.toLowerCase()}_leads`],
                "Bookings: Conf": item[`${dateType.toLowerCase()}_booking_confirmed`] === 0 ? "" : item[`${dateType.toLowerCase()}_booking_confirmed`],
                "Conv %: Conf": item[`${dateType.toLowerCase()}_booking_conversion`] === "0%" ? "" : item[`${dateType.toLowerCase()}_booking_conversion`],
                "Bookings: Same": "TBD",
                "Conv %: Same": "TBD",
            };
        });
    };

    // Get "Today" and "Yesterday" data by segment
    let today_data_by_segment = mapDataBySegment(segment_rollup_sorted, "Today");
    let yesterday_data_by_segment = mapDataBySegment(segment_rollup_sorted, "Yesterday");

    // Format the tables
    let today_table_by_segment = await format_table(today_data_by_segment);
    let yesterday_table_by_segment = await format_table(yesterday_data_by_segment);
    
    return { today_table_by_segment, yesterday_table_by_segment };
}

async function group_and_format_data_for_slack(data) {
    const country = 'renting_in_country';
    const source = 'source_name';
    let is_value_only = false; // adjust formatting to only include the value / count not the segmentField & value/count

    // COUNTRY ROLLUP & OUTPUT TEXT
    const all_countries_output_text = await create_text_output(data, country, is_value_only);
    const all_source_output_text = await create_text_output(data, source, is_value_only);

    // SOURCE UAE ONLY ROLLUP & OUTPUT TEXT
    const uae_only_source = data.filter(({ renting_in_country }) => renting_in_country === 'United Arab Emirates');
    const uae_only_source_output_text = await create_text_output(uae_only_source, source, is_value_only);

    is_value_only = true;
    const uae_only_country_output_text = await create_text_output(uae_only_source, country, is_value_only);

    // CREATE ALL SUMMARY
    is_value_only = true;
    const only_all_countries_output_text = await create_all_country_rollup_text_output(data, country, is_value_only);

    // CREATE TABLE OUTPUT
    is_value_only = false;
    // CREATES A TABLE FOR TODAY & YESTERDAY BY COUNTRY
    const table_output_by_country = await create_table_output(data, country, is_value_only);
    const table_output_by_source = await create_table_output(data, source, is_value_only);

    return { only_all_countries_output_text, all_countries_output_text, all_source_output_text, uae_only_country_output_text, uae_only_source_output_text, table_output_by_country, table_output_by_source };
}

// group_and_format_data_for_slack(lead_data);

module.exports = {
    group_and_format_data_for_slack,
};

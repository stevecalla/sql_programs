async function generate_date_periods(startYear = 2010, membershipPeriodEnds = '2008-01-01', periodInterval = 6) {
    const periods = [];
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1; // JavaScript months are 0-indexed
    const maxEndYear = currentYear;  // Max year is the current year
    const maxEndMonth = currentMonth + 12; // Max month is the current month + 12

    // Loop over the years and generate periods
    let currentStartDate = new Date(startYear, 0); // Start date begins at January of the starting year

    while (currentStartDate.getFullYear() < maxEndYear || (currentStartDate.getFullYear() === maxEndYear && currentStartDate.getMonth() + 1 <= maxEndMonth)) {
        const startMonth = currentStartDate.getMonth() + 1; // 1-indexed month
        // Ensure the start date is formatted as 'YYYY-MM-01'
        const start_date = `${currentStartDate.getFullYear()}-${String(startMonth).padStart(2, '0')}-01`;
        const start_date_time = `${start_date} 00:00:00`;

        // Calculate the end date based on the selected interval
        
        let endDate;
        endDate = new Date(currentStartDate.getFullYear(), currentStartDate.getMonth() + periodInterval, 0);

        // if (periodInterval === 1) {
        //     // For 1 month interval, the end date is the last day of the same month
        //     endDate = new Date(currentStartDate.getFullYear(), currentStartDate.getMonth() + 1, 0); // Last day of the current month
        // } else if (periodInterval === 3) {
        //     // For 3 month interval, the end date is the last day of the 3rd month from start date
        //     endDate = new Date(currentStartDate.getFullYear(), currentStartDate.getMonth() + 3, 0); // Last day of the 3rd month
        // } else if (periodInterval === 6) {
        //     // For 6 month interval, the end date is the last day of the 6th month from start date
        //     endDate = new Date(currentStartDate.getFullYear(), currentStartDate.getMonth() + 6, 0); // Last day of the 6th month
        // }

        // Format the end date as required
        const end_date_time = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')} 23:59:59`;

        // Push the period object to the periods array
        periods.push({
            year: currentStartDate.getFullYear(),
            membership_period_ends: membershipPeriodEnds,
            start_date: start_date,
            start_date_time: start_date_time,
            end_date_time: end_date_time,
        });

        // Move the currentStartDate forward by the selected period interval (1 month, 3 months, or 6 months)
        currentStartDate.setMonth(currentStartDate.getMonth() + periodInterval);
    }

    return periods;
}

// Example Usage:
// const datePeriods = generate_date_periods(2023, '2008-01-01', 1); // Generate periods with 6 months interval
// console.log(datePeriods);

module.exports = {
    generate_date_periods
};

// EXAMPLE OUTPUT
// [
//     {
//         year: 2026,
//         membership_period_ends: '2008-01-01',
//         start_date: '2026-01-01',
//         start_date_time: '2026-01-01 00:00:00',
//         end_date_time: '2026-03-31 23:59:59'
//     },
//     {
//         year: 2026,
//         membership_period_ends: '2008-01-01',
//         start_date: '2026-04-01',
//         start_date_time: '2026-04-01 00:00:00',
//         end_date_time: '2026-06-30 23:59:59'
//     },
//     {
//         year: 2026,
//         membership_period_ends: '2008-01-01',
//         start_date: '2026-07-01',
//         start_date_time: '2026-07-01 00:00:00',
//         end_date_time: '2026-09-30 23:59:59'
//     },
//     {
//         year: 2026,
//         membership_period_ends: '2008-01-01',
//         start_date: '2026-10-01',
//         start_date_time: '2026-10-01 00:00:00',
//         end_date_time: '2026-12-31 23:59:59'
//     }
// ]
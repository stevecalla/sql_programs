async function generate_monthly_date_periods(startYear = 2010, membershipPeriodEnds = '2008-01-01') {
    const periods = [];
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1; // JavaScript months are 0-indexed
    const maxEndYear = currentYear + Math.floor((currentMonth + 12 - 1) / 12); // The year 12 months ahead
    const maxEndMonth = (currentMonth + 12 - 1) % 12 + 1; // The month 12 months ahead

    for (let year = startYear; year <= maxEndYear; year++) {
        for (let month = 1; month <= 12; month++) {
            // Stop if we exceed the max end year and month
            if (year === maxEndYear && month > maxEndMonth) break;

            const start_date = `${year}-${String(month).padStart(2, '0')}`;
            const start_date_time = `${year}-${String(month).padStart(2, '0')}-01 00:00:00`;

            // Calculate the last second of the current month
            const lastDayOfMonth = new Date(year, month, 0); // Last day of the current month
            const end_date_time = `${lastDayOfMonth.getFullYear()}-${String(lastDayOfMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDayOfMonth.getDate()).padStart(2, '0')} 23:59:59`;

            periods.push({
                year: year,
                membership_period_ends: membershipPeriodEnds,
                start_date: start_date,
                start_date_time: start_date_time,
                end_date_time: end_date_time,
            });
        }
    }

    return periods;
}

// const datePeriods = generate_monthly_date_periods(2023);
// console.log(datePeriods);

module.exports = {
    generate_monthly_date_periods
};

// EXAMPLE OUTPUT
// GENERATES AN ARRAY OF DATE PERIODS 
// ARRAY STARTS = INPUT / ARGUEMENT
// ARRAY ENDS = 12 MONTHS FROM THE CURRENT MONTH (to check for bad data)
// [
//     {
//         year: 2025,
//         membership_period_ends: '2008-01-01',
//         start_date: '2025-10-01 00:00:00',
//         end_date: '2025-10-31 23:59:59'
//     },
//     {
//         year: 2025,
//         membership_period_ends: '2008-01-01',
//         start_date: '2025-11-01 00:00:00',
//         end_date: '2025-11-30 23:59:59'
//     },
//     {
//         year: 2025,
//         membership_period_ends: '2008-01-01',
//         start_date: '2025-12-01 00:00:00',
//         end_date: '2025-12-31 23:59:59'
//     },
//     {
//         year: 2026,
//         membership_period_ends: '2008-01-01',
//         start_date: '2026-01-01 00:00:00',
//         end_date: '2026-01-31 23:59:59'
//     }
// ]



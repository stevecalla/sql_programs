async function generate_date_periods_last_7_days(days_ago = 7, membershipPeriodEnds = '2008-01-01') {
    const periods = [];
    const currentDate = new Date();

    // Calculate the start date (7 days ago including today)
    const startDate = new Date();
    startDate.setDate(currentDate.getDate() - days_ago);

    // Format dates for start and end
    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const formatDateTime = (date, time) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day} ${time}`;
    };

    // Create period for the last 7 days including today
    const period = {
        year: currentDate.getFullYear(),
        membership_period_ends: membershipPeriodEnds,
        start_date: formatDate(startDate),
        start_date_time: formatDateTime(startDate, "00:00:00"),
        end_date_time: formatDateTime(currentDate, "23:59:59"),
    };

    periods.push(period);

    return periods;
}

// Example usage
// (async () => {
//     const result = await generate_date_periods_last_7_days();
//     console.log(result);
// })();

module.exports = {
    generate_date_periods_last_7_days,
};

// EXAMPLE OUTPUT = OBJECT THAT STARTS 7 DAYS AGO AND ENDS TODAY
// [
//     {
//       year: 2025,
//       membership_period_ends: '2008-01-01',
//       start_date: '2025-01-04',
//       start_date_time: '2025-01-04 00:00:00',
//       end_date_time: '2025-01-11 23:59:59'
//     }
//   ]

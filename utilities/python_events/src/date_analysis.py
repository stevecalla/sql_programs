import pandas as pd
import numpy as np
from datetime import datetime
import calendar

this_year = datetime.now().year
last_year = this_year - 1

# This function computes the day-of-year difference between two event dates,
# adjusting for leap years. If one year is a leap year and the other is not,
# and both dates are after Feb 28, it subtracts the extra leap day (Feb 29)
# to ensure the comparison is "leap-year neutral." For all other cases,
# it simply returns the standard day-of-year difference.
def adjust_day_diff(row):
    doy_this = row['earliest_start_date_this_year'].timetuple().tm_yday
    doy_last = row['earliest_start_date_last_year'].timetuple().tm_yday

    year_this = row['earliest_start_date_this_year'].year
    year_last = row['earliest_start_date_last_year'].year

    leap_this = calendar.isleap(year_this)
    leap_last = calendar.isleap(year_last)

    # Check if one year is a leap and the other is not
    if leap_this != leap_last:
        # Only adjust if both dates are after Feb 28
        feb_28_this = row['earliest_start_date_this_year'].replace(month=2, day=28)
        feb_28_last = row['earliest_start_date_last_year'].replace(month=2, day=28)

        after_feb28_this = row['earliest_start_date_this_year'] > feb_28_this
        after_feb28_last = row['earliest_start_date_last_year'] > feb_28_last

        if after_feb28_this and after_feb28_last:
            # If 'this' year is leap, subtract 1; if 'last' year is leap, add 1
            if leap_this:
                return (doy_this - 1) - doy_last
            else:
                return doy_this - (doy_last - 1)
    # If not a cross-leap comparison, or not after Feb 28, just subtract
    return doy_this - doy_last


def date_shift_analysis(events_this_year, analysis_month, month_name):
    """Perform timing shift analysis between matched events from this_year and last_year."""
    # timing_shift_data = events_this_year[events_this_year['has_match'] == True].copy()
    
    timing_shift_data = events_this_year[
        (events_this_year['has_match'] == True) &
        (events_this_year['source'] != 'from_missing_in_event_data_metrics')
    ].copy()

    # Ensure the dates are datetime objects
    timing_shift_data['earliest_start_date_this_year'] = pd.to_datetime(timing_shift_data['earliest_start_date'], errors='coerce')
    timing_shift_data['earliest_start_date_last_year'] = pd.to_datetime(timing_shift_data[f'earliest_start_date_{last_year}'], errors='coerce')

    # Drop rows with missing dates
    timing_shift_data = timing_shift_data.dropna(
        subset=['earliest_start_date_this_year', 'earliest_start_date_last_year']
    )

    # Calculate various date parts
    timing_shift_data['day_this_year'] = timing_shift_data['earliest_start_date_this_year'].dt.day
    timing_shift_data['year_this_year'] = timing_shift_data['earliest_start_date_this_year'].dt.year
    timing_shift_data['month_this_year'] = timing_shift_data['earliest_start_date_this_year'].dt.month
    timing_shift_data['month_last_year'] = timing_shift_data['earliest_start_date_last_year'].dt.month
    timing_shift_data['day_last_year'] = timing_shift_data['earliest_start_date_last_year'].dt.day
    timing_shift_data['weekday_this_year'] = timing_shift_data['earliest_start_date_this_year'].dt.strftime('%A')
    timing_shift_data['weekday_last_year'] = timing_shift_data['earliest_start_date_last_year'].dt.strftime('%A')
    # calc day diff based on month & day accounting for leap year
    timing_shift_data['day_diff'] = timing_shift_data.apply(adjust_day_diff, axis=1)

    timing_shift_data['month_match'] = np.where(
        timing_shift_data['month_this_year'] == timing_shift_data['month_last_year'],
        'same_month',
        'other_month'
    )

    # Prepare the output DataFrame for Excel export
    timing_shift_output = timing_shift_data[[ 
        'Name', 'ApplicationID', 'Status', 'match_name_last_year', 'status_last_year',
        'earliest_start_date_this_year', 'year_this_year', 'month_this_year', 'weekday_this_year', 'day_this_year',
        'earliest_start_date_last_year', 'month_last_year', 'weekday_last_year', 'day_last_year',
        'day_diff', 'match_score_name_only', 'match_formula_used', 'month_match'
    ]]

    # Filter for the analysis month (e.g., April)
    month_shift = timing_shift_data[timing_shift_data['month_this_year'] == analysis_month].copy()

    shifted_into_month = month_shift[month_shift['month_last_year'] != analysis_month].copy()
    shifted_into_month['year_last_year'] = shifted_into_month['earliest_start_date_last_year'].dt.year
    shifted_into_month['month_name_last_year'] = shifted_into_month['earliest_start_date_last_year'].dt.month_name()
    shifted_into_month['month_name_this_year'] = shifted_into_month['earliest_start_date_this_year'].dt.month_name()

    shifted_into_month_output = shifted_into_month[[ 
        'Name', 'ApplicationID',
        'earliest_start_date_this_year', 'month_this_year', 'month_name_this_year',
        'earliest_start_date_last_year', 'month_last_year', 'month_name_last_year',
        'day_diff', 'weekday_this_year', 'weekday_last_year',
        'match_score_name_only', 'match_formula_used'
    ]].rename(columns={
        'earliest_start_date_this_year': 'date_this_year',
        'earliest_start_date_last_year': 'date_last_year'
    })

    return timing_shift_output, shifted_into_month_output, timing_shift_data

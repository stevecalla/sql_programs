import pandas as pd

def date_shift_analysis(events_2025, analysis_month, month_name):
    """Perform timing shift analysis between matched events from 2025 and 2024."""
    timing_shift_data = events_2025[events_2025['has_match'] == True].copy()

    # Ensure the dates are datetime objects
    timing_shift_data['earliest_start_date'] = pd.to_datetime(timing_shift_data['earliest_start_date'], errors='coerce')
    timing_shift_data['earliest_start_date_2024'] = pd.to_datetime(timing_shift_data['earliest_start_date_2024'], errors='coerce')

    # Drop rows with missing dates
    timing_shift_data = timing_shift_data.dropna(subset=['earliest_start_date', 'earliest_start_date_2024'])

    # Calculate various date parts
    timing_shift_data['day_2025'] = timing_shift_data['earliest_start_date'].dt.day
    timing_shift_data['year_2025'] = timing_shift_data['earliest_start_date'].dt.year
    timing_shift_data['month_2025'] = timing_shift_data['earliest_start_date'].dt.month
    timing_shift_data['month_2024'] = timing_shift_data['earliest_start_date_2024'].dt.month
    timing_shift_data['day_2024'] = timing_shift_data['earliest_start_date_2024'].dt.day
    timing_shift_data['weekday_2025'] = timing_shift_data['earliest_start_date'].dt.strftime('%A')
    timing_shift_data['weekday_2024'] = timing_shift_data['earliest_start_date_2024'].dt.strftime('%A')
    timing_shift_data['day_diff'] = timing_shift_data['day_2025'] - timing_shift_data['day_2024']

    # **NEW:** Attach the 'month_2024' column to the full DataFrame so it is available later.
    timing_shift_data['month_2024'] = timing_shift_data['earliest_start_date_2024'].dt.month

    # Prepare the output DataFrame for Excel export
    timing_shift_output = timing_shift_data[[ 
        'Name', 'ApplicationID', 'Status', 'match_name_2024', 'status_2024',
        'earliest_start_date', 'year_2025', 'month_2025', 'weekday_2025', 'day_2025',
        'earliest_start_date_2024', 'month_2024', 'weekday_2024', 'day_2024',
        'day_diff', 'match_score_name_only', 'match_formula_used'
    ]]

    # Filter for the analysis month (e.g., April)
    april_2025_shift = timing_shift_data[timing_shift_data['month_2025'] == analysis_month].copy()

    shifted_into_month = april_2025_shift[april_2025_shift['month_2024'] != analysis_month].copy()
    shifted_into_month['year_2024'] = shifted_into_month['earliest_start_date_2024'].dt.year
    shifted_into_month['month_name_2024'] = shifted_into_month['earliest_start_date_2024'].dt.month_name()
    shifted_into_month['month_name_2025'] = shifted_into_month['earliest_start_date'].dt.month_name()

    shifted_into_month_output = shifted_into_month[[
        'Name', 'ApplicationID',
        'earliest_start_date', 'month_2025', 'month_name_2025',
        'earliest_start_date_2024', 'month_2024', 'month_name_2024',
        'day_diff', 'weekday_2025', 'weekday_2024',
        'match_score_name_only', 'match_formula_used'
    ]].rename(columns={
        'earliest_start_date': 'date_2025',
        'earliest_start_date_2024': 'date_2024'
    })

    return timing_shift_output, shifted_into_month_output, timing_shift_data

import pandas as pd
from datetime import datetime, date

from zoneinfo import ZoneInfo  # Python 3.9+
local_tz = ZoneInfo("America/Denver")  # Or your desired local time zone

def group_clean_data(df):
    """Group and clean the raw data and calculate supporting summaries.
    
    - If RaceDate is blank or missing, it is populated with StartDate.
    - The CreatedDate field is included using its first value,
      preserving its original order (appearing after Email in the file).
    """
    
    # Dynamically set the years for YOY analysis
    # TODO: 2024 vs 2025
    # this_year = datetime.now().year
    # last_year = this_year - 1
    # TODO: 2025 vs 2026
    # this_year = 2026
    # last_year = 2025

    # Dynamically set the years for YOY analysis
    today = date.today()
    cutoff = date(today.year, 10, 15)  # Oct 15 of the current year

    if today < cutoff:
        # 1/1 through 10/14  → use CURRENT and PRIOR year
        this_year = today.year
        last_year = today.year - 1
    else:
        # 10/15 through 12/31 → use NEXT and CURRENT year
        this_year = today.year + 1
        last_year = today.year

    # --- Adjust RaceDate if blank ---
    # Replace RaceDate with StartDate if RaceDate is missing or an empty string.
    df['RaceDate'] = df.apply(
        lambda row: row['RaceDate'] if pd.notnull(row['RaceDate']) and str(row['RaceDate']).strip() != "" 
                    else row['StartDate'],
        axis=1
    )
    
    # --- Group and aggregate data ---
    grouped_df = (
        df.groupby('ApplicationID')
        .agg({
            'Name': 'first',
            'StartDate': 'first',
            'RaceDate': lambda x: ', '.join(sorted(x.dropna().astype(str).unique())),
            'Status': 'first',
            '2LetterCode': 'first',
            'ZipCode': 'first',
            'Value': 'first',
            'RaceDirectorUserID': 'first',
            'Website': 'first',
            'RegistrationWebsite': 'first',
            'Email': 'first',
            'CreatedDate': 'first',      # Use the first CreatedDate based on file order
            'sales_units': 'first',
            'sales_revenue': 'first',
            'source': 'first',
        })
        .reset_index()
    ) 

    # Add a local timestamp to all rows
    grouped_df['created_at'] = datetime.now(local_tz).strftime("%Y-%m-%d %H:%M:%S")

    # --- Compute earliest_start_date & derive year/month ---
    # Turn StartDate into datetime if it isn’t already
    df['StartDate'] = pd.to_datetime(df['StartDate'], errors='coerce')

    # Find the minimum StartDate per ApplicationID
    min_start = df.groupby('ApplicationID')['StartDate'].min()

    # Assign back to grouped_df
    grouped_df['earliest_start_date'] = pd.to_datetime(
        min_start.values, errors='coerce'
    )
    grouped_df['year']       = grouped_df['earliest_start_date'].dt.year
    grouped_df['month']      = grouped_df['earliest_start_date'].dt.month
    grouped_df['month_name'] = grouped_df['earliest_start_date'].dt.month_name()

    # # Calculate earliest_race_date by taking the minimum RaceDate per ApplicationID.
    # grouped_df['earliest_race_date'] = pd.to_datetime(
    #     df.groupby('ApplicationID')['RaceDate'].min().values, errors='coerce'
    # )
    # grouped_df['year'] = grouped_df['earliest_race_date'].dt.year
    # grouped_df['month'] = grouped_df['earliest_race_date'].dt.month
    # grouped_df['month_name'] = grouped_df['earliest_race_date'].dt.month_name()

    # --- FLAG DUPLICATES ---
    application_counts = df['ApplicationID'].value_counts()
    grouped_df['possible_duplicate'] = grouped_df['ApplicationID'].isin(
        application_counts[application_counts > 1].index
    )

    # --- QA SUMMARY ---
    qa_summary = pd.DataFrame({
        "statistic": [
            "total_rows_original_data",
            "total_rows_grouped_data",
            "number_of_possible_duplicates"
        ],
        "value": [
            len(df),
            len(grouped_df),
            grouped_df['possible_duplicate'].sum()
        ]
    })

    # --- STATUS SUMMARY ---
    # status_summary = (
    #     grouped_df.groupby(['year', 'month', 'month_name', 'Status'])
    #     .size()
    #     .reset_index(name='event_count')
    # )
    status_summary = (
        grouped_df[grouped_df['source'] != 'from_missing_in_event_data_metrics']
        .groupby(['year', 'month', 'month_name', 'Status'])
        .size()
        .reset_index(name='event_count')
    )

    # summary_2024 = status_summary[status_summary['year'] == 2024]
    # summary_2025 = status_summary[status_summary['year'] == 2025]

    summary_last_year = status_summary[status_summary['year'] == last_year]
    summary_this_year = status_summary[status_summary['year'] == this_year]

    # --- PIVOT FOR YOY ---
    # def create_yoy_pivot(df_inner):
    #     monthly = (
    #         df_inner.groupby(['year', 'month', 'month_name'])
    #         .size()
    #         .reset_index(name='event_count')
    #     )

    def create_yoy_pivot(df_inner):
        monthly = (
            df_inner.groupby(['year', 'month', 'month_name'])
            .size()
            .reset_index(name='event_count')
        )
        pivot = monthly.pivot(index='month_name', columns='year', values='event_count').fillna(0)

        # pivot['difference'] = pivot[2025] - pivot[2024]
        pivot['difference'] = pivot[this_year] - pivot[last_year]

        pivot['month_order'] = pd.to_datetime(pivot.index.to_series(), format='%B').dt.month
        return pivot.sort_values('month_order')

    # pivot_all = create_yoy_pivot(grouped_df)
    pivot_all = create_yoy_pivot(grouped_df[grouped_df['source'] != 'from_missing_in_event_data_metrics'])


    # filtered_df = grouped_df[~grouped_df['Status'].str.lower().isin(['canceled', 'cancelled', 'deleted'])]
    
    # Create a filtered grouped DataFrame that excludes canceled or deleted events.
    # fill NaN with empty string, cast every value to str, then lowercase + filter
    # filtered_df = grouped_df[
    #     ~grouped_df['Status']
    #     .fillna('')                       # replace NaN/None with ''
    #     .astype(str)                      # everything becomes a string
    #     .str.lower()                      # lowercase
    #     .isin(['canceled', 'cancelled', 'deleted', 'declined'])   # is in blacklist?
    # ]
    filtered_df = grouped_df[
        (grouped_df['source'] != 'from_missing_in_event_data_metrics') &
        (~grouped_df['Status']
            .fillna('')
            .astype(str)
            .str.lower()
            .isin(['canceled', 'cancelled', 'deleted', 'declined'])
        )
    ]

    pivot_filtered = create_yoy_pivot(filtered_df)

    # --- PIVOT FOR YOY BY VALUE SEGMENTS (BY MONTH) ---
    def create_yoy_value_by_month_pivot(df_inner):
        """
        Groups the data by year, month, month_name, and Value; then
        creates a pivot table with a multi-index of (month_name, Value) to compare
        the event counts for 2024 and 2025, including a 'difference' column.
        """
        value_monthly = (
            df_inner.groupby(['year', 'month', 'month_name', 'Value'])
            .size()
            .reset_index(name='event_count')
        )
        pivot_value = value_monthly.pivot(index=['month_name', 'Value'], columns='year', values='event_count').fillna(0)
        
        # if 2024 in pivot_value.columns and 2025 in pivot_value.columns:
        #     pivot_value['difference'] = pivot_value[2025] - pivot_value[2024]
        # else:
        #     pivot_value['difference'] = None

        if last_year in pivot_value.columns and this_year in pivot_value.columns:
            pivot_value['difference'] = pivot_value[this_year] - pivot_value[last_year]
        else:
            # fallback if one of the years is missing
            pivot_value['difference'] = None

        pivot_value = pivot_value.reset_index()
        import calendar
        month_order = {calendar.month_name[i]: i for i in range(1, 13)}
        pivot_value['month_order'] = pivot_value['month_name'].map(month_order)
        pivot_value = pivot_value.sort_values(['month_order', 'Value'])
        
        return pivot_value

    # pivot_value_all = create_yoy_value_by_month_pivot(grouped_df)
    pivot_value_all = create_yoy_value_by_month_pivot(
        grouped_df[grouped_df['source'] != 'from_missing_in_event_data_metrics']
    )
    pivot_value_filtered = create_yoy_value_by_month_pivot(filtered_df)

    # print(pivot_value_all)
    # print(pivot_value_filtered)
    # print(summary_this_year)

    return (grouped_df, qa_summary, summary_last_year, summary_this_year,
            pivot_all, pivot_filtered, filtered_df, pivot_value_all, pivot_value_filtered)

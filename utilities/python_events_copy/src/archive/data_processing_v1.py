import pandas as pd

def group_clean_data(df):
    """Group and clean the raw data and calculate supporting summaries."""
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
        })
        .reset_index()
    )

    grouped_df['earliest_race_date'] = pd.to_datetime(
        df.groupby('ApplicationID')['RaceDate'].min().values
    )
    grouped_df['year'] = grouped_df['earliest_race_date'].dt.year
    grouped_df['month'] = grouped_df['earliest_race_date'].dt.month
    grouped_df['month_name'] = grouped_df['earliest_race_date'].dt.month_name()

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
    status_summary = (
        grouped_df.groupby(['year', 'month', 'month_name', 'Status'])
        .size()
        .reset_index(name='event_count')
    )
    summary_2024 = status_summary[status_summary['year'] == 2024]
    summary_2025 = status_summary[status_summary['year'] == 2025]

    # --- PIVOT FOR YOY ---
    def create_yoy_pivot(df_inner):
        monthly = (
            df_inner.groupby(['year', 'month', 'month_name'])
            .size()
            .reset_index(name='event_count')
        )
        pivot = monthly.pivot(index='month_name', columns='year', values='event_count').fillna(0)
        pivot['difference'] = pivot[2025] - pivot[2024]
        pivot['month_order'] = pd.to_datetime(pivot.index.to_series(), format='%B').dt.month
        return pivot.sort_values('month_order')

    pivot_all = create_yoy_pivot(grouped_df)
    filtered_df = grouped_df[~grouped_df['Status'].str.lower().isin(['canceled', 'cancelled', 'deleted'])]
    pivot_filtered = create_yoy_pivot(filtered_df)

    # --- PIVOT FOR YOY BY VALUE SEGMENTS (BY MONTH) ---
    def create_yoy_value_by_month_pivot(df_inner):
        """
        Groups the data by year, month, month_name, and Value; then
        creates a pivot table with a multi-index of (month_name, Value) to compare
        the event counts for 2024 and 2025, including a 'difference' column.
        """
        # Group by year, month, month_name, and Value
        value_monthly = (
            df_inner.groupby(['year', 'month', 'month_name', 'Value'])
            .size()
            .reset_index(name='event_count')
        )
        # Pivot with a multi-index: (month_name, Value) and columns as year
        pivot_value = value_monthly.pivot(index=['month_name', 'Value'], columns='year', values='event_count').fillna(0)
        
        # Calculate the difference assuming both 2024 and 2025 exist in the data
        if 2024 in pivot_value.columns and 2025 in pivot_value.columns:
            pivot_value['difference'] = pivot_value[2025] - pivot_value[2024]
        else:
            pivot_value['difference'] = None

        # Reset index so we can sort by month order and then by Value
        pivot_value = pivot_value.reset_index()

        # Map month_name to a month order for proper sorting
        import calendar
        month_order = {calendar.month_name[i]: i for i in range(1, 13)}
        pivot_value['month_order'] = pivot_value['month_name'].map(month_order)

        # Sort by the month order and then by Value (alphabetically)
        pivot_value = pivot_value.sort_values(['month_order', 'Value'])
        
        return pivot_value

    pivot_value_all = create_yoy_value_by_month_pivot(grouped_df)
    pivot_value_filtered = create_yoy_value_by_month_pivot(filtered_df)

    print(pivot_value_all)
    print(pivot_value_filtered)

    return grouped_df, qa_summary, summary_2024, summary_2025, pivot_all, pivot_filtered, filtered_df, pivot_value_all, pivot_value_filtered


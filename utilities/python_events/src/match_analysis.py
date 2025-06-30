import os
import pandas as pd
import matplotlib.pyplot as plt
from export_to_mysql import push_df_to_mysql
from datetime import datetime

# Dynamically set the years for YOY analysis
this_year = datetime.now().year
last_year = this_year - 1

def perform_year_over_year_analysis(event_output_path, df, grouped_df, events_this_year, events_last_year, file_prefix, timing_shift_output):
    print(">>> Starting match_analysis.py", flush=True)

    print("Grouped DF rows:", len(grouped_df))
    print("Events 2025 rows:", len(events_this_year))
    print("Events 2024 rows:", len(events_last_year))
    print("Combined events (should match consolidated_match_data):", len(events_this_year) + len(events_last_year))

    print("Grouped DF duplicate ApplicationIDs:", grouped_df['ApplicationID'].duplicated().sum())
    print("Events 2025 duplicate ApplicationIDs:", events_this_year['ApplicationID'].duplicated().sum())
    print("Events 2024 duplicate ApplicationIDs:", events_last_year['ApplicationID'].duplicated().sum())

    """
    Conducts year-over-year analysis and outputs charts and Excel results.
    
    Parameters:
      event_output_path: str
          The folder prefix where outputs (charts, Excel file) will be saved.
      grouped_df: DataFrame
          The full cleaned/grouped DataFrame.
      events_this_year: DataFrame
          Current-year (e.g., 2025) events with matching flags.
      events_last_year: DataFrame
          Prior-year (e.g., 2024) events with matching flags.
    
    Returns a dictionary with paths to the output files and selected DataFrames.
    """
    
    # --- (a) Analysis for Current Year (2025) ---
    repeated_events_this_year = events_this_year[events_this_year['has_match'] == True].copy()
    new_events_this_year = events_this_year[events_this_year['has_match'] == False].copy()
    
    # --- (b) Analysis for Prior Year (2024) ---
    repeated_events_last_year = events_last_year[events_last_year['has_match'] == True].copy()
    lost_events_last_year = events_last_year[events_last_year['has_match'] == False].copy()
    
    # --- (c) Summary by Total and "Value" Column ---
    value_summary = (
        grouped_df.groupby(['year', 'Value'])
        .size()
        .reset_index(name='event_count')
    )
    pivot_value = value_summary.pivot(index='Value', columns='year', values='event_count').fillna(0)
    if 2024 in pivot_value.columns and 2025 in pivot_value.columns:
        pivot_value['difference'] = pivot_value[2025] - pivot_value[2024]
    else:
        pivot_value['difference'] = None

    # Create chart for the Value summary.
    output_chart_value_summary = event_output_path / f"value_summary_chart_{file_prefix}.png"
    plot_value_summary(pivot_value, output_chart_value_summary, file_prefix)
    
    # --- (d) Analysis for Non-Repeating Events ---
    output_chart_nonrepeating = event_output_path / "nonrepeating_events_chart.png"
    plot_nonrepeating_counts(new_events_this_year, lost_events_last_year, output_chart_nonrepeating, file_prefix)
    
    # --- (e) Breakout of New vs. Repeated Events by Month ---
    new_repeat_pivot = new_repeat_by_month(events_this_year)
    output_chart_new_repeat = event_output_path / "new_repeat_events_by_month_chart.png"
    plot_new_repeat_by_month(new_repeat_pivot, output_chart_new_repeat)

    # --- (f) consolidated_match_data Event Match Tab ---
    consolidated_match_data = build_event_match_consolidated(events_this_year, events_last_year)

    # --- (f.1) merge consolidated_match_data with timing_shift_output ---
    merged_df = merge_event_match_and_timing_shifts(consolidated_match_data, timing_shift_output)

    # --- (f.2) push consolidated_match_data & merged_df to mysql ---
    load_into_mysql(consolidated_match_data, merged_df)

    # --- (g) Create Pivots by Month/Status ---
    pivot_all, pivot_active, pivot_active_by_event_name = generate_month_by_match_detail_pivots(merged_df)

    pivot_month_shift_this_year_by_last_year_month, pivot_month_shift_this_year_by_month_match, pivot_month_shift_last_year_by_month_match = create_timing_shift_pivots(merged_df)

    # --- Export All Analysis to Excel ---
    excel_output_path_file_name = event_output_path / "events_year_over_year_analysis.xlsx"

    export_analysis_to_excel(
        df, grouped_df, pivot_value,
        repeated_events_this_year, new_events_this_year,
        repeated_events_last_year, lost_events_last_year,
        value_summary, new_repeat_pivot, excel_output_path_file_name, 
        consolidated_match_data=consolidated_match_data, pivot_all=pivot_all,
        pivot_active=pivot_active,
        pivot_active_by_event_name=pivot_active_by_event_name, merged_df=merged_df,
        pivot_month_shift_this_year_by_last_year_month=pivot_month_shift_this_year_by_last_year_month, 
        pivot_month_shift_this_year_by_month_match=pivot_month_shift_this_year_by_month_match,
        pivot_month_shift_last_year_by_month_match=pivot_month_shift_last_year_by_month_match
    )
    
    # print(f"Excel analysis saved to: {excel_output_path_file_name}")
    
    return consolidated_match_data

def plot_value_summary(pivot_df, output_path, file_prefix):
    """Generate a grouped bar chart for event counts by Value."""
    fig, ax = plt.subplots(figsize=(10, 6))
    pivot_sorted = pivot_df.sort_index()
    x = range(len(pivot_sorted))
    bar_width = 0.35

    if 2024 in pivot_sorted.columns and 2025 in pivot_sorted.columns:
        bars1 = ax.bar([i - bar_width/2 for i in x], pivot_sorted[2024], width=bar_width, label='2024')
        bars2 = ax.bar([i + bar_width/2 for i in x], pivot_sorted[2025], width=bar_width, label='2025')
        for i, diff in enumerate(pivot_sorted['difference']):
            ax.text(i, max(pivot_sorted[2024].iloc[i], pivot_sorted[2025].iloc[i]) + 0.5,
                    str(int(diff)), ha='center', va='bottom', fontsize=9)
    else:
        col = 2024 if 2024 in pivot_sorted.columns else 2025
        bars = ax.bar(x, pivot_sorted[col], width=bar_width)
    
    ax.set_xticks(x)
    ax.set_xticklabels(pivot_sorted.index, rotation=45, ha='right')
    ax.set_ylabel("Event Count")
    ax.set_title(f"Event Summary by Value {file_prefix}")
    ax.legend()
    plt.tight_layout()
    plt.savefig(output_path)
    plt.close(fig)

def plot_nonrepeating_counts(new_df, lost_df, output_path, file_prefix):
    """Generate a chart summarizing counts of non-repeating events."""
    fig, ax = plt.subplots(figsize=(8, 6))
    counts = {
        '2025 New Events': len(new_df),
        '2024 Lost Events': len(lost_df)
    }
    x = range(len(counts))
    bars = ax.bar(x, list(counts.values()), color=['skyblue', 'salmon'])
    ax.set_xticks(x)
    ax.set_xticklabels(list(counts.keys()), rotation=45, ha='right')
    ax.set_ylabel("Event Count")
    ax.set_title(f"Non-Repeating Events Year-over-Year {file_prefix}")
    for i, bar in enumerate(bars):
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2, height, str(height),
                ha='center', va='bottom')
    plt.tight_layout()
    plt.savefig(output_path)
    plt.close(fig)

def new_repeat_by_month(events_this_year):
    """
    Computes a breakout of new vs. repeated events by month for 2025.
    Returns a DataFrame with columns: month, month_name, new_count, repeat_count.
    """
    new_events = events_this_year[events_this_year['has_match'] == False]
    repeated_events = events_this_year[events_this_year['has_match'] == True]
    new_counts = new_events.groupby(['month', 'month_name']).size().reset_index(name='new_count')
    repeat_counts = repeated_events.groupby(['month', 'month_name']).size().reset_index(name='repeat_count')
    pivot_new_repeat = pd.merge(new_counts, repeat_counts, on=['month', 'month_name'], how='outer')
    pivot_new_repeat.fillna(0, inplace=True)
    pivot_new_repeat['new_count'] = pivot_new_repeat['new_count'].astype(int)
    pivot_new_repeat['repeat_count'] = pivot_new_repeat['repeat_count'].astype(int)
    pivot_new_repeat = pivot_new_repeat.sort_values('month')
    return pivot_new_repeat

def plot_new_repeat_by_month(pivot_new_repeat, output_path):
    """Plot a grouped bar chart for new vs. repeated events by month (2025)."""
    fig, ax = plt.subplots(figsize=(10, 6))
    x = range(len(pivot_new_repeat))
    bar_width = 0.35
    bars_new = ax.bar([i - bar_width/2 for i in x], pivot_new_repeat['new_count'],
                      width=bar_width, label='New Events (2025)')
    bars_repeat = ax.bar([i + bar_width/2 for i in x], pivot_new_repeat['repeat_count'],
                         width=bar_width, label='Repeated Events (2025)')
    ax.set_xticks(x)
    ax.set_xticklabels(pivot_new_repeat['month_name'], rotation=45, ha='right')
    ax.set_ylabel('Event Count')
    ax.set_title('2025 New vs. Repeated Events by Month')
    ax.legend()
    
    # Add value labels to the new events bars.
    for bar in bars_new:
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width()/2, height, str(int(height)),
                ha='center', va='bottom', fontsize=9)
        
    # Add value labels to the repeated events bars.
    for bar in bars_repeat:
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width()/2, height, str(int(height)),
                ha='center', va='bottom', fontsize=9)
        
    plt.tight_layout()
    plt.savefig(output_path)
    plt.close(fig)

def build_event_match_consolidated(events_this_year, events_last_year):
    # has match, last year application id, last year name
    """
    Returns a DataFrame with every event and key match fields, assigning:
    - this_year_new / last_year_lost: Events that exist only in 2025 or 2024, respectively.
    - this_year_repeat / last_year_repeat: Events that are matched (repeated) across both years.
    Also assigns a match_category_detailed field to further break out repeats by whether
    either side of the matched pair is cancelled/declined/deleted (per common_status).
    
    Why add match_category_detailed?
    - Some events are repeated across years, but the pair has a problematic status (cancelled, declined, or deleted) in
      one or both years. To bridge and reconcile different filtering approaches, we split repeat events by whether their
      paired status is "active" or problematic.
    - match_category_detailed allows you to see:
        - Which repeats are fully active (both years have acceptable status)
        - Which repeats were excluded from active analyses due to a cancel/decline/delete status in either year
        - New/lost events as usual

    How does this work?
    - For repeats: If common_status contains 'cancelled', 'declined', or 'deleted', we assign *_repeat_cancelled.
      Otherwise, *_repeat_active.
    - For new/lost: We keep the existing category.
    - You can then easily pivot or summarize by match_category_detailed to reconcile counts.
    """

    # print("events_this_year.columns:")
    # print(list(events_this_year.columns))
    # print("\nevents_last_year.columns:")
    # print(list(events_last_year.columns))

    consolidated_rows = []
    cancel_statuses = ['cancelled', 'declined', 'deleted']

    # --- This Year Events ---
    for idx, row in events_this_year.iterrows():
        # Determine if the event is a repeat (matched to a 2024 event), or new
        category = "this_year_repeat" if row['has_match'] else "this_year_new"

        # --- Detailed breakout for repeats:
        # If common_status includes cancel/decline/delete, this means that
        # the event is repeated, but EITHER the 2025 or the matched 2024 event (or both)
        # was cancelled/declined/deleted. (common_status is assigned at the pair level.)
        # To understand which year had the problematic status, refer to status_2024 and status_2025 columns.

        if category == "this_year_repeat":
            cstat = str(row.get("common_status", "")).lower()
            if any(x in cstat for x in cancel_statuses):
                # At least one side (2024 or 2025) was cancelled/declined/deleted
                detailed = "this_year_repeat_cancelled"
            else:
                # Both sides are active (neither year had cancel/decline/delete)
                detailed = "this_year_repeat_active"
        else:
            # For unmatched 2025 events
            detailed = category

        consolidated_rows.append({
            **row,
            "match_category": category,
            "match_category_detailed": detailed,
            "source_year": 2025,
        })

    # --- Last Year Events ---
    for idx, row in events_last_year.iterrows():
        category = "last_year_repeat" if row['has_match'] else "last_year_lost"

        if category == "last_year_repeat":
            cstat = str(row.get("common_status", "")).lower()
            if any(x in cstat for x in cancel_statuses):
                # At least one side (2024 or 2025) was cancelled/declined/deleted
                detailed = "last_year_repeat_cancelled"
            else:
                detailed = "last_year_repeat_active"
        else:
            detailed = category

        consolidated_rows.append({
            **row,
            "match_category": category,
            "match_category_detailed": detailed,
            "source_year": 2024,
        })

    consolidated_match_data = pd.DataFrame(consolidated_rows)

    # NOTE: To identify exactly which year(s) had the problematic status for each repeat,
    # use the 'status_2024' and 'status_2025' columns that are also present in the DataFrame.
    # For example:
    #   If match_category_detailed == 'this_year_repeat_cancelled' and status_2025 == 'cancelled' and status_2024 == 'approved'
    #     => the cancellation happened in 2025.
    #   If status_2024 == 'declined' and status_2025 == 'approved'
    #     => the problematic status was in 2024, not 2025.
    #   If both statuses are problematic, then both years were cancelled/declined/deleted.

    # events_this_year.columns:
    # ['ApplicationID', 'Name', 'StartDate', 'RaceDate', 'Status', '2LetterCode', 'ZipCode', 'Value', 'RaceDirectorUserID', 'Website', 'RegistrationWebsite', 'Email', 'CreatedDate', 'earliest_start_date', 'year', 'month', 'month_name', 'possible_duplicate', 'match_idx_last_year', 'match_formula_used', 'match_score_name_only', 'match_score_name_and_zip', 'match_score_name_and_site', 'match_name_last_year', 'has_match', 'application_id_last_year', 'status_last_year', 'earliest_start_date_2024', 'website_last_year', 'zip_code_last_year', 'state_code_last_year', 'common_date', 'common_year', 'common_month', 'status_this_year', 'common_status']

    cols_to_show = [
       'ApplicationID', 'Name', 'StartDate', 'RaceDate', 'Status', '2LetterCode', 'ZipCode', 'Value', 'RaceDirectorUserID', 'Website', 'RegistrationWebsite', 'Email', 'CreatedDate', 'earliest_start_date', 'year', 'month', 'month_name', 'possible_duplicate', 'match_idx_last_year', 'match_formula_used', 'match_score_name_only', 'match_score_name_and_zip', 'match_score_name_and_site', 'match_name_last_year', 'has_match', 'application_id_last_year', 'status_last_year', 'earliest_start_date_2024', 'website_last_year', 'zip_code_last_year', 'state_code_last_year', 'common_date', 'common_year', 'common_month', 'status_this_year', 'common_status', "match_category", "match_category_detailed", "source_year",  # <-- Include these for year-by-year diagnosis
    ]

    existing_cols = [col for col in cols_to_show if col in consolidated_match_data.columns]
    return consolidated_match_data[existing_cols]

def merge_event_match_and_timing_shifts(consolidated_match_data, timing_shift_output):
    # 1. Prefix columns except ApplicationID
    consolidated_prefixed = consolidated_match_data.rename(
        columns={col: f"con_{col}" for col in consolidated_match_data.columns if col != "ApplicationID"}
    )
    timing_prefixed = timing_shift_output.rename(
        columns={col: f"shift_{col}" for col in timing_shift_output.columns if col != "ApplicationID"}
    )

    # 2. Remove duplicate columns from timing_prefixed (except ApplicationID)
    timing_cols_unique = [col for col in timing_prefixed.columns if col not in consolidated_prefixed.columns or col == "ApplicationID"]
    timing_prefixed_reduced = timing_prefixed[timing_cols_unique]

    # 3. Merge with timing columns at the end
    merged_df = pd.merge(consolidated_prefixed, timing_prefixed_reduced, on="ApplicationID", how="left")

    # 4. Ensure ApplicationID is the first column, followed by all from consolidated, then timing_shift
    main_cols = ["ApplicationID"] + [col for col in consolidated_prefixed.columns if col != "ApplicationID"]
    timing_cols_extra = [col for col in timing_prefixed_reduced.columns if col != "ApplicationID"]
    merged_df = merged_df[main_cols + timing_cols_extra]

    return merged_df

def generate_month_by_match_detail_pivots(merged_df):
    """
    Returns three DataFrames:
    - pivot_all: all statuses
    - pivot_active: excludes cancelled/declined/deleted by Status
    - pivot_active_by_event_name: as above, but index by Name
    Each:
      - Rows: common_month (or Name), with a Grand Total row at the end
      - Columns: (year, match_category_detailed) flattened, only non-zero columns
      - Plus per-year subtotals and row totals
    """

    def build_pivot(df, index_col):
        # 1. Build the pivot (MultiIndex columns except the index_col)
        pivot = pd.pivot_table(
            df,
            index=index_col,
            columns=['con_source_year', 'con_match_category_detailed'],
            values='ApplicationID',
            aggfunc='count',
            fill_value=0,
            dropna=False
        )

        # 2. Remove all-zero columns
        # Identify non-zero data columns (tuples)
        non_zero_cols = [col for col in pivot.columns if pivot[col].sum() > 0]
        # Only keep non-zero columns
        pivot = pivot[non_zero_cols]

        # 3. Row totals and per-year subtotals
        years = sorted(set(col[0] for col in non_zero_cols))
        for year in years:
            year_cols = [col for col in non_zero_cols if col[0] == year]
            pivot[f"{year}_Subtotal"] = pivot[year_cols].sum(axis=1)

        # 4. Grand total row (sum all numeric columns)
        total_row = [pivot[col].sum() for col in pivot.columns]
        total_index = pd.Index(['Grand Total'], name=index_col)
        pivot = pd.concat([pivot, pd.DataFrame([total_row], columns=pivot.columns, index=total_index)])

        # 5. Reset index and flatten columns
        pivot = pivot.reset_index()
        pivot.columns = [
            f"{col[0]}_{col[1]}" if isinstance(col, tuple) else str(col)
            for col in pivot.columns
        ]
        return pivot

    # Main pivots
    mask_active = ~merged_df['con_Status'].str.lower().isin(['cancelled', 'declined', 'deleted'])

    pivot_all = build_pivot(merged_df, 'con_common_month')
    pivot_active = build_pivot(merged_df[mask_active], 'con_common_month')
    pivot_active_by_event_name = build_pivot(merged_df[mask_active], 'con_Name')

    return pivot_all, pivot_active, pivot_active_by_event_name

def create_timing_shift_pivots(merged_df):
    """
    Expects columns:
    - 'shift_month_this_year'
    - 'shift_month_last_year'
    - 'shift_month_match' (with values like 'same_month', 'other_month')
    - 'ApplicationID'
    Returns three pivot tables as DataFrames, with clear row index names.
    """
    def _format_month_axis(axis):
        # Convert month floats/strings to integer, leave non-numeric as-is (like "Grand Total")
        def safe_int(val):
            try:
                if isinstance(val, float) and val.is_integer():
                    return int(val)
                if isinstance(val, str) and val.isdigit():
                    return int(val)
                return val
            except Exception:
                return val
        return [safe_int(x) for x in axis]

    # Exclude events with cancelled/declined/deleted status
    mask_active = ~merged_df['con_Status'].str.lower().isin(['cancelled', 'declined', 'deleted'])
    active_df = merged_df[mask_active]

    # 1. Pivot: index = month_this_year, columns = month_last_year, values = count of ApplicationID
    pivot_month_shift_this_year_by_last_year_month = pd.pivot_table(
        active_df,
        index='shift_month_this_year',
        columns='shift_month_last_year',
        values='ApplicationID',
        aggfunc='count',
        fill_value=0,
        margins=True,                # <-- Adds grand total row/column
        margins_name='Grand Total'   # <-- You can rename the "All" row/col if you wish
    )
    pivot_month_shift_this_year_by_last_year_month.index = _format_month_axis(pivot_month_shift_this_year_by_last_year_month.index)
    pivot_month_shift_this_year_by_last_year_month.columns = _format_month_axis(pivot_month_shift_this_year_by_last_year_month.columns)
    pivot_month_shift_this_year_by_last_year_month.index.name = "shift_month_this_year"
    pivot_month_shift_this_year_by_last_year_month.columns.name = "shift_month_last_year"

    # 2. Pivot: index = month_this_year, columns = month_match, values = count of ApplicationID
    pivot_month_shift_this_year_by_month_match = pd.pivot_table(
        active_df,
        index='shift_month_this_year',
        columns='shift_month_match',
        values='ApplicationID',
        aggfunc='count',
        fill_value=0,
        margins=True,                # <-- Adds grand total row/column
        margins_name='Grand Total'   # <-- You can rename the "All" row/col if you wish
    )
    pivot_month_shift_this_year_by_month_match.index = _format_month_axis(pivot_month_shift_this_year_by_month_match.index)
    pivot_month_shift_this_year_by_month_match.index.name = "shift_month_this_year"
    pivot_month_shift_this_year_by_month_match.columns.name = "shift_month_match"

    # 3. Pivot: index = month_last_year, columns = month_match, values = count of ApplicationID
    pivot_month_shift_last_year_by_month_match = pd.pivot_table(
        active_df,
        index='shift_month_last_year',
        columns='shift_month_match',
        values='ApplicationID',
        aggfunc='count',
        fill_value=0,
        margins=True,                # <-- Adds grand total row/column
        margins_name='Grand Total'   # <-- You can rename the "All" row/col if you wish
    )
    pivot_month_shift_last_year_by_month_match.index = _format_month_axis(pivot_month_shift_last_year_by_month_match.index)
    pivot_month_shift_last_year_by_month_match.index.name = "shift_month_last_year"
    pivot_month_shift_last_year_by_month_match.columns.name = "shift_month_match"

    # print("\nPivot 1: This Year (rows) vs Last Year (cols)")
    # print(pivot_month_shift_this_year_by_last_year_month.to_string())

    # print("\nPivot 2: This Year (rows) vs Month Match (cols)")
    # print(pivot_month_shift_this_year_by_month_match.to_string())

    # print("\nPivot 3: Last Year (rows) vs Month Match (cols)")
    # print(pivot_month_shift_last_year_by_month_match.to_string())

    return (
        pivot_month_shift_this_year_by_last_year_month,
        pivot_month_shift_this_year_by_month_match,
        pivot_month_shift_last_year_by_month_match
    )

def load_into_mysql(consolidated_match_data, merged_df):
    # table_name = "event_data_metrics_yoy_match_v2"
    # push_df_to_mysql(consolidated_match_data, table_name)

    table_name = "event_data_metrics_yoy_match"
    push_df_to_mysql(merged_df, table_name)

# --- Export All Analysis to Excel ---
def export_analysis_to_excel(df, grouped_df, pivot_value, repeated_events_this_year,
                              new_events_this_year, repeated_events_last_year, lost_events_last_year,
                              value_summary, new_repeat_pivot, out_file,
                              consolidated_match_data=None, pivot_all=None, pivot_active=None,
                              pivot_active_by_event_name=None, merged_df=None,
                              pivot_month_shift_this_year_by_last_year_month=None,
                              pivot_month_shift_this_year_by_month_match=None, pivot_month_shift_last_year_by_month_match=None
                              ):    # <--- add parameter

    status_filter_explanation = [
        "How Event Status Filters Affect Year-over-Year (YOY) Repeat Counts",
        "",
        "When analyzing repeat, lost, and new events year-over-year (YOY), it is important to understand how status filtering affects your results.",
        "",
        "1. Filtering by 'Status' (per year):",
        "- Each year's events are filtered independently based on their 'Status' value (e.g., 'approved', 'cancelled').",
        "- For repeated events, if an event is 'cancelled', 'declined', or 'deleted' in only one year but not the other, it will only appear in the repeat count for the year where it meets the filter.",
        "- This can lead to mismatched repeat counts between 2024 and 2025, and make YOY retention trends hard to interpret.",
        "",
        "2. Filtering by 'common_status' (pair-level status):",
        "- 'common_status' is assigned to every event pair (repeat), and is set to 'cancelled/declined/deleted' if EITHER the 2024 or 2025 event has one of these problematic statuses.",
        "- Filtering on 'common_status' ensures that any problematic pair is excluded from both years at once.",
        "- This keeps the YOY repeat counts perfectly aligned: a repeat is only counted if both years are active.",
        "",
        "3. Repeat Status Breakout ('match_category_detailed'):",
        "- Each repeated event (repeat pair) is further broken out as either:",
        "    • *_repeat_active: Both sides of the matched pair are non-cancelled/non-declined/non-deleted (i.e., 'active').",
        "    • *_repeat_cancelled: At least one side of the pair is 'cancelled', 'declined', or 'deleted'.",
        "- This lets you directly reconcile the effect of status mismatches: you can see how many repeat events are excluded from YOY counts due to status, and how many are fully retained.",
        "",
        "4. Determining Which Year Had the Cancelled/Declined/Deleted Status:",
        "- The sheet also includes columns 'status_2024' and 'status_2025'.",
        "- If 'match_category_detailed' is *_repeat_cancelled, you can check which year(s) the problematic status occurred in by looking at these columns.",
        "- For example:",
        "    • If status_2024 = 'cancelled' and status_2025 = 'approved', the event was cancelled in 2024 only.",
        "    • If both are problematic, then both years had the issue.",
        "",
        "Summary:",
        "- Filtering by status per year produces divergent repeat counts, depending on status mismatches across years.",
        "- Filtering by 'common_status' (pair-level) ensures all YOY repeat counts are fully aligned and comparable.",
        "- Using the detailed repeat status categories, you can bridge the numbers between the different filtering approaches and understand exactly why event retention figures change.",
        "",
        "Tip: For apples-to-apples YOY reporting, use 'common_status' as your status filter, and use the detailed repeat categories to explain differences to stakeholders."
    ]

    with pd.ExcelWriter(out_file, engine="xlsxwriter") as writer:
        wb = writer.book
        fmt_center = wb.add_format({"align": "center", "valign": "vcenter"})
        fmt_left = wb.add_format({"align": "left", "valign": "top", "text_wrap": True})
        fmt_bold = wb.add_format({"bold": True})

        # -- Write standard sheets --
        tabs = [
            ("Status Filter Methodology", pd.DataFrame({"Explanation": status_filter_explanation}), [0, 0, None, fmt_left]),
            ("original_data", df, [0, 50, 20, fmt_center]),
            ("grouped_data", grouped_df, [0, 50, 20, fmt_center]),
            ("consolidated_match_data", consolidated_match_data, [0, 50, 20, fmt_center]),
            ("timing_match_data", merged_df, [0, 50, 20, fmt_center]),

            # ("2025 New Events", new_events_this_year, [0, 50, 20, fmt_center]),
            # ("2025 Repeated Events", repeated_events_this_year, [0, 50, 20, fmt_center]),
            # ("2024 Lost Events", lost_events_last_year, [0, 50, 20, fmt_center]),
            # ("2024 Repeated Events", repeated_events_last_year, [0, 50, 20, fmt_center]),
            # ("2025 New vs Repeated by Month", new_repeat_pivot, [0, 50, 20, fmt_center]),
            # ("Value Summary Pivot", pivot_value, [0, 50, 20, fmt_center]),
            # ("Value Summary Raw", value_summary, [0, 50, 20, fmt_center]),
        ]
        # if consolidated_match_data is not None:
        #     tabs.insert(1, ("consolidated_match_data", consolidated_match_data, [0, 50, 20, fmt_center]))
        # tabs.insert(1, ("Grouped Data", grouped_df, [0, 50, 20, fmt_center]))

        for name, df, (col_start, col_end, width, fmt) in tabs:
            df.to_excel(writer, sheet_name=name, index=False)
            ws = writer.sheets[name]
            ws.set_zoom(75)
            if name == "Status Filter Methodology":
                # Left, autofit, wrap text
                maxlen = df['Explanation'].str.len().max()
                ws.set_column(0, 0, min(100, max(25, int(maxlen * 0.95))), fmt)
                ws.freeze_panes(1, 0)
            else:
                ws.set_column(col_start, col_end, width, fmt)
                ws.freeze_panes(5, 3)

        # --- Pivots sheet ---
        if all(x is not None for x in (pivot_all, pivot_active, pivot_active_by_event_name)):
            ws_name = "match_detail_pivot"
            ws = wb.add_worksheet(ws_name)
            writer.sheets[ws_name] = ws
            fmt_header = wb.add_format({"bold": True, "align": "center", "valign": "vcenter"})

            # Pivot 1
            ws.write(0, 0, "Pivot 1: All Status Values Included", fmt_bold)
            for r, row in enumerate(pivot_all.values.tolist()):
                ws.write_row(1 + r, 0, row)
            for c, col in enumerate(pivot_all.columns):
                ws.write(0, c, str(col), fmt_header)   # <-- header: bold + center

            # Pivot 2
            r2 = 1 + len(pivot_all) + 4
            ws.write(r2 - 1, 0, "Pivot 2: Excludes Cancelled/Declined/Deleted by Status", fmt_bold)
            for r, row in enumerate(pivot_active.values.tolist()):
                ws.write_row(r2 + r, 0, row)
            for c, col in enumerate(pivot_active.columns):
                ws.write(r2 - 2, c, str(col), fmt_header)   # <-- header: bold + center

            # Pivot 3
            r3 = r2 + len(pivot_active) + 4
            ws.write(r3 - 1, 0, "Pivot 3: Excludes Cancelled/Declined/Deleted by Status by Event Name", fmt_bold)
            for r, row in enumerate(pivot_active_by_event_name.values.tolist()):
                ws.write_row(r3 + r, 0, row)
            for c, col in enumerate(pivot_active_by_event_name.columns):
                ws.write(r3 - 2, c, str(col), fmt_header)   # <-- header: bold + center

            # Formatting for this sheet: col A left, rest centered
            ws.set_column(0, 0, 20, fmt_left)
            ws.set_column(1, 100, 20, fmt_center)
            ws.set_zoom(75)
            ws.freeze_panes(2, 1)

        # --- Pivots sheet ---
        if all(x is not None for x in (
            pivot_month_shift_this_year_by_last_year_month, 
            pivot_month_shift_this_year_by_month_match, 
            pivot_month_shift_last_year_by_month_match
        )):
            ws_name = "timing_shift_pivot"
            ws = wb.add_worksheet(ws_name)
            writer.sheets[ws_name] = ws
            fmt_header = wb.add_format({"bold": True, "align": "center", "valign": "vcenter"})
            fmt_bold = wb.add_format({"bold": True})
            fmt_left = wb.add_format({'align': 'left', 'valign': 'vcenter'})
            fmt_center = wb.add_format({'align': 'center', 'valign': 'vcenter'})

            # Helper to write a pivot table (with title, headers, index, data) at (start_row, start_col)
            def write_pivot(ws, title, pivot, start_row, start_col=0):
                ws.write(start_row, start_col, title, fmt_bold)
                # Write column headers (shifted by 1 for index col)
                for c, col in enumerate(pivot.columns):
                    ws.write(start_row + 1, start_col + 1 + c, str(col), fmt_header)
                # Write row index and data
                for r, (idx, row) in enumerate(zip(pivot.index, pivot.values.tolist())):
                    ws.write(start_row + 2 + r, start_col, str(idx), fmt_header)
                    ws.write_row(start_row + 2 + r, start_col + 1, row, fmt_center)

            # Write pivots with some spacing
            write_pivot(ws, "Pivot 1: This Year (rows) vs Last Year (cols)", pivot_month_shift_this_year_by_last_year_month, 0)
            row2 = 0 + 2 + len(pivot_month_shift_this_year_by_last_year_month.index) + 2
            write_pivot(ws, "Pivot 2: This Year (rows) vs Month Match (cols)", pivot_month_shift_this_year_by_month_match, row2)
            row3 = row2 + 2 + len(pivot_month_shift_this_year_by_month_match.index) + 2
            write_pivot(ws, "Pivot 3: Last Year (rows) vs Month Match (cols)", pivot_month_shift_last_year_by_month_match, row3)

            # Formatting for this sheet: col A left, rest centered
            ws.set_column(0, 0, 20, fmt_left)
            ws.set_column(1, 100, 20, fmt_center)
            ws.set_zoom(75)
            ws.freeze_panes(2, 1)



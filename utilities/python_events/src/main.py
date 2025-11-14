import os
import sys
import pandas as pd
from pathlib import Path
from datetime import datetime, date

from directory_utilities import get_output_path, archive_prior_output, parse_args, get_month_info

from data_loader import load_data
from data_processing import group_clean_data

from fuzzy_matching import fuzzy_match_events_bidirectional

from date_analysis import date_shift_analysis
from match_analysis import perform_year_over_year_analysis

from export_to_png_pdf import (create_chart_png, create_chart_pdf)
from export_to_excel import export_to_excel

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

print("this_year:", this_year)
print("last_year:", last_year)

print(">>> Starting main.py", flush=True)

# Ensure emoji/unicode output works on Windows
if os.name == 'nt':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

def main():
    # Parse command line arguments
    # python main.py --month 4
    args = parse_args()
    ANALYSIS_MONTH, ANALYSIS_MONTH_NAME = get_month_info(args.month)
    print("🔍 Analysis Month = ", ANALYSIS_MONTH)
    
    # --- CREATE DIRECTORIES ---
    print("🔍 Creating directories & paths")
    directory = "usat_event_python_output_data"
    archive_prior_output(directory)
    event_output_path = get_output_path(directory)

    # --- LOAD DATA ---
    df = load_data("usat_event_python_input_data")
    # print("Columns in df:", df.columns)
    # print("First 5 rows:", df.head())

    # --- GROUP & CLEAN DATA ---
    (grouped_df, qa_summary, summary_last_year, summary_this_year, pivot_all, pivot_filtered, filtered_df, pivot_value_all, pivot_value_filtered) = group_clean_data(df)

    # # TEST 100 from each year for testing
    # test_df = pd.concat([
    #     grouped_df[grouped_df['year'] == this_year].head(100),
    #     grouped_df[grouped_df['year'] == last_year].head(100)
    # ])
    # events_this_year, events_last_year, match_summary_this_year, match_summary_last_year = fuzzy_match_events_bidirectional(test_df)

    # # --- FUZZY MATCHING LAST YEAR TO THIS YEAR & THIS YEAR TO LAST YEAR ---
    events_this_year, events_last_year, match_summary_this_year, match_summary_last_year = fuzzy_match_events_bidirectional(grouped_df)

    # Filter Draft events for LAST YEAR, safely handling NaN or non‑string statuses
    draft_last_year_events = grouped_df[
        (grouped_df['year'] == last_year) &
        (grouped_df['source'] != 'from_missing_in_event_data_metrics') &
        (grouped_df['Status']
            .fillna('')          # turn NaN/None into ''
            .astype(str)         # everything becomes a string
            .str.lower()         # now safe to lowercase
            == 'draft'
        )
    ]

    # --- DATE SHIFT ANALYSIS ---
    timing_shift_output, shifted_into_month_output, timing_shift_data = date_shift_analysis(
        events_this_year, ANALYSIS_MONTH, ANALYSIS_MONTH_NAME
    )

    # For the analysis month (e.g., April 2025) use the subset from timing_shift_data
    analysis_month_shift = timing_shift_data[timing_shift_data['month_this_year'] == ANALYSIS_MONTH].copy()

    # Now run the year-over-year analysis.  
    consolidated_match_data = perform_year_over_year_analysis(event_output_path, df, grouped_df, events_this_year, events_last_year, "all", timing_shift_output)

    # # print("TYPE consolidated_match_data:", type(consolidated_match_data))
    # # print("TYPE timing_shift_output:", type(timing_shift_output))

    # --- CHART EXPORTS TO INDIVIDUAL PNG FILES --- 
    create_chart_png(event_output_path, ANALYSIS_MONTH_NAME, grouped_df, qa_summary, summary_last_year, summary_this_year, pivot_all, pivot_filtered, filtered_df, events_this_year, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered)

    # # --- CHART EXPORTS TO PDF ---
    create_chart_pdf(event_output_path, ANALYSIS_MONTH_NAME, grouped_df, qa_summary, summary_last_year, summary_this_year, pivot_all, pivot_filtered, filtered_df, events_this_year, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered)

    # Filter out "missing_in_event_data_metrics" from events_last_year
    filtered_last_year = events_last_year[
        events_last_year['source'] != 'from_missing_in_event_data_metrics'
    ]

    # Then do your unmatched logic as before, but with the filtered dataframe
    unmatched_last_year = filtered_last_year[~filtered_last_year['Name'].isin(
        events_this_year[events_this_year['has_match'] == True]['match_name_last_year']
    )]

    # --- EXPORT TO EXCEL ---
    export_to_excel(event_output_path, ANALYSIS_MONTH_NAME, df, grouped_df, qa_summary, match_summary_this_year, match_summary_last_year, events_this_year, events_last_year, draft_last_year_events, timing_shift_output, shifted_into_month_output, unmatched_last_year, pivot_value_all, pivot_value_filtered)

def is_venv():
    return sys.prefix != sys.base_prefix

def test():
    """Lightweight test to verify that the script loads data and initializes key steps."""
    print("🔍 Running lightweight test...")

    print("🐍 Python executable:", sys.executable)
    print("📦 Site-packages location:", next(p for p in sys.path if 'site-packages' in p))
    print("🧪 VENV active:", is_venv())

    if not is_venv():
        print("❌ ERROR: You are not using the virtual environment!")
        print(f"   Python used: {sys.executable}")
        sys.exit(1)

    try:
        # Load and display basic info from data
        df = load_data("usat_event_python_input_data")
        # print(f"✅ Data loaded: {df.shape[0]} rows, {df.shape[1]} columns")

        # Run group and clean step
        grouped_df, *_ = group_clean_data(df)
        # print(f"✅ Grouped data: {grouped_df.shape[0]} rows")

        # Try matching logic on a sample
        sample_this_year, _, _, _ = match_events_bidirectional(grouped_df.head(100))
        # print(f"✅ Sample matching complete: {sample_this_year.shape[0]} events")

        print("🎉 Test passed successfully.")

    except Exception as e:
        print("❌ Test failed:", str(e))

# NOTE: See note_test_run.txt to view how to test this file
# NOTE: See notes_venv_setup.txt to setup venv environment

if __name__ == "__main__":
    if "--test" in sys.argv:
        test()
    else:
        main()

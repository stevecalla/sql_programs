import os
import sys
import pandas as pd
from pathlib import Path

from directory_utilities import get_output_path, archive_prior_output, parse_args, get_month_info

from data_loader import load_data
from data_processing import group_clean_data

# from fuzzy_matching import match_events_2025_vs_2024, match_events_2024_vs_2025
from fuzzy_matching import match_events_bidirectional

from date_analysis import date_shift_analysis
from match_analysis import perform_year_over_year_analysis

from export_to_png_pdf import (create_chart_png, create_chart_pdf)
from export_to_excel import export_to_excel

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

    # --- GROUP & CLEAN DATA ---
    (grouped_df, qa_summary, summary_2024, summary_2025, pivot_all, pivot_filtered, filtered_df, pivot_value_all, pivot_value_filtered) = group_clean_data(df)

    # --- FUZZY MATCHING 2024 TO 2025 & 2025 TO 2024 ---
    events_2025, events_2024, match_summary_2025, match_summary_2024 = match_events_bidirectional(grouped_df)

    # Filter Draft events for 2024, safely handling NaN or non‑string statuses
    draft_2024_events = grouped_df[
        (grouped_df['year'] == 2024) &
        (grouped_df['Status']
            .fillna('')          # turn NaN/None into ''
            .astype(str)         # everything becomes a string
            .str.lower()         # now safe to lowercase
            == 'draft'
        )
    ]

    # --- DATE SHIFT ANALYSIS ---
    timing_shift_output, shifted_into_month_output, timing_shift_data = date_shift_analysis(
        events_2025, ANALYSIS_MONTH, ANALYSIS_MONTH_NAME
    )

    # Now run the year-over-year analysis.
    perform_year_over_year_analysis(event_output_path, grouped_df, events_2025, events_2024, "all")

     # Now run the year-over-year analysis.
    perform_year_over_year_analysis(event_output_path, filtered_df, events_2025, events_2024, "filtered")

    # For the analysis month (e.g., April 2025) use the subset from timing_shift_data
    analysis_month_shift = timing_shift_data[timing_shift_data['month_2025'] == ANALYSIS_MONTH].copy()

    # --- CHART EXPORTS TO INDIVIDUAL PNG FILES ---
    create_chart_png(event_output_path, ANALYSIS_MONTH_NAME, grouped_df, qa_summary, summary_2024, summary_2025,
     pivot_all, pivot_filtered, filtered_df, events_2025, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered)

    # --- CHART EXPORTS TO PDF ---
    create_chart_pdf(event_output_path, ANALYSIS_MONTH_NAME, grouped_df, qa_summary, summary_2024, summary_2025, pivot_all, pivot_filtered, filtered_df, events_2025, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered)

    # --- EVENTS IN 2024 WITH NO MATCH IN 2025 ---
    unmatched_2024 = events_2024[~events_2024['Name'].isin(
        events_2025[events_2025['has_match'] == True]['match_name_2024']
    )]

    # --- EXPORT TO EXCEL ---
    export_to_excel(event_output_path, ANALYSIS_MONTH_NAME, df, grouped_df, qa_summary, match_summary_2025, match_summary_2024, events_2025, events_2024, draft_2024_events, timing_shift_output, shifted_into_month_output, unmatched_2024, pivot_value_all, pivot_value_filtered)

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
        sample_2025, _, _, _ = match_events_bidirectional(grouped_df.head(100))
        # print(f"✅ Sample matching complete: {sample_2025.shape[0]} events")

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

import pandas as pd
import os
from matplotlib.backends.backend_pdf import PdfPages
from config import MATCH_SCORE_THRESHOLD, ANALYSIS_MONTH, MONTH_NAME, PATH_PREFIX_OUTPUT

from data_loader import load_data
from data_processing import group_clean_data
from fuzzy_matching import match_events_2025_vs_2024, match_events_2024_vs_2025
from date_analysis import date_shift_analysis
from chart_output_png import (
    save_match_score_histogram, save_bar_chart,
    save_yoy_comparison_chart, save_day_diff_histogram, save_month_shift_bar, save_yoy_comparison_chart_for_value
)
from chart_output_pdf import (
    save_match_score_histogram_pdf, save_bar_chart_pdf,
    save_yoy_comparison_chart_pdf, save_day_diff_histogram_pdf, save_month_shift_bar_pdf
)
from export import export_to_excel
from match_analysis import perform_year_over_year_analysis

# --- CHART EXPORTS TO INDIVIDUAL PNG FILES---
def create_chart_png(grouped_df, qa_summary, summary_2024, summary_2025,
     pivot_all, pivot_filtered, filtered_df, events_2025, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered):
    # --- CHART EXPORTS TO INDIVIDUAL PNG FILES---
    save_match_score_histogram(events_2025, f"{PATH_PREFIX_OUTPUT}match_score_hist.png")
    save_bar_chart(summary_2024, 2024, f"{PATH_PREFIX_OUTPUT}chart_2024.png")
    save_bar_chart(summary_2025, 2025, f"{PATH_PREFIX_OUTPUT}chart_2025.png")
    # Draft status charts
    save_bar_chart(summary_2024[summary_2024['Status'].str.lower() == 'draft'], 2024,
                f"{PATH_PREFIX_OUTPUT}chart_2024_draft_status.png", title_prefix="Monthly Draft Events for")
    save_bar_chart(summary_2025[summary_2025['Status'].str.lower() == 'draft'], 2025,
                f"{PATH_PREFIX_OUTPUT}chart_2025_draft_status.png", title_prefix="Monthly Draft Events for")
    # YoY charts
    save_yoy_comparison_chart(pivot_all, "YoY Comparison (All)", f"{PATH_PREFIX_OUTPUT}chart_yoy_all.png")
    save_yoy_comparison_chart(pivot_filtered, "YoY Comparison (Filtered)", f"{PATH_PREFIX_OUTPUT}chart_yoy_filtered.png")

    # Pass the filtered DataFrame and the dynamic month name to your functions.
    _ = save_day_diff_histogram(analysis_month_shift, MONTH_NAME, f"{PATH_PREFIX_OUTPUT}{MONTH_NAME.lower()}_2025_shift_histogram.png")
    _ = save_month_shift_bar(analysis_month_shift, MONTH_NAME, f"{PATH_PREFIX_OUTPUT}{MONTH_NAME.lower()}_2025_month_shift_bar.png")
    for val in pivot_value_filtered['Value'].unique():
        # Construct a filename based on the value (e.g., replacing spaces with underscores)
        filename = f"chart_yoy_filtered_{str(val).replace(' ', '_').lower()}.png" # filtered excluded cancelled & deleted
        out_path = os.path.join(PATH_PREFIX_OUTPUT, filename)
        save_yoy_comparison_chart_for_value(pivot_value_filtered, val, out_path)
        # save_yoy_comparison_chart_for_value(pivot_value_filtered, "Adult Event", f"{PATH_PREFIX_OUTPUT}test.png")

# --- CHART EXPORTS TO PDF---
def create_chart_pdf(grouped_df, qa_summary, summary_2024, summary_2025,
     pivot_all, pivot_filtered, filtered_df, events_2025, timing_shift_data, analysis_month_shift):
    with PdfPages(F"{PATH_PREFIX_OUTPUT}charts.pdf") as pdf_pages:
        save_match_score_histogram_pdf(events_2025, pdf_pages)
        save_bar_chart_pdf(summary_2024, 2024, pdf_pages, title_prefix="Monthly Event Trends for")
        save_bar_chart_pdf(summary_2025, 2025, pdf_pages)
        # For Draft status charts:
        save_bar_chart_pdf(summary_2024[summary_2024['Status'].str.lower() == 'draft'], 2024,
                    pdf_pages, title_prefix="Monthly Draft Events for")
        save_bar_chart_pdf(summary_2025[summary_2025['Status'].str.lower() == 'draft'], 2025,
                    pdf_pages, title_prefix="Monthly Draft Events for")
        # YoY charts:
        save_yoy_comparison_chart_pdf(pivot_all, "YoY Comparison (All)", pdf_pages)
        save_yoy_comparison_chart_pdf(pivot_filtered, "YoY Comparison (Filtered)", pdf_pages)
        # Analysis month charts (using april_2025_shift DataFrame)
        save_day_diff_histogram_pdf(analysis_month_shift, MONTH_NAME, pdf_pages)
        save_month_shift_bar_pdf(analysis_month_shift, MONTH_NAME, pdf_pages)

def main():
    # --- LOAD DATA ---
    df = load_data()

    # --- GROUP & CLEAN DATA ---
    (grouped_df, qa_summary, summary_2024, summary_2025, pivot_all, pivot_filtered, filtered_df, pivot_value_all, pivot_value_filtered) = group_clean_data(df)

    # Create a filtered grouped DataFrame that excludes canceled or deleted events.
    filtered_grouped_df = grouped_df[~grouped_df['Status'].str.lower().isin(['cancelled', 'deleted'])]

    # --- FUZZY MATCHING 2025 TO 2024 ---
    events_2025, events_2024, match_summary = match_events_2025_vs_2024(grouped_df, MATCH_SCORE_THRESHOLD)

    # --- FUZZY MATCHING 2024 TO 2025 ---
    events_2024, match_summary_2024 = match_events_2024_vs_2025(events_2024, events_2025, MATCH_SCORE_THRESHOLD)

    # Filter Draft events for 2024
    draft_2024_events = grouped_df[(grouped_df['year'] == 2024) & (grouped_df['Status'].str.lower() == 'draft')]

    # --- DATE SHIFT ANALYSIS ---
    timing_shift_output, shifted_into_month_output, timing_shift_data = date_shift_analysis(
        events_2025, ANALYSIS_MONTH, MONTH_NAME
    )

    # Now run the year-over-year analysis.
    perform_year_over_year_analysis(PATH_PREFIX_OUTPUT, grouped_df, events_2025, events_2024, "all")

     # Now run the year-over-year analysis.
    perform_year_over_year_analysis(PATH_PREFIX_OUTPUT, filtered_grouped_df, events_2025, events_2024, "filtered")

    # For the analysis month (e.g., April 2025) use the subset from timing_shift_data
    analysis_month_shift = timing_shift_data[timing_shift_data['month_2025'] == ANALYSIS_MONTH].copy()

    # --- CHART EXPORTS TO INDIVIDUAL PNG FILES ---
    create_chart_png(grouped_df, qa_summary, summary_2024, summary_2025,
     pivot_all, pivot_filtered, filtered_df, events_2025, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered)

    # # --- CHART EXPORTS TO PDF ---
    # create_chart_pdf(grouped_df, qa_summary, summary_2024, summary_2025,
    #  pivot_all, pivot_filtered, filtered_df, events_2025, timing_shift_data, analysis_month_shift)

    # --- EVENTS IN 2024 WITH NO MATCH IN 2025 ---
    unmatched_2024 = events_2024[~events_2024['Name'].isin(
        events_2025[events_2025['has_match'] == True]['match_name_2024']
    )]

    # --- EXPORT TO EXCEL ---
    export_to_excel(df, grouped_df, qa_summary, match_summary, match_summary_2024,
                    events_2025, events_2024, draft_2024_events,
                    timing_shift_output, shifted_into_month_output, unmatched_2024, pivot_value_all, pivot_value_filtered)

if __name__ == "__main__":
    main()

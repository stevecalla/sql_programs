import pandas as pd
import os
from matplotlib.backends.backend_pdf import PdfPages
from config import MATCH_SCORE_THRESHOLD, ANALYSIS_MONTH, MONTH_NAME, PATH_PREFIX_OUTPUT

from data_loader import load_data
from data_processing import group_clean_data
from fuzzy_matching import match_events_2025_vs_2024, match_events_2024_vs_2025
from date_analysis import date_shift_analysis

from chart_output_png_pdf import (
    save_match_score_histogram, save_bar_chart,
    save_yoy_comparison_chart, save_day_diff_histogram, save_month_shift_bar,
    save_yoy_comparison_chart_for_value
)
from excel_export import export_to_excel
from match_analysis import perform_year_over_year_analysis

# CREATE PNG USING POSITIONAL PARAMETER
def create_chart_png(grouped_df, qa_summary, summary_2024, summary_2025,
     pivot_all, pivot_filtered, filtered_df, events_2025, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered):
    
    with PdfPages(f"{PATH_PREFIX_OUTPUT}charts.pdf") as pdf_pages:

        # Add match score histogram
        save_match_score_histogram(events_2025, f"{PATH_PREFIX_OUTPUT}match_score_hist.png", None)
        
        # Add monthly bar charts
        save_bar_chart(summary_2024, 2024, f"{PATH_PREFIX_OUTPUT}chart_2024.png", None, title_prefix="Monthly Event Trends for")
        save_bar_chart(summary_2025, 2025, f"{PATH_PREFIX_OUTPUT}chart_2025.png", None, title_prefix="Monthly Event Trends for")
        
        # Add Draft status charts
        save_bar_chart(summary_2024[summary_2024['Status'].str.lower() == 'draft'], 2024, 
                            f"{PATH_PREFIX_OUTPUT}chart_2024_draft_status.png",
                           None, title_prefix="Monthly Draft Events for")
        save_bar_chart(summary_2025[summary_2025['Status'].str.lower() == 'draft'], 2025,
                           f"{PATH_PREFIX_OUTPUT}chart_2025_draft_status.png", 
                           None, title_prefix="Monthly Draft Events for")
        
        # Add YoY charts (all and filtered)
        save_yoy_comparison_chart(pivot_all, "YoY Comparison (All)", f"{PATH_PREFIX_OUTPUT}chart_yoy_all.png", None)
        save_yoy_comparison_chart(pivot_filtered, "YoY Comparison (Filtered)", f"{PATH_PREFIX_OUTPUT}chart_yoy_filtered.png", None)
        
        # Add month shift charts
        save_day_diff_histogram(analysis_month_shift, MONTH_NAME, f"{PATH_PREFIX_OUTPUT}{MONTH_NAME.lower()}_2025_shift_histogram.png", None)
        save_month_shift_bar(analysis_month_shift, MONTH_NAME, f"{PATH_PREFIX_OUTPUT}{MONTH_NAME.lower()}_2025_month_shift_bar.png", None)
        
        # Add YoY charts for each unique value
        for val in pivot_value_filtered['Value'].unique():
            # If you want to specify a filename, you could construct it here:
            filename = f"chart_yoy_filtered_{str(val).replace(' ', '_').lower()}.png"
            out_path = os.path.join(PATH_PREFIX_OUTPUT, filename)
            save_yoy_comparison_chart_for_value(pivot_value_filtered, val, out_path, None)

# CREATE PDF USING POSITIONAL PARAMETER
def create_chart_pdf(grouped_df, qa_summary, summary_2024, summary_2025,
     pivot_all, pivot_filtered, filtered_df, events_2025, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered):
    
    with PdfPages(f"{PATH_PREFIX_OUTPUT}charts.pdf") as pdf_pages:

        # Add match score histogram
        save_match_score_histogram(events_2025, None, pdf_pages)
        
        # Add monthly bar charts
        save_bar_chart(summary_2024, 2024, None, pdf_pages, title_prefix="Monthly Event Trends for")
        save_bar_chart(summary_2025, 2025, None, pdf_pages)
        
        # Add Draft status charts
        save_bar_chart(summary_2024[summary_2024['Status'].str.lower() == 'draft'], 2024, None,
                           pdf_pages, title_prefix="Monthly Draft Events for")
        save_bar_chart(summary_2025[summary_2025['Status'].str.lower() == 'draft'], 2025,
                           None, pdf_pages, title_prefix="Monthly Draft Events for")
        
        # Add YoY charts (all and filtered)
        save_yoy_comparison_chart(pivot_all, "YoY Comparison (All)", None, pdf_pages)
        save_yoy_comparison_chart(pivot_filtered, "YoY Comparison (Filtered)", None, pdf_pages)
        
        # Add month shift charts
        save_day_diff_histogram(analysis_month_shift, MONTH_NAME, None, pdf_pages)
        save_month_shift_bar(analysis_month_shift, MONTH_NAME, None, pdf_pages)
        
        # Add YoY charts for each unique value
        for val in pivot_value_filtered['Value'].unique():
            # If you want to specify a filename, you could construct it here:
            # filename = f"chart_yoy_filtered_{str(val).replace(' ', '_').lower()}.pdf"
            save_yoy_comparison_chart_for_value(pivot_value_filtered, val, None, pdf_pages)

def main():
    # --- LOAD DATA ---
    df = load_data()

    # --- GROUP & CLEAN DATA ---
    (grouped_df, qa_summary, summary_2024, summary_2025, pivot_all, pivot_filtered, filtered_df, pivot_value_all, pivot_value_filtered) = group_clean_data(df)

    # Create a filtered grouped DataFrame that excludes canceled or deleted events.
    filtered_grouped_df = grouped_df[~grouped_df['Status'].str.lower().isin(['cancelled', 'deleted'])]

    # --- FUZZY MATCHING 2025 TO 2024 ---
    events_2025, match_summary_2025 = match_events_2025_vs_2024(grouped_df)

    # --- FUZZY MATCHING 2024 TO 2025 ---
    events_2024, match_summary_2024 = match_events_2024_vs_2025(grouped_df)

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

    # --- CHART EXPORTS TO PDF ---
    create_chart_pdf(grouped_df, qa_summary, summary_2024, summary_2025, pivot_all, pivot_filtered, filtered_df, events_2025, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered)

    # --- EVENTS IN 2024 WITH NO MATCH IN 2025 ---
    unmatched_2024 = events_2024[~events_2024['Name'].isin(
        events_2025[events_2025['has_match'] == True]['match_name_2024']
    )]

    # --- EXPORT TO EXCEL ---
    export_to_excel(df, grouped_df, qa_summary, match_summary_2025, match_summary_2024,
                    events_2025, events_2024, draft_2024_events,
                    timing_shift_output, shifted_into_month_output, unmatched_2024, pivot_value_all, pivot_value_filtered)

if __name__ == "__main__":
    main()

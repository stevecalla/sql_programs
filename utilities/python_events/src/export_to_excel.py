import pandas as pd
import numpy as np
import warnings

def export_to_excel(
    event_output_path, 
    ANALYSIS_MONTH_NAME, 
    df, 
    grouped_df, 
    qa_summary,
    match_summary_this_year, 
    match_summary_last_year,
    events_this_year, 
    events_last_year, 
    draft_last_year_events,
    timing_shift_output, 
    shifted_into_month_output,
    unmatched_last_year, 
    pivot_value_all, 
    pivot_value_filtered
):

    OUTPUT_FILE = event_output_path / "cleaned_grouped_event_data_with_summary.xlsx"

    # --- CLEAN ALL DATAFRAMES --- #
    # Opt-in globally to new downcasting behavior (future behavior)
    # Address wrning for the ".replace" function
    pd.set_option('future.no_silent_downcasting', True)

    def clean_df(df):
        return (
            df.replace([np.inf, -np.inf], np.nan)  # Convert inf/-inf to NaN
            .fillna('')                            # Replace NaN with empty string
        )

    # All DataFrames to export
    sheet_data = {
        'original_data': df,
        'grouped_data': grouped_df,
        'qa_summary': qa_summary,
        'match_summary_this_year': match_summary_this_year,
        'events_this_year_matches': events_this_year,
        'match_summary_last_year': match_summary_last_year,
        'events_last_year_matches': events_last_year,
        'draft_events_last_year': draft_last_year_events,
        'timing_shift_analysis': timing_shift_output,
        f'shifted_into_{ANALYSIS_MONTH_NAME.lower()}': shifted_into_month_output,
        'unmatched_events_last_year': unmatched_last_year,
        'pivot_value_all': pivot_value_all,
        'pivot_value_filtered': pivot_value_filtered
    }

    # Clean all DataFrames
    for k in sheet_data:
        sheet_data[k] = clean_df(sheet_data[k])

    # --- EXPORT TO EXCEL --- #
    with pd.ExcelWriter(OUTPUT_FILE, engine='xlsxwriter') as writer:
        workbook = writer.book
        center_format = workbook.add_format({'align': 'center', 'valign': 'vcenter'})
        left_format = workbook.add_format({'align': 'left', 'valign': 'vcenter'})

        for sheet_name, data in sheet_data.items():
            data.to_excel(writer, sheet_name=sheet_name, index=False)
            worksheet = writer.sheets[sheet_name]

            # Set all columns to auto-width and center (except web URLs)
            for i, col in enumerate(data.columns):
                col_str = str(col)
                if col_str.lower() not in ['website', 'registrationwebsite', 'website_2024']:
                    max_len = max(data[col].astype(str).map(len).max(), len(str(col))) + 2
                    worksheet.set_column(i, i, max_len, center_format)
                else:
                    worksheet.set_column(i, i, None, center_format)

            # Apply left alignment for the first column, center for others
            worksheet.set_column(0, 0, 20, left_format)
            worksheet.set_column(1, len(data.columns)-1, 20, center_format)
            worksheet.set_zoom(75)
            worksheet.freeze_panes(3, 2)  # Freeze first row

    print(f"File saved to {event_output_path}")


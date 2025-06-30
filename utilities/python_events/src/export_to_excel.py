import pandas as pd

def export_to_excel(event_output_path,  ANALYSIS_MONTH_NAME, df, grouped_df, qa_summary, match_summary_this_year, match_summary_last_year, events_this_year, events_last_year, draft_last_year_events, timing_shift_output, shifted_into_month_output, unmatched_last_year, pivot_value_all, pivot_value_filtered):

    OUTPUT_FILE = event_output_path / "cleaned_grouped_event_data_with_summary.xlsx"

    """Export all DataFrames to an Excel file with multiple sheets and formatting."""
    with pd.ExcelWriter(OUTPUT_FILE, engine='xlsxwriter') as writer:
        # Write all sheets
        df.to_excel(writer, sheet_name='original_data', index=False)
        grouped_df.to_excel(writer, sheet_name='grouped_data', index=False)
        qa_summary.to_excel(writer, sheet_name='qa_summary', index=False)
        match_summary_this_year.to_excel(writer, sheet_name='match_summary_this_year', index=False)
        match_summary_last_year.to_excel(writer, sheet_name='match_summary_last_year', index=False)
        events_this_year.to_excel(writer, sheet_name='events_this_year_matches', index=False)
        events_last_year.to_excel(writer, sheet_name='events_last_year_matches', index=False)
        draft_last_year_events.to_excel(writer, sheet_name='draft_events_last_year', index=False)
        timing_shift_output.to_excel(writer, sheet_name='timing_shift_analysis', index=False)
        shifted_into_month_output.to_excel(writer, sheet_name=f'shifted_into_{ ANALYSIS_MONTH_NAME.lower()}', index=False)
        unmatched_last_year.to_excel(writer, sheet_name='unmatched_events_last_year', index=False)
        pivot_value_all.to_excel(writer, sheet_name='pivot_value_all', index=False)
        pivot_value_filtered.to_excel(writer, sheet_name='pivot_value_filtered', index=False)

        # Format each sheet: set column width with center alignment
        workbook = writer.book
        center_format = workbook.add_format({'align': 'center', 'valign': 'vcenter'})
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
            f'shifted_into_{ ANALYSIS_MONTH_NAME.lower()}': shifted_into_month_output,
            'unmatched_events_last_year': unmatched_last_year,
            'pivot_value_all': pivot_value_all,
            'pivot_value_filtered': pivot_value_filtered

        }
        for sheet_name, data in sheet_data.items():
            worksheet = writer.sheets[sheet_name]
            for i, col in enumerate(data.columns):
                col_str = str(col)
                if col_str.lower() not in ['website', 'registrationwebsite', 'website_2024']:
                    max_len = max(data[col].astype(str).map(len).max(), len(str(col))) + 2
                    worksheet.set_column(i, i, max_len, center_format)
                else:
                    worksheet.set_column(i, i, None, center_format)
    print(f"File saved to {event_output_path}")

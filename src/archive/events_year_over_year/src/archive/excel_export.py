import pandas as pd
from config import OUTPUT_FILE, MONTH_NAME

def export_to_excel(df, grouped_df, qa_summary, match_summary, match_summary_2024,
                    events_2025, events_2024, draft_2024_events,
                    timing_shift_output, shifted_into_month_output, unmatched_2024, pivot_value_all, pivot_value_filtered):
    """Export all DataFrames to an Excel file with multiple sheets and formatting."""
    with pd.ExcelWriter(OUTPUT_FILE, engine='xlsxwriter') as writer:
        # Write all sheets
        df.to_excel(writer, sheet_name='original_data', index=False)
        grouped_df.to_excel(writer, sheet_name='grouped_data', index=False)
        qa_summary.to_excel(writer, sheet_name='qa_summary', index=False)
        match_summary.to_excel(writer, sheet_name='2025_match_summary', index=False)
        match_summary_2024.to_excel(writer, sheet_name='2024_match_summary', index=False)
        events_2025.to_excel(writer, sheet_name='events_2025_matches', index=False)
        events_2024.to_excel(writer, sheet_name='events_2024_matches', index=False)
        draft_2024_events.to_excel(writer, sheet_name='2024_draft_events', index=False)
        timing_shift_output.to_excel(writer, sheet_name='timing_shift_analysis', index=False)
        shifted_into_month_output.to_excel(writer, sheet_name=f'shifted_into_{MONTH_NAME.lower()}', index=False)
        unmatched_2024.to_excel(writer, sheet_name='2024_unmatched_events', index=False)
        pivot_value_all.to_excel(writer, sheet_name='pivot_value_all', index=False)
        pivot_value_filtered.to_excel(writer, sheet_name='pivot_value_filtered', index=False)

        # Format each sheet: set column width with center alignment
        workbook = writer.book
        center_format = workbook.add_format({'align': 'center', 'valign': 'vcenter'})
        sheet_data = {
            'original_data': df,
            'grouped_data': grouped_df,
            'qa_summary': qa_summary,
            '2025_match_summary': match_summary,
            'events_2025_matches': events_2025,
            '2024_match_summary': match_summary_2024,
            'events_2024_matches': events_2024,
            '2024_draft_events': draft_2024_events,
            'timing_shift_analysis': timing_shift_output,
            f'shifted_into_{MONTH_NAME.lower()}': shifted_into_month_output,
            '2024_unmatched_events': unmatched_2024,
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
    # print(f"File saved to {OUTPUT_FILE}")

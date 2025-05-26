# analysis.py
import os
import pandas as pd
import matplotlib.pyplot as plt

def perform_year_over_year_analysis(PATH_PREFIX, grouped_df, events_2025, events_2024, file_prefix):
    """
    Conducts year-over-year analysis and outputs charts and Excel results.

    Parameters:
      grouped_df: The full cleaned and grouped DataFrame.
      events_2025: DataFrame for current year events (e.g. 2025) that includes match columns.
      events_2024: DataFrame for prior year events (e.g. 2024) that includes match columns.

    This function will:
      (a) Identify for 2025 which events repeated (occurred in 2024) vs. which are new.
      (b) Identify for 2024 which events repeated vs. which did not repeat in 2025.
      (c) Produce a pivot summary of event counts overall and by the "Value" column.
      (d) Generate charts and consolidate the analysis into an Excel workbook.
    
    Returns a dictionary with paths to the output files and selected DataFrames.
    """
    os.makedirs(PATH_PREFIX, exist_ok=True)
    
    # --- (a) Analysis for Current Year (2025) ---
    repeated_events_2025 = events_2025[events_2025['has_match'] == True].copy()
    new_events_2025 = events_2025[events_2025['has_match'] == False].copy()
    
    # --- (b) Analysis for Prior Year (2024) ---
    repeated_events_2024 = events_2024[events_2024['has_match'] == True].copy()
    lost_events_2024 = events_2024[events_2024['has_match'] == False].copy()
    
    # --- (c) Summary by Total and "Value" Column ---
    # Create a raw summary grouped by year and Value.
    value_summary = (
        grouped_df.groupby(['year', 'Value'])
        .size()
        .reset_index(name='event_count')
    )
    # Pivot so that each row is a Value segment and columns are years.
    pivot_value = value_summary.pivot(index='Value', columns='year', values='event_count').fillna(0)
    if 2024 in pivot_value.columns and 2025 in pivot_value.columns:
        pivot_value['difference'] = pivot_value[2025] - pivot_value[2024]
    else:
        pivot_value['difference'] = None

    # Create a chart for the Value summary.
    chart_value_summary = f"{PATH_PREFIX}value_summary_chart_{file_prefix}.png"
    plot_value_summary(pivot_value, chart_value_summary, file_prefix)
    
    # --- (d) Analysis for Non-Repeating Events ---
    # For the current year: new events; for the previous year: lost events.
    chart_nonrepeating = f"{PATH_PREFIX}nonrepeating_events_chart_{file_prefix}.png"
    plot_nonrepeating_counts(new_events_2025, lost_events_2024, chart_nonrepeating, file_prefix)
    
    # --- Export All Analysis to Excel ---
    excel_output = f"{PATH_PREFIX}events_year_over_year_analysis_{file_prefix}.xlsx"
    export_analysis_to_excel(
        grouped_df, pivot_value,
        repeated_events_2025, new_events_2025,
        repeated_events_2024, lost_events_2024,
        value_summary, excel_output
    )
    
    print(f"Excel analysis saved to: {excel_output}")
    
    # Return a summary of outputs in a dictionary
    return {
        "repeated_events_2025": repeated_events_2025,
        "new_events_2025": new_events_2025,
        "repeated_events_2024": repeated_events_2024,
        "lost_events_2024": lost_events_2024,
        "pivot_value": pivot_value,
        "value_summary": value_summary,
        "value_summary_chart": chart_value_summary,
        "nonrepeating_events_chart": chart_nonrepeating,
        "excel_file": excel_output
    }

def plot_value_summary(pivot_df, output_path, file_prefix):
    """Generate a grouped bar chart for event counts by Value."""
    fig, ax = plt.subplots(figsize=(10, 6))
    pivot_sorted = pivot_df.sort_index()
    x = range(len(pivot_sorted))
    bar_width = 0.35

    if 2024 in pivot_sorted.columns and 2025 in pivot_sorted.columns:
        bars1 = ax.bar([i - bar_width/2 for i in x], pivot_sorted[2024], width=bar_width, label='2024')
        bars2 = ax.bar([i + bar_width/2 for i in x], pivot_sorted[2025], width=bar_width, label='2025')
        # Annotate YOY difference for each Value segment.
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

def export_analysis_to_excel(grouped_df, pivot_value, repeated_events_2025,
                              new_events_2025, repeated_events_2024, lost_events_2024,
                              value_summary, out_file):
    """Export the analysis results to an Excel workbook with multiple sheets."""
    with pd.ExcelWriter(out_file, engine="xlsxwriter") as writer:
        grouped_df.to_excel(writer, sheet_name="Grouped Data", index=False)
        pivot_value.to_excel(writer, sheet_name="Value Summary Pivot")
        value_summary.to_excel(writer, sheet_name="Value Summary Raw", index=False)
        new_events_2025.to_excel(writer, sheet_name="2025 New Events", index=False)
        repeated_events_2025.to_excel(writer, sheet_name="2025 Repeated Events", index=False)
        lost_events_2024.to_excel(writer, sheet_name="2024 Lost Events", index=False)
        repeated_events_2024.to_excel(writer, sheet_name="2024 Repeated Events", index=False)
        
        # Formatting: set columns to a fixed width and center align content.
        workbook = writer.book
        center_format = workbook.add_format({"align": "center", "valign": "vcenter"})
        for sheet in writer.sheets:
            worksheet = writer.sheets[sheet]
            worksheet.set_column(0, 50, 20, center_format)
            
    # print(f"Excel analysis exported to: {out_file}")

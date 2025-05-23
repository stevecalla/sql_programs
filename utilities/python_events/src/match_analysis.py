# analysis.py
import os
import pandas as pd
import matplotlib.pyplot as plt

# from main import get_output_path

def perform_year_over_year_analysis(event_output_path, grouped_df, events_2025, events_2024, file_prefix):
    """
    Conducts year-over-year analysis and outputs charts and Excel results.
    
    Parameters:
      event_output_path: str
          The folder prefix where outputs (charts, Excel file) will be saved.
      grouped_df: DataFrame
          The full cleaned/grouped DataFrame.
      events_2025: DataFrame
          Current-year (e.g., 2025) events with matching flags.
      events_2024: DataFrame
          Prior-year (e.g., 2024) events with matching flags.
    
    Returns a dictionary with paths to the output files and selected DataFrames.
    """
    
    # --- (a) Analysis for Current Year (2025) ---
    repeated_events_2025 = events_2025[events_2025['has_match'] == True].copy()
    new_events_2025 = events_2025[events_2025['has_match'] == False].copy()
    
    # --- (b) Analysis for Prior Year (2024) ---
    repeated_events_2024 = events_2024[events_2024['has_match'] == True].copy()
    lost_events_2024 = events_2024[events_2024['has_match'] == False].copy()
    
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
    plot_nonrepeating_counts(new_events_2025, output_chart_nonrepeating, file_prefix)
    
    # --- (e) Breakout of New vs. Repeated Events by Month ---
    new_repeat_pivot = new_repeat_by_month(events_2025)
    output_chart_new_repeat = event_output_path / "new_repeat_events_by_month_chart.png"
    plot_new_repeat_by_month(new_repeat_pivot, output_chart_new_repeat)
    
    # --- Export All Analysis to Excel ---
    excel_output = event_output_path / "events_year_over_year_analysis.xlsx"
    excel_output = event_output_path / f"events_year_over_year_analysis_{file_prefix}.xlsx"
    export_analysis_to_excel(
        grouped_df, pivot_value,
        repeated_events_2025, new_events_2025,
        repeated_events_2024, lost_events_2024,
        value_summary, new_repeat_pivot, excel_output
    )
    
    print(f"Excel analysis saved to: {excel_output}")
    
    return {
        "repeated_events_2025": repeated_events_2025,
        "new_events_2025": new_events_2025,
        "repeated_events_2024": repeated_events_2024,
        "lost_events_2024": lost_events_2024,
        "pivot_value": pivot_value,
        "value_summary": value_summary,
        "new_repeat_pivot": new_repeat_pivot,
        "value_summary_chart": output_chart_value_summary,
        "nonrepeating_events_chart": output_chart_nonrepeating,
        "new_repeat_chart": output_chart_new_repeat,
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

def new_repeat_by_month(events_2025):
    """
    Computes a breakout of new vs. repeated events by month for 2025.
    Returns a DataFrame with columns: month, month_name, new_count, repeat_count.
    """
    new_events = events_2025[events_2025['has_match'] == False]
    repeated_events = events_2025[events_2025['has_match'] == True]
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

# --- Export All Analysis to Excel ---
def export_analysis_to_excel(grouped_df, pivot_value, repeated_events_2025,
                              new_events_2025, repeated_events_2024, lost_events_2024,
                              value_summary, new_repeat_pivot, out_file):
    """Export analysis results to an Excel workbook with multiple sheets."""
    with pd.ExcelWriter(out_file, engine="xlsxwriter") as writer:
        grouped_df.to_excel(writer, sheet_name="Grouped Data", index=False)
        pivot_value.to_excel(writer, sheet_name="Value Summary Pivot")
        value_summary.to_excel(writer, sheet_name="Value Summary Raw", index=False)
        new_events_2025.to_excel(writer, sheet_name="2025 New Events", index=False)
        repeated_events_2025.to_excel(writer, sheet_name="2025 Repeated Events", index=False)
        lost_events_2024.to_excel(writer, sheet_name="2024 Lost Events", index=False)
        repeated_events_2024.to_excel(writer, sheet_name="2024 Repeated Events", index=False)
        new_repeat_pivot.to_excel(writer, sheet_name="2025 New vs Repeated by Month", index=False)
        
        # Formatting: adjust columns and center align.
        workbook = writer.book
        center_format = workbook.add_format({"align": "center", "valign": "vcenter"})
        for sheet in writer.sheets:
            worksheet = writer.sheets[sheet]
            worksheet.set_column(0, 50, 20, center_format)
    print(f"Excel analysis exported to: {out_file}")

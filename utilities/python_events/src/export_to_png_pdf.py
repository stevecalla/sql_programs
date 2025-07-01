import pandas as pd
import os
from datetime import datetime

import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
    
# Dynamically set the years for YOY analysis
this_year = datetime.now().year
last_year = this_year - 1

def save_match_score_histogram(events_this_year, output_path, pdf_pages=None):
    """Save a histogram showing the distribution of match scores.
    
    If pdf_pages is provided, the chart is added to the PDF instead of saving as a PNG.
    """

    fig = plt.figure(figsize=(10, 5))
    plt.hist(
        [
            events_this_year['match_score_name_only'].dropna(),
            events_this_year['match_score_name_and_site'].dropna(),
            events_this_year['match_score_name_and_zip'].dropna()
        ],
        bins=20,
        edgecolor='black',
        label=['Name Only', 'Name + Website', 'Name + ZipCode']
    )
    plt.axvline(80, color='red', linestyle='--', label='Typical Match Threshold (80)')
    plt.axvline(90, color='green', linestyle='--', label='Strong Match Threshold (90)')
    plt.title(f"Distribution of Match Scores ({this_year} vs {last_year})")
    plt.xlabel("Match Score")
    plt.ylabel("Event Count")
    plt.grid(True, axis='y', linestyle='--', alpha=0.5)
    plt.legend()
    plt.tight_layout()
    
    if pdf_pages is not None:
        pdf_pages.savefig(fig)
    else:
        plt.savefig(output_path)
    plt.close(fig)

def save_bar_chart(df_summary, year, output_path, pdf_pages=None, title_prefix="Monthly Event Trends for"):
    """Save a bar chart for the event counts per month.
    
    If pdf_pages is provided, adds the figure to the PDF instead of saving as PNG.
    """
    # Calculate total events for this DataFrame (for the given year)
    total_events = df_summary['event_count'].sum()
    
    # Compute monthly totals and force calendar order.
    monthly_total = df_summary.groupby('month_name')['event_count'].sum()
    order = ["January", "February", "March", "April", "May", "June",
             "July", "August", "September", "October", "November", "December"]
    monthly_total = monthly_total.reindex(order).fillna(0)

    fig = plt.figure(figsize=(10, 5))
    bars = plt.bar(monthly_total.index, monthly_total.values)
    for bar in bars:
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width() / 2, height, int(height), ha='center', va='bottom')
        
    plt.title(f"{title_prefix} {year}")
    plt.ylabel("Event Count" if "Trends" in title_prefix else "Draft Event Count")
    plt.xticks(rotation=45)
    plt.gca().annotate(
        f"Total: {int(total_events)}",
        xy=(0.95, 0.95), xycoords='axes fraction',
        ha='right', va='top', fontsize=12,
        bbox=dict(facecolor='white', edgecolor='black', boxstyle='round,pad=0.5')
    )
    plt.tight_layout()
    
    if pdf_pages is not None:
        pdf_pages.savefig(fig)
    else:
        plt.savefig(output_path)
    plt.close(fig)

def save_yoy_comparison_chart(pivot, title, output_path, pdf_pages=None):
    """Save a Year-over-Year comparison chart using a twin axis plot.
    
    If pdf_pages is provided, the chart is added to the PDF.
    """
    fig, ax1 = plt.subplots(figsize=(12, 6))
    x = range(len(pivot))

    ax1.plot(x, pivot[this_year], label=str(this_year), marker='o')
    ax1.plot(x, pivot[last_year], label=str(last_year), marker='o')

    ax1.set_xticks(x)
    ax1.set_xticklabels(pivot.index, rotation=45)
    ax1.set_ylabel("Event Count")
    
    for i in x:
        ax1.text(i, pivot[last_year].iloc[i], str(int(pivot[last_year].iloc[i])), ha='center', va='bottom')
        ax1.text(i, pivot[this_year].iloc[i], str(int(pivot[this_year].iloc[i])), ha='center', va='bottom')

    ax2 = ax1.twinx()
    bars = ax2.bar(x, pivot['difference'], alpha=0.3, color='gray', label='YoY Diff')
    for i, bar in enumerate(bars):
        height = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width() / 2, height, str(int(height)), ha='center', va='bottom')

    total_last_year = pivot[last_year].sum()
    total_this_year = pivot[this_year].sum()
    ax1.annotate(
        f"Total {last_year}: {int(total_last_year)}\nTotal {this_year}: {int(total_this_year)}",
        xy=(0.95, 0.95), xycoords='axes fraction',
        ha='right', va='top', fontsize=12,
        bbox=dict(facecolor='white', edgecolor='black', boxstyle='round,pad=0.5')
    )
    
    ax1.legend(loc='upper left')
    ax1.grid(True, axis='y', linestyle='--', alpha=0.5)
    ax2.set_ylabel("Year-over-Year Difference")
    ax2.axhline(0, color='black', linestyle='--', linewidth=0.5)
    
    min_val = min(pivot[last_year].min(), pivot[this_year].min(), pivot['difference'].min(), 0)
    max_val = max(pivot[last_year].max(), pivot[this_year].max(), pivot['difference'].max())
    ax1.set_ylim(min_val, max_val)
    ax2.set_ylim(min_val, max_val)
    
    plt.title(title)
    plt.tight_layout()
    
    if pdf_pages is not None:
        pdf_pages.savefig(fig)
    else:
        plt.savefig(output_path)
    plt.close(fig)

def save_yoy_comparison_chart_for_value(pivot_value, value_segment, output_path, pdf_pages=None):
    """
    Produce a year-over-year comparison chart for a specific Value segment.
    
    If pdf_pages is provided, the chart is added to the PDF.
    """
    df_seg = pivot_value[pivot_value['Value'] == value_segment].copy()
    if df_seg.empty:
        print(f"No data found for Value segment: {value_segment}")
        return

    df_seg = df_seg.sort_values('month_order')
    x = range(len(df_seg))
    fig, ax1 = plt.subplots(figsize=(12, 6))
    ax1.plot(x, df_seg[last_year], label=str(last_year), marker='o')
    ax1.plot(x, df_seg[this_year], label=str(this_year), marker='o')
    ax1.set_xticks(x)
    ax1.set_xticklabels(df_seg['month_name'], rotation=45)
    ax1.set_ylabel("Event Count")
    
    for i in x:
        ax1.text(i, df_seg[last_year].iloc[i], str(int(df_seg[last_year].iloc[i])), ha='center', va='bottom')
        ax1.text(i, df_seg[this_year].iloc[i], str(int(df_seg[this_year].iloc[i])), ha='center', va='bottom')
    
    ax2 = ax1.twinx()
    bars = ax2.bar(x, df_seg['difference'], alpha=0.3, color='gray', label='YoY Diff')
    for i, bar in enumerate(bars):
        height = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width() / 2, height, str(int(height)), ha='center', va='bottom')
    
    ax1.legend(loc='upper left')
    ax1.grid(True, axis='y', linestyle='--', alpha=0.5)
    ax2.set_ylabel("Year-over-Year Difference")
    ax2.axhline(0, color='black', linestyle='--', linewidth=0.5)
    
    min_val = min(df_seg[last_year].min(), df_seg[this_year].min(), df_seg['difference'].min(), 0)
    max_val = max(df_seg[last_year].max(), df_seg[this_year].max(), df_seg['difference'].max())
    ax1.set_ylim(min_val, max_val)
    ax2.set_ylim(min_val, max_val)
    
    total_last_year = df_seg[last_year].sum()
    total_this_year = df_seg[this_year].sum()
    ax1.annotate(
        f"Total {last_year}: {int(total_last_year)}\nTotal {this_year}: {int(total_this_year)}",
        xy=(0.95, 0.95), xycoords='axes fraction',
        ha='right', va='top', fontsize=12,
        bbox=dict(facecolor='white', edgecolor='black', boxstyle='round,pad=0.5')
    )
    
    plt.title(f"Year-over-Year Comparison by Month - {value_segment}")
    plt.tight_layout()
    
    if pdf_pages is not None:
        pdf_pages.savefig(fig)
    else:
        plt.savefig(output_path)
    plt.close(fig)

def save_day_diff_histogram(april_shift, month_name, output_path, pdf_pages=None):
    """Save a histogram of day differences for events in the analysis month.
    
    If pdf_pages is provided, the figure is added to the PDF.
    """
    fig = plt.figure(figsize=(10, 5))
    bins = range(-15, 16)
    counts, bins, patches = plt.hist(april_shift['day_diff'].dropna(), bins=bins, edgecolor='black', color='skyblue')
    for count, patch in zip(counts, patches):
        if count > 0:
            plt.text(patch.get_x() + patch.get_width() / 2, count, str(int(count)), ha='center', va='bottom', fontsize=9)
    plt.title(f"Event Date Shifts for {month_name} {this_year} (vs. {last_year})")
    plt.annotate(
        f"Positive = Event moved later in {month_name} {this_year} vs {month_name} {last_year}\n"
        f"Negative = Event moved earlier in {month_name} {this_year} vs. {month_name} {last_year}",
        xy=(0.98, 0.95), xycoords='axes fraction', ha='right', va='top', fontsize=9,
        bbox=dict(boxstyle="round,pad=0.4", fc="white", ec="gray", alpha=0.8)
    )
    plt.xlabel(f"Day Difference ({this_year} - {last_year})")
    plt.ylabel("Event Count")
    plt.grid(axis='y', linestyle='--', alpha=0.6)
    plt.tight_layout()
    
    if pdf_pages is not None:
        pdf_pages.savefig(fig)
    else:
        plt.savefig(output_path)
    plt.close(fig)
    return output_path

def save_month_shift_bar(april_shift, month_name, output_path, pdf_pages=None):
    """Save a bar chart of the month shift counts.
    
    If pdf_pages is provided, the figure is added to the PDF.
    """
    month_labels = {1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun',
                    7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec'}
    month_shift_counts = april_shift['month_last_year'].value_counts().sort_index()
    month_shift_counts.index = month_shift_counts.index.map(lambda x: month_labels.get(x, 'Unknown'))
    fig = plt.figure(figsize=(10, 5))
    bars = plt.bar(month_shift_counts.index, month_shift_counts.values, color='coral')
    for bar in bars:
        plt.text(bar.get_x() + bar.get_width() / 2, bar.get_height(), int(bar.get_height()), ha='center', va='bottom')
    plt.title(f"{month_name} {this_year} Events — {last_year} Month")
    plt.xlabel(f"{month_name} {last_year}")
    plt.ylabel("Event Count")
    plt.grid(axis='y', linestyle='--', alpha=0.6)
    plt.tight_layout()
    
    if pdf_pages is not None:
        pdf_pages.savefig(fig)
    else:
        plt.savefig(output_path)
    plt.close(fig)
    return output_path

# CREATE PNG USING POSITIONAL PARAMETER
def create_chart_png(event_output_path, ANALYSIS_MONTH_NAME, grouped_df, qa_summary, summary_last_year, summary_this_year, pivot_all, pivot_filtered, filtered_df, events_this_year, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered):

    with PdfPages(event_output_path / "charts.pdf") as pdf_pages:

        # Add match score histogram
        save_match_score_histogram(events_this_year, event_output_path / "match_score_hist.png", None)
        
        # Add monthly bar charts
        save_bar_chart(summary_last_year, last_year, event_output_path / f"chart_{last_year}.png", None, title_prefix="Monthly Event Trends for")
        save_bar_chart(summary_this_year, this_year, event_output_path / f"chart_{this_year}.png", None, title_prefix="Monthly Event Trends for")

        # Add Draft status charts
        # save_bar_chart(summary_last_year[summary_last_year['Status'].str.lower() == 'draft'], last_year, event_output_path / f"chart_{last_year}_draft_status.png", None, title_prefix="Monthly Draft Events for")

        # save_bar_chart(summary_this_year[summary_this_year['Status'].str.lower() == 'draft'], this_year, event_output_path / f"chart_{this_year}_draft_status.png", None, title_prefix="Monthly Draft Events for")

        # safe Draft filter for last_year
        mask_last_year = (
            summary_last_year['Status']
            .fillna('')           # replace NaN/None with ''
            .astype(str)          # cast everything to str
            .str.lower() == 'draft'
        )
        save_bar_chart(
            summary_last_year[mask_last_year],
            last_year,
            event_output_path / f"chart_{last_year}_draft_status.png",
            None,
            title_prefix="Monthly Draft Events for"
        )

        # safe Draft filter for this_year
        mask_this_year = (
            summary_this_year['Status']
            .fillna('')
            .astype(str)
            .str.lower() == 'draft'
        )
        save_bar_chart(
            summary_this_year[mask_this_year],
            this_year,
            event_output_path / f"chart_{this_year}_draft_status.png",
            None,
            title_prefix="Monthly Draft Events for"
        )
        
        # Add YoY charts (all and filtered)
        save_yoy_comparison_chart(pivot_all, "YoY Comparison (All)", event_output_path / "chart_yoy_all.png", None)
        save_yoy_comparison_chart(pivot_filtered, "YoY Comparison (Filtered)", event_output_path / "chart_yoy_filtered.png", None)
        
        # Add month shift charts
        save_day_diff_histogram(
            analysis_month_shift,
            ANALYSIS_MONTH_NAME,
            event_output_path / f"{ANALYSIS_MONTH_NAME.lower()}_{this_year}_shift_histogram.png",
            None
        )
        save_month_shift_bar(
            analysis_month_shift,
            ANALYSIS_MONTH_NAME,
            event_output_path / f"{ANALYSIS_MONTH_NAME.lower()}_{this_year}_shift_bar.png",
            None
        )
        
        # Add YoY charts for each unique value
        for val in pivot_value_filtered['Value'].unique():
            # If you want to specify a filename, you could construct it here:
            filename = f"chart_yoy_filtered_{str(val).replace(' ', '_').lower()}.png"
            out_path = os.path.join(event_output_path, filename)
            save_yoy_comparison_chart_for_value(pivot_value_filtered, val, out_path, None)

# CREATE PDF USING POSITIONAL PARAMETER
def create_chart_pdf(event_output_path, ANALYSIS_MONTH_NAME, grouped_df, qa_summary, summary_last_year, summary_this_year, pivot_all, pivot_filtered, filtered_df, events_this_year, timing_shift_data, analysis_month_shift, pivot_value_all, pivot_value_filtered):

    with PdfPages(event_output_path / "charts.pdf") as pdf_pages:

        # Add match score histogram
        save_match_score_histogram(events_this_year, None, pdf_pages)
        
        # Add monthly bar charts
        save_bar_chart(summary_last_year, last_year, None, pdf_pages, title_prefix="Monthly Event Trends for")
        save_bar_chart(summary_this_year, this_year, None, pdf_pages)
        
        # Add Draft status charts
        # save_bar_chart(summary_last_year[summary_last_year['Status'].str.lower() == 'draft'], last_year, None, pdf_pages, title_prefix="Monthly Draft Events for")

        # save_bar_chart(summary_this_year[summary_this_year['Status'].str.lower() == 'draft'], this_year, None, pdf_pages, title_prefix="Monthly Draft Events for")

        # safe Draft filter for last year
        mask_last_year = (
            summary_last_year['Status']
            .fillna('')           # replace NaN/None with ''
            .astype(str)          # cast everything to str
            .str.lower() == 'draft'
        )
        save_bar_chart(
            summary_last_year[mask_last_year],
            last_year,
            None, 
            pdf_pages,
            title_prefix="Monthly Draft Events for"
        )

        # safe Draft filter for this_year
        mask_this_year = (
            summary_this_year['Status']
            .fillna('')
            .astype(str)
            .str.lower() == 'draft'
        )
        save_bar_chart(
            summary_this_year[mask_this_year],
            this_year,
            None, 
            pdf_pages,
            title_prefix="Monthly Draft Events for"
        )
 
        # Add YoY charts (all and filtered)
        save_yoy_comparison_chart(pivot_all, "YoY Comparison (All)", None, pdf_pages)
        save_yoy_comparison_chart(pivot_filtered, "YoY Comparison (Filtered)", None, pdf_pages)
        
        # Add month shift charts
        save_day_diff_histogram(analysis_month_shift, ANALYSIS_MONTH_NAME, None, pdf_pages)
        save_month_shift_bar(analysis_month_shift, ANALYSIS_MONTH_NAME, None, pdf_pages)
        
        # Add YoY charts for each unique value
        for val in pivot_value_filtered['Value'].unique():
            # If you want to specify a filename, you could construct it here:
            # filename = f"chart_yoy_filtered_{str(val).replace(' ', '_').lower()}.pdf"
            save_yoy_comparison_chart_for_value(pivot_value_filtered, val, None, pdf_pages)

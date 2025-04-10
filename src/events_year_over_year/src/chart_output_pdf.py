import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.backends.backend_pdf import PdfPages

def save_match_score_histogram_pdf(events_2025, pdf_pages):
    """Add a histogram showing the distribution of match scores to the PDF."""
    fig = plt.figure(figsize=(10, 5))
    plt.hist(
        [
            events_2025['match_score_name_only'].dropna(),
            events_2025['match_score_name_and_site'].dropna(),
            events_2025['match_score_name_and_zip'].dropna()
        ],
        bins=20,
        edgecolor='black',
        label=['Name Only', 'Name + Website', 'Name + ZipCode']
    )
    plt.axvline(80, color='red', linestyle='--', label='Typical Match Threshold (80)')
    plt.axvline(90, color='green', linestyle='--', label='Strong Match Threshold (90)')
    plt.title("Distribution of Match Scores (2025 vs 2024)")
    plt.xlabel("Match Score")
    plt.ylabel("Event Count")
    plt.grid(True, axis='y', linestyle='--', alpha=0.5)
    plt.legend()
    plt.tight_layout()
    pdf_pages.savefig(fig)
    plt.close(fig)

def save_bar_chart_pdf(df_summary, year, pdf_pages, title_prefix="Monthly Event Trends for"):
    """Add a bar chart for the event counts per month to the PDF."""
    monthly_total = df_summary.groupby('month_name')['event_count'].sum()
    order = ["January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"]
    monthly_total = monthly_total.reindex(order).fillna(0)
    fig = plt.figure(figsize=(10, 5))
    bars = plt.bar(monthly_total.index, monthly_total.values)
    for bar in bars:
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width() / 2, height, int(height),
                 ha='center', va='bottom')
    plt.title(f"{title_prefix} {year}")
    plt.ylabel("Event Count" if "Trends" in title_prefix else "Draft Event Count")
    plt.xticks(rotation=45)
    plt.tight_layout()
    pdf_pages.savefig(fig)
    plt.close(fig)

def save_yoy_comparison_chart_pdf(pivot, title, pdf_pages):
    """Add a Year-over-Year comparison chart using a twin axis plot to the PDF."""
    fig, ax1 = plt.subplots(figsize=(12, 6))
    x = range(len(pivot))
    ax1.plot(x, pivot[2024], label='2024', marker='o')
    ax1.plot(x, pivot[2025], label='2025', marker='o')
    ax1.set_xticks(x)
    ax1.set_xticklabels(pivot.index, rotation=45)
    ax1.set_ylabel("Event Count")
    for i in x:
        ax1.text(i, pivot[2024].iloc[i], str(int(pivot[2024].iloc[i])),
                 ha='center', va='bottom')
        ax1.text(i, pivot[2025].iloc[i], str(int(pivot[2025].iloc[i])),
                 ha='center', va='bottom')
    ax2 = ax1.twinx()
    bars = ax2.bar(x, pivot['difference'], alpha=0.3, color='gray', label='YoY Diff')
    for i, bar in enumerate(bars):
        height = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width() / 2, height, str(int(height)),
                 ha='center', va='bottom')
    ax1.legend(loc='upper left')
    ax1.grid(True, axis='y', linestyle='--', alpha=0.5)
    ax2.set_ylabel("Year-over-Year Difference")
    ax2.axhline(0, color='black', linestyle='--', linewidth=0.5)
    min_val = min(pivot[2024].min(), pivot[2025].min(), pivot['difference'].min(), 0)
    max_val = max(pivot[2024].max(), pivot[2025].max(), pivot['difference'].max())
    ax1.set_ylim(min_val, max_val)
    ax2.set_ylim(min_val, max_val)
    plt.title(title)
    plt.tight_layout()
    pdf_pages.savefig(fig)
    plt.close(fig)

def save_day_diff_histogram_pdf(april_shift, month_name, pdf_pages):
    """Add a histogram of day differences for events in the analysis month to the PDF."""
    fig = plt.figure(figsize=(10, 5))
    bins = range(-15, 16)
    counts, bins, patches = plt.hist(april_shift['day_diff'].dropna(), bins=bins,
                                     edgecolor='black', color='skyblue')
    for count, patch in zip(counts, patches):
        if count > 0:
            plt.text(patch.get_x() + patch.get_width() / 2, count, str(int(count)),
                     ha='center', va='bottom', fontsize=9)
    plt.title(f"Event Date Shifts for {month_name} 2025 (vs. 2024)")
    plt.annotate(
        f"Positive = Event moved later in {month_name} 2025 vs {month_name} 2024\n"
        f"Negative = Event moved earlier in {month_name} 2025 vs. {month_name} 2024",
        xy=(0.98, 0.95), xycoords='axes fraction', ha='right', va='top', fontsize=9,
        bbox=dict(boxstyle="round,pad=0.4", fc="white", ec="gray", alpha=0.8)
    )
    plt.xlabel("Day Difference (2025 - 2024)")
    plt.ylabel("Event Count")
    plt.grid(axis='y', linestyle='--', alpha=0.6)
    plt.tight_layout()
    pdf_pages.savefig(fig)
    plt.close(fig)

def save_month_shift_bar_pdf(april_shift, month_name, pdf_pages):
    """Add a bar chart of the month shift counts to the PDF."""
    month_labels = {
        1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr',
        5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Aug',
        9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec'
    }
    month_shift_counts = april_shift['month_2024'].value_counts().sort_index()
    month_shift_counts.index = month_shift_counts.index.map(lambda x: month_labels.get(x, 'Unknown'))
    fig = plt.figure(figsize=(10, 5))
    bars = plt.bar(month_shift_counts.index, month_shift_counts.values, color='coral')
    for bar in bars:
        plt.text(bar.get_x() + bar.get_width() / 2, bar.get_height(), int(bar.get_height()),
                 ha='center', va='bottom')
    plt.title(f"{month_name} 2025 Events — Prior Year Month")
    plt.xlabel(f"{month_name} 2024")
    plt.ylabel("Event Count")
    plt.grid(axis='y', linestyle='--', alpha=0.6)
    plt.tight_layout()
    pdf_pages.savefig(fig)
    plt.close(fig)

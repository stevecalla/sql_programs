import pandas as pd
import matplotlib.pyplot as plt
from rapidfuzz import process, fuzz
import os
import calendar

# --- CONFIGURATION ---
input_file = "event_input/santioning_list_040723.xlsx"
output_file = "event_output/cleaned_grouped_event_data_with_summary.xlsx"
os.makedirs("event_output", exist_ok=True)

match_score_threshold = 80  # Adjustable threshold
# --- MONTH CONFIGURATION FOR EVENT TIMING---
ANALYSIS_MONTH = 4  # April (1 = January, ..., 12 = December)
month_name = calendar.month_name[ANALYSIS_MONTH]

# --- LOAD DATA ---
df = pd.read_excel(input_file)

# --- GROUP & CLEAN ---
grouped_df = (
    df.groupby('ApplicationID')
    .agg({
        'Name': 'first',
        'StartDate': 'first',
        'RaceDate': lambda x: ', '.join(sorted(x.dropna().astype(str).unique())),
        'Status': 'first',
        '2LetterCode': 'first',
        'ZipCode': 'first',
        'Value': 'first',
        'RaceDirectorUserID': 'first',
        'Website': 'first',
        'RegistrationWebsite': 'first',
        'Email': 'first',
    })
    .reset_index()
)

grouped_df['earliest_race_date'] = pd.to_datetime(
    df.groupby('ApplicationID')['RaceDate'].min().values
)
grouped_df['year'] = grouped_df['earliest_race_date'].dt.year
grouped_df['month'] = grouped_df['earliest_race_date'].dt.month
grouped_df['month_name'] = grouped_df['earliest_race_date'].dt.month_name()

# --- FLAG DUPLICATES ---
application_counts = df['ApplicationID'].value_counts()
grouped_df['possible_duplicate'] = grouped_df['ApplicationID'].isin(
    application_counts[application_counts > 1].index
)

# --- QA SUMMARY ---
qa_summary = pd.DataFrame({
    "statistic": [
        "total_rows_original_data",
        "total_rows_grouped_data",
        "number_of_possible_duplicates"
    ],
    "value": [
        len(df),
        len(grouped_df),
        grouped_df['possible_duplicate'].sum()
    ]
})

# --- STATUS SUMMARY ---
status_summary = (
    grouped_df.groupby(['year', 'month', 'month_name', 'Status'])
    .size()
    .reset_index(name='event_count')
)
summary_2024 = status_summary[status_summary['year'] == 2024]
summary_2025 = status_summary[status_summary['year'] == 2025]

# --- PIVOT FOR YOY ---
def create_yoy_pivot(df):
    monthly = (
        df.groupby(['year', 'month', 'month_name'])
        .size()
        .reset_index(name='event_count')
    )
    pivot = monthly.pivot(index='month_name', columns='year', values='event_count').fillna(0)
    pivot['difference'] = pivot[2025] - pivot[2024]
    pivot['month_order'] = pd.to_datetime(pivot.index.to_series(), format='%B').dt.month
    return pivot.sort_values('month_order')

pivot_all = create_yoy_pivot(grouped_df)
filtered_df = grouped_df[~grouped_df['Status'].str.lower().isin(['canceled', 'deleted'])]
pivot_filtered = create_yoy_pivot(filtered_df)

# --- FUZZY MATCHING 2025 TO 2024 ---
events_2024 = grouped_df[grouped_df['year'] == 2024].copy()
events_2025 = grouped_df[grouped_df['year'] == 2025].copy()
names_2024 = events_2024['Name'].tolist() # Now comparing 2025 events with 2024 events

match_cols = [
    'match_name_2024', 'match_score_name_only', 'match_score_name_and_site', 'match_score_name_and_zip', 'has_match',
    'application_id_2024', 'status_2024', 'earliest_race_date_2024', 'website_2024'
]
for col in match_cols:
    events_2025[col] = None

events_2025['has_match'] = False

for idx, row in events_2025.iterrows():
    name_2025 = row['Name']
    site_2025 = str(row.get('Website', '')).strip().lower()
    zip_2025 = str(row.get('ZipCode', '')).strip()

    # Perform fuzzy matching based on the Name only
    best_name_match = process.extractOne(name_2025, names_2024, scorer=fuzz.token_sort_ratio)
    
    if best_name_match:
        matched_name, name_score, _ = best_name_match
        matched_row = events_2024[events_2024['Name'] == matched_name].iloc[0]
        site_2024 = str(matched_row.get('Website', '')).strip().lower()
        zip_2024 = str(matched_row.get('ZipCode', '')).strip()

        # Calculate similarity scores for Name + Website match
        site_score = fuzz.token_sort_ratio(site_2025, site_2024) if site_2025 and site_2024 else 0
        zip_score = fuzz.token_sort_ratio(zip_2025, zip_2024) if zip_2025 and zip_2024 else 0

        # Calculate 50/50 weighting for Name + ZipCode match
        combined_zip_score = round((name_score * 0.5 + zip_score * 0.5), 2)

        # Calculate Name + Website match (for completeness and if needed)
        combined_site_score = round((name_score * 0.5 + site_score * 0.5), 2)

        # Populate the match scores
        events_2025.at[idx, 'match_name_2024'] = matched_name
        events_2025.at[idx, 'match_score_name_only'] = name_score
        events_2025.at[idx, 'match_score_name_and_site'] = combined_site_score
        events_2025.at[idx, 'match_score_name_and_zip'] = combined_zip_score

        # Populate the match scores in events_2025
        events_2025.at[idx, 'match_name_2024'] = matched_name
        events_2025.at[idx, 'match_score_name_only'] = name_score
        events_2025.at[idx, 'match_score_name_and_site'] = combined_site_score
        events_2025.at[idx, 'match_score_name_and_zip'] = combined_zip_score

        # Determine the match formula and populate the has_match field
        if combined_zip_score >= match_score_threshold:
            events_2025.at[idx, 'has_match'] = True
            events_2025.at[idx, 'match_formula_used'] = 'Name + ZipCode'  # Match based on Name + ZipCode

        # Populate 2024-related fields in events_2025 (always use 2024 data)
        events_2025.at[idx, 'application_id_2024'] = matched_row['ApplicationID']
        events_2025.at[idx, 'status_2024'] = matched_row['Status']
        events_2025.at[idx, 'earliest_race_date_2024'] = matched_row['earliest_race_date']
        events_2025.at[idx, 'website_2024'] = matched_row['Website']
        events_2025.at[idx, 'zip_code_2024'] = matched_row['ZipCode']
        events_2025.at[idx, 'state_code_2024'] = matched_row['2LetterCode']
        
    else:
        # If no match is found, set has_match to False and populate with 2025 values for 2024 fields
        events_2025.at[idx, 'has_match'] = False
        events_2025.at[idx, 'match_formula_used'] = 'No Match'

        # Always populate 2024-related fields in events_2025 with 2024 data (same as if matched)
        events_2025.at[idx, 'application_id_2024'] = row['ApplicationID']
        events_2025.at[idx, 'status_2024'] = row['Status']
        events_2025.at[idx, 'earliest_race_date_2024'] = row['earliest_race_date']
        events_2025.at[idx, 'website_2024'] = row['Website']
        events_2025.at[idx, 'zip_code_2024'] = row['ZipCode']
        events_2025.at[idx, 'state_code_2024'] = row['2LetterCode']

match_summary = (
    events_2025.groupby(['year', 'month', 'month_name'])
    .agg(
        total_events=('Name', 'count'),
        matched_events=('has_match', lambda x: x.sum()),
        unmatched_events=('has_match', lambda x: (~x).sum())
    )
    .sort_values(by=['year', 'month'])
    .reset_index()
)

# --- FUZZY MATCHING 2024 TO 2025 ---
names_2025 = events_2025['Name'].tolist()  # Comparing 2024 events with 2025 events

# Define match columns for events_2024
match_cols_2024 = [
    'match_name_2025', 'match_score_name_only', 'match_score_name_and_site', 'match_score_name_and_zip', 'has_match',
    'application_id_2025', 'status_2025', 'earliest_race_date_2025', 'website_2025'
]

# Initialize match columns in events_2024
for col in match_cols_2024:
    events_2024[col] = None

events_2024['has_match'] = False

# Loop through the events_2024 DataFrame
for idx, row in events_2024.iterrows():
    name_2024 = row['Name']
    site_2024 = str(row.get('Website', '')).strip().lower()
    zip_2024 = str(row.get('ZipCode', '')).strip()

    # Perform fuzzy matching based on Name only
    best_name_match = process.extractOne(name_2024, names_2025, scorer=fuzz.token_sort_ratio)
    
    if best_name_match:
        matched_name, name_score, _ = best_name_match
        matched_row = events_2025[events_2025['Name'] == matched_name].iloc[0]
        site_2025 = str(matched_row.get('Website', '')).strip().lower()
        zip_2025 = str(matched_row.get('ZipCode', '')).strip()

        # Calculate similarity scores for Name + Website match
        site_score = fuzz.token_sort_ratio(site_2024, site_2025) if site_2024 and site_2025 else 0
        zip_score = fuzz.token_sort_ratio(zip_2024, zip_2025) if zip_2024 and zip_2025 else 0

        # Calculate 50/50 weighting for Name + ZipCode match
        combined_zip_score = round((name_score * 0.5 + zip_score * 0.5), 2)

        # Calculate Name + Website match (for completeness and if needed)
        combined_site_score = round((name_score * 0.5 + site_score * 0.5), 2)

        # Populate the match scores
        events_2024.at[idx, 'match_name_2025'] = matched_name
        events_2024.at[idx, 'match_score_name_only'] = name_score
        events_2024.at[idx, 'match_score_name_and_site'] = combined_site_score
        events_2024.at[idx, 'match_score_name_and_zip'] = combined_zip_score

        # Determine the match formula and populate the has_match field
        if combined_zip_score >= match_score_threshold:
            events_2024.at[idx, 'has_match'] = True
            events_2024.at[idx, 'match_formula_used'] = 'Name + ZipCode'  # Match based on Name + ZipCode

        # Populate 2025-related fields in events_2024 (always use 2025 data)
        events_2024.at[idx, 'application_id_2025'] = matched_row['ApplicationID']
        events_2024.at[idx, 'status_2025'] = matched_row['Status']
        events_2024.at[idx, 'earliest_race_date_2025'] = matched_row['earliest_race_date']
        events_2024.at[idx, 'website_2025'] = matched_row['Website']
        events_2024.at[idx, 'zip_code_2025'] = matched_row['ZipCode']
        events_2024.at[idx, 'state_code_2025'] = matched_row['2LetterCode']
        
    else:
        # If no match is found, set has_match to False and populate with 2024 values for 2025 fields
        events_2024.at[idx, 'has_match'] = False
        events_2024.at[idx, 'match_formula_used'] = 'No Match'

        # Always populate 2025-related fields in events_2024 with 2025 data (same as if matched)
        events_2024.at[idx, 'application_id_2025'] = row['ApplicationID']
        events_2024.at[idx, 'status_2025'] = row['Status']
        events_2024.at[idx, 'earliest_race_date_2025'] = row['earliest_race_date']
        events_2024.at[idx, 'website_2025'] = row['Website']
        events_2024.at[idx, 'zip_code_2025'] = row['ZipCode']
        events_2024.at[idx, 'state_code_2025'] = row['2LetterCode']

# Generate match summary for 2024 (comparing 2024 events to 2025)
match_summary_2024 = (
    events_2024.groupby(['year', 'month', 'month_name'])
    .agg(
        total_events=('Name', 'count'),
        matched_events=('has_match', lambda x: x.sum()),
        unmatched_events=('has_match', lambda x: (~x).sum())
    )
    .sort_values(by=['year', 'month'])
    .reset_index()
)

# --- DATE SHIFT ANALYSIS ---
timing_shift_data = events_2025[events_2025['has_match'] == True].copy()

# Ensure the relevant dates are datetime
timing_shift_data['earliest_race_date'] = pd.to_datetime(timing_shift_data['earliest_race_date'], errors='coerce')
timing_shift_data['earliest_race_date_2024'] = pd.to_datetime(timing_shift_data['earliest_race_date_2024'], errors='coerce')

# Drop any rows with missing dates
timing_shift_data = timing_shift_data.dropna(subset=['earliest_race_date', 'earliest_race_date_2024'])

# Calculate date parts and shift
timing_shift_data['day_2025'] = timing_shift_data['earliest_race_date'].dt.day
timing_shift_data['year_2025'] = timing_shift_data['earliest_race_date'].dt.year
timing_shift_data['month_2025'] = timing_shift_data['earliest_race_date'].dt.month
timing_shift_data['day_2024'] = timing_shift_data['earliest_race_date_2024'].dt.day
timing_shift_data['weekday_2025'] = timing_shift_data['earliest_race_date'].dt.strftime('%A')
timing_shift_data['weekday_2024'] = timing_shift_data['earliest_race_date_2024'].dt.strftime('%A')
timing_shift_data['day_diff'] = timing_shift_data['day_2025'] - timing_shift_data['day_2024']

# Output DataFrame for Excel
timing_shift_output = timing_shift_data[[
    'Name', 'ApplicationID', 'match_name_2024',
    'earliest_race_date', 'year_2025', 'month_2025', 'weekday_2025', 'day_2025',
    'earliest_race_date_2024', 'weekday_2024', 'day_2024',
    'day_diff', 'match_score_name_only', 'match_formula_used'
]]

# --- CHART EXPORTS ---
chart_2024_path = "event_output/chart_2024.png"
chart_2025_path = "event_output/chart_2025.png"
chart_2024_path_draft_status = "event_output/chart_2024_draft_status.png"
chart_2025_path_draft_status = "event_output/chart_2025_draft_status.png"
chart_yoy_all_path = "event_output/chart_yoy_all.png"
chart_yoy_filtered_path = "event_output/chart_yoy_filtered.png"
match_score_hist_path = "event_output/match_score_hist.png"

# Save histogram of match scores
plt.figure(figsize=(10, 5))
plt.hist(
    [
        events_2025['match_score_name_only'].dropna(),
        events_2025['match_score_name_and_site'].dropna(),
        events_2025['match_score_name_and_zip'].dropna()
    ],
    bins=20,
    edgecolor='black',
    color=['skyblue', 'orange', 'lightgreen'],
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
plt.savefig(match_score_hist_path)
plt.close()

# Bar chart for 2024 and 2025
for df_summary, year, path in [
    (summary_2024, 2024, chart_2024_path),
    (summary_2025, 2025, chart_2025_path)
]:
    monthly_total = df_summary.groupby('month_name')['event_count'].sum()
    order = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    monthly_total = monthly_total.reindex(order).fillna(0)
    plt.figure(figsize=(10, 5))
    bars = plt.bar(monthly_total.index, monthly_total.values, color='cornflowerblue')
    for bar in bars:
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width() / 2, height, int(height), ha='center', va='bottom')
    plt.title(f"Monthly Event Trends for {year}")
    plt.ylabel("Event Count")
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(path)
    plt.close()

# --- DRAFT STATUS CHARTS FOR 2024 & 2025 ---
for df_summary, year, path in [
    (summary_2024[summary_2024['Status'].str.lower() == 'draft'], 2024, chart_2024_path_draft_status),
    (summary_2025[summary_2025['Status'].str.lower() == 'draft'], 2025, chart_2025_path_draft_status)
]:
    monthly_draft = df_summary.groupby('month_name')['event_count'].sum()
    order = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    monthly_draft = monthly_draft.reindex(order).fillna(0)
    plt.figure(figsize=(10, 5))
    bars = plt.bar(monthly_draft.index, monthly_draft.values, color='cornflowerblue')
    for bar in bars:
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width() / 2, height, int(height), ha='center', va='bottom')
    plt.title(f"Monthly Draft Events for {year}")
    plt.ylabel("Draft Event Count")
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(path)
    plt.close()

# YoY chart
def save_yoy_comparison_chart(pivot, title, output_path):
    fig, ax1 = plt.subplots(figsize=(12, 6))
    x = range(len(pivot))
    ax1.plot(x, pivot[2024], label='2024', marker='o', color='blue')
    ax1.plot(x, pivot[2025], label='2025', marker='o', color='orange')
    ax1.set_xticks(x)
    ax1.set_xticklabels(pivot.index, rotation=45)
    ax1.set_ylabel("Event Count")
    for i in x:
        ax1.text(i, pivot[2024].iloc[i], str(int(pivot[2024].iloc[i])), ha='center', va='bottom')
        ax1.text(i, pivot[2025].iloc[i], str(int(pivot[2025].iloc[i])), ha='center', va='bottom')
    ax2 = ax1.twinx()
    bars = ax2.bar(x, pivot['difference'], alpha=0.3, color='gray', label='YoY Diff')
    for i, bar in enumerate(bars):
        height = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width() / 2, height, str(int(height)), ha='center', va='bottom')
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
    plt.savefig(output_path)
    plt.close()

save_yoy_comparison_chart(pivot_all, "YoY Comparison (All)", chart_yoy_all_path)
save_yoy_comparison_chart(pivot_filtered, "YoY Comparison (Filtered)", chart_yoy_filtered_path)

# Filter for April 2025
april_2025_shift = timing_shift_data[timing_shift_data['month_2025'] == ANALYSIS_MONTH].copy()

# Ensure earliest_race_date_2024 is datetime
april_2025_shift['month_2024'] = pd.to_datetime(april_2025_shift['earliest_race_date_2024'], errors='coerce').dt.month

# Histogram of day differences
plt.figure(figsize=(10, 5))
plt.hist(april_2025_shift['day_diff'].dropna(), bins=range(-15, 16), edgecolor='black', color='skyblue')
bins = range(-15, 16)

# 💡 Capture counts, bins, and patches from plt.hist()
counts, bins, patches = plt.hist(
    april_2025_shift['day_diff'].dropna(),
    bins=bins,
    edgecolor='black',
    color='skyblue'
)

# Add value labels to each bar
for count, patch in zip(counts, patches):
    if count > 0:
        plt.text(
            x=patch.get_x() + patch.get_width() / 2,
            y=count,
            s=str(int(count)),
            ha='center',
            va='bottom',
            fontsize=9
        )

plt.title(f"Event Date Shifts for {month_name} 2025 (vs. 2024)")
# Add explanation for positive/negative shifts
plt.annotate(
    f"Positive = Event moved **later** in {month_name} 2025 vs {month_name} 2024\n"
    f"Negative = Event moved **earlier** in {month_name} 2025 vs. {month_name} 2024",
    xy=(0.98, 0.95),
    xycoords='axes fraction',
    ha='right',
    va='top',
    fontsize=9,
    bbox=dict(boxstyle="round,pad=0.4", fc="white", ec="gray", alpha=0.8)
)
plt.xlabel("Day Difference (2025 - 2024)")
plt.ylabel("Event Count")
plt.grid(axis='y', linestyle='--', alpha=0.6)
plt.tight_layout()
histogram_path = f"event_output/{month_name.lower()}_2025_shift_histogram.png"
histogram_path = f"event_output/{month_name.lower()}_2025_shift_histogram.png"
plt.savefig(histogram_path)
plt.close()

# Month shift summary
month_shift_counts = april_2025_shift['month_2024'].value_counts().sort_index()
month_labels = {
    1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun',
    7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec'
}
month_shift_counts.index = month_shift_counts.index.map(lambda x: month_labels.get(x, 'Unknown'))

plt.figure(figsize=(10, 5))
bars = plt.bar(month_shift_counts.index, month_shift_counts.values, color='coral')
for bar in bars:
    plt.text(bar.get_x() + bar.get_width() / 2, bar.get_height(), int(bar.get_height()), ha='center', va='bottom')
plt.title(f"{month_name} 2025 Events — Prior Year Month")
plt.xlabel(f"{month_name} 2024")
plt.ylabel("Event Count")
plt.grid(axis='y', linestyle='--', alpha=0.6)
plt.tight_layout()
# month_shift_path = "event_output/april_2025_month_shift_bar.png"
month_shift_path = f"event_output/{month_name.lower()}_2025_month_shift_bar.png"
plt.savefig(month_shift_path)
plt.close()

# Events that shifted into April 2025 from a different month in 2024
shifted_into_month = april_2025_shift[april_2025_shift['month_2024'] != ANALYSIS_MONTH].copy()

# Add month number and name for 2024
shifted_into_month['year_2024'] = shifted_into_month['earliest_race_date_2024'].dt.year
shifted_into_month['month_2024'] = shifted_into_month['earliest_race_date_2024'].dt.month
shifted_into_month['month_name_2024'] = shifted_into_month['earliest_race_date_2024'].dt.month_name()

# Add month name for 2025 (for readability)
shifted_into_month['month_name_2025'] = shifted_into_month['earliest_race_date'].dt.month_name()

# Final table of shifted events into April
shifted_into_month_output = shifted_into_month[[
    'Name', 'ApplicationID',
    'earliest_race_date', 'month_2025', 'month_name_2025',
    'earliest_race_date_2024', 'month_2024', 'month_name_2024',
    'day_diff', 'weekday_2025', 'weekday_2024',
    'match_score_name_only', 'match_formula_used'
]].rename(columns={
    'earliest_race_date': 'date_2025',
    'earliest_race_date_2024': 'date_2024'
})

# --- EXPORT TO EXCEL ---
draft_2024_events = grouped_df[(grouped_df['year'] == 2024) & (grouped_df['Status'].str.lower() == 'draft')]

# --- EVENTS IN 2024 WITH NO MATCH IN 2025 --- 
unmatched_2024 = events_2024[~events_2024['Name'].isin(events_2025[events_2025['has_match'] == True]['match_name_2024'])]

with pd.ExcelWriter(output_file, engine='xlsxwriter') as writer:
    df.to_excel(writer, sheet_name='original_data', index=False)
    grouped_df.to_excel(writer, sheet_name='grouped_data', index=False)
    qa_summary.to_excel(writer, sheet_name='qa_summary', index=False)
    match_summary.to_excel(writer, sheet_name='2025_match_summary', index=False)
    match_summary_2024.to_excel(writer, sheet_name='2024_match_summary', index=False)  # <-- Added this line
    events_2025.to_excel(writer, sheet_name='events_2025_matches', index=False)
    events_2024.to_excel(writer, sheet_name='events_2024_matches', index=False)  # <-- Added this line
    draft_2024_events.to_excel(writer, sheet_name='2024_draft_events', index=False)
    timing_shift_output.to_excel(writer, sheet_name='timing_shift_analysis', index=False)
    shifted_into_month_output.to_excel(writer, sheet_name=f'shifted_into_{month_name.lower()}', index=False)
    unmatched_2024.to_excel(writer, sheet_name='2024_unmatched_events', index=False)

    workbook = writer.book

    center_format = workbook.add_format({'align': 'center', 'valign': 'vcenter'})
    for sheet_name, data in {
        'original_data': df,
        'grouped_data': grouped_df,
        'qa_summary': qa_summary,
        '2025_match_summary': match_summary,
        'events_2025_matches': events_2025,
        '2024_draft_events': draft_2024_events,  
        'timing_shift_analysis': timing_shift_output,
        f'shifted_into_{month_name.lower()}': shifted_into_month_output
        
    }.items():
        worksheet = writer.sheets[sheet_name]
        for i, col in enumerate(data.columns):
            if col.lower() not in ['website', 'registrationwebsite', 'website_2024']:
                max_len = max(data[col].astype(str).map(len).max(), len(str(col))) + 2
                worksheet.set_column(i, i, max_len, center_format)
            else:
                worksheet.set_column(i, i, None, center_format)

# print(f"File saved to {output_file}")

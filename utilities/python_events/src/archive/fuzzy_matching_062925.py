import pandas as pd
from rapidfuzz import fuzz

# --- Threshold constants ---
ALL_CANDIDATES_THRESHOLD    =   90   # For all candidates (highest confidence required)
CURRENT_MONTH_THRESHOLD     =   80   # For candidates in the same month
ADJACENT_MONTH_THRESHOLD    =   80   # For candidates in adjacent months
FALLBACK_THRESHOLD          =   80   # For fallback selection from entire dataset

# Dynamically set the years for YOY analysis
this_year = datetime.now().year
last_year = this_year - 1

def fuzzy_match_events_bidirectional(grouped_df):
    """
    Perform fuzzy matching of 2024 events against 2025 events using the following logic:
      - First, apply manual matches from a provided list of ApplicationID pairs (2025 <-> 2024). These are assigned directly and excluded from fuzzy matching.
      - Consider all 2025 candidates; if a candidate’s combined (Zip+Name) score is above 90, retain that match.
      - Else, look at candidates in the current month; if the best match has a combined score above 80, retain that.
      - Else, look at candidates in adjacent months; if the best match’s score is above 80, retain that.
      - Else, from the entire dataset, select the best candidate with a combined score above 80.

    Combined score is calculated as the average of the fuzzy name score and zipcode score.
    After a match is determined, the function also computes the site similarity and combined (Name+Site) score.

    The match result columns are stored in the 2024 and 2025 events, ensuring mutual one-to-one assignment.
    """

    def compute_combined_score(name_a, name_b, zip_a, zip_b):
        name_score = fuzz.token_sort_ratio(name_a, name_b)
        zip_score = fuzz.token_sort_ratio(zip_a, zip_b) if zip_a and zip_b else 0
        return round((name_score * 0.5 + zip_score * 0.5), 2), name_score, zip_score

    def compute_site_score(site_a, site_b):
        return fuzz.token_sort_ratio(site_a.lower().strip(), site_b.lower().strip()) if site_a and site_b else 0

    # --- MANUAL MATCHES ---
    # List of tuples: (ApplicationID_2025, ApplicationID_2024)
    # These will be matched directly and excluded from fuzzy logic.
    manual_matches = [
        # Example: ('310617', '309039'),    # ('2025_ID', '2024_ID')
        ('310617-Adult Race', '309039-Adult Race') # 2025 USA Triathlon Sprint and Olympic Distance National Championships

        # Add more pairs as needed
    ]

    # Split original dataset into 2024 and 2025 subsets
    events_2024 = grouped_df[grouped_df['year'] == 2024].copy()
    events_2025 = grouped_df[grouped_df['year'] == 2025].copy()

    # Initialize match columns
    events_2024['match_idx_2025'] = None
    events_2025['match_idx_2024'] = None
    events_2024['match_formula_used'] = ""
    events_2025['match_formula_used'] = ""
    events_2024['match_score_name_only'] = None
    events_2025['match_score_name_only'] = None
    events_2024['match_score_name_and_zip'] = None
    events_2025['match_score_name_and_zip'] = None
    events_2024['match_score_name_and_site'] = None
    events_2025['match_score_name_and_site'] = None
    events_2024['match_name_2025'] = None
    events_2025['match_name_2024'] = None

    pairs = []  # Store potential matches and associated metadata

    # --- FIRST: ASSIGN MANUAL MATCHES ---
    # We match by ApplicationID (must be string for comparison).
    matched_2025 = set()
    matched_2024 = set()
    for aid_2025, aid_2024 in manual_matches:
        idx_2025 = events_2025.index[events_2025['ApplicationID'].astype(str) == str(aid_2025)]
        idx_2024 = events_2024.index[events_2024['ApplicationID'].astype(str) == str(aid_2024)]
        if len(idx_2025) and len(idx_2024):
            i2025 = idx_2025[0]
            i2024 = idx_2024[0]

            # Set matches for both sides
            events_2025.at[i2025, 'match_idx_2024'] = i2024
            events_2025.at[i2025, 'match_formula_used'] = 'Manual Match'
            events_2025.at[i2025, 'match_name_2024'] = events_2024.at[i2024, 'Name']

            events_2024.at[i2024, 'match_idx_2025'] = i2025
            events_2024.at[i2024, 'match_formula_used'] = 'Manual Match'
            events_2024.at[i2024, 'match_name_2025'] = events_2025.at[i2025, 'Name']

            matched_2025.add(i2025)
            matched_2024.add(i2024)

    # --- Build all potential pairs between 2025 and 2024 (excluding already-matched manual pairs) ---
    for i2025, row2025 in events_2025.drop(index=matched_2025, errors='ignore').iterrows():
        name_2025 = row2025['Name']
        zip_2025 = str(row2025.get('ZipCode', '')).strip()
        site_2025 = str(row2025.get('Website', '')).strip()
        month_2025 = row2025['month']

        for i2024, row2024 in events_2024.drop(index=matched_2024, errors='ignore').iterrows():
            name_2024 = row2024['Name']
            zip_2024 = str(row2024.get('ZipCode', '')).strip()
            site_2024 = str(row2024.get('Website', '')).strip()
            month_2024 = row2024['month']

            combined_score, name_score, zip_score = compute_combined_score(name_2025, name_2024, zip_2025, zip_2024)
            site_score = compute_site_score(site_2025, site_2024)
            combined_site_score = round((name_score * 0.5 + site_score * 0.5), 2)

            # --- STEP 1: Match on All Candidates ---
            formula = "All Candidates"
            threshold = ALL_CANDIDATES_THRESHOLD

            # --- STEP 2: Match in the Same Month ---
            if month_2025 == month_2024:
                formula = "Same Month"
                threshold = CURRENT_MONTH_THRESHOLD

            # --- STEP 3: Match in Adjacent Months ---
            elif abs(month_2025 - month_2024) == 1:
                formula = "Adjacent Month"
                threshold = ADJACENT_MONTH_THRESHOLD

            if combined_score >= threshold:
                pairs.append((i2025, i2024, combined_score, name_score, combined_site_score, formula))

    # Sort by best score first
    pairs = sorted(pairs, key=lambda x: -x[2])

    # --- Assign the best one-to-one matches (excluding already-matched manual pairs) ---
    for i2025, i2024, combined_score, name_score, combined_site_score, formula in pairs:
        if i2025 not in matched_2025 and i2024 not in matched_2024:
            events_2025.at[i2025, 'match_idx_2024'] = i2024
            events_2025.at[i2025, 'match_formula_used'] = formula
            events_2025.at[i2025, 'match_score_name_only'] = name_score
            events_2025.at[i2025, 'match_score_name_and_zip'] = combined_score
            events_2025.at[i2025, 'match_score_name_and_site'] = combined_site_score
            events_2025.at[i2025, 'match_name_2024'] = events_2024.at[i2024, 'Name']

            events_2024.at[i2024, 'match_idx_2025'] = i2025
            events_2024.at[i2024, 'match_formula_used'] = formula
            events_2024.at[i2024, 'match_score_name_only'] = name_score
            events_2024.at[i2024, 'match_score_name_and_zip'] = combined_score
            events_2024.at[i2024, 'match_score_name_and_site'] = combined_site_score
            events_2024.at[i2024, 'match_name_2025'] = events_2025.at[i2025, 'Name']

            matched_2025.add(i2025)
            matched_2024.add(i2024)

    # --- Annotate matches ---
    events_2024['has_match'] = events_2024['match_idx_2025'].notnull()
    events_2025['has_match'] = events_2025['match_idx_2024'].notnull()

    # --- Enrich matched data with key fields ---
    for i2025 in events_2025.index:
        i2024 = events_2025.at[i2025, 'match_idx_2024']
        if pd.notnull(i2024):
            row = events_2024.loc[i2024]
            events_2025.at[i2025, 'application_id_2024'] = row['ApplicationID']
            events_2025.at[i2025, 'status_2024'] = row['Status']
            events_2025.at[i2025, 'earliest_start_date_2024'] = row['StartDate']
            events_2025.at[i2025, 'website_2024'] = row['Website']
            events_2025.at[i2025, 'zip_code_2024'] = row['ZipCode']
            events_2025.at[i2025, 'state_code_2024'] = row['2LetterCode']

    for i2024 in events_2024.index:
        i2025 = events_2024.at[i2024, 'match_idx_2025']
        if pd.notnull(i2025):
            row = events_2025.loc[i2025]
            events_2024.at[i2024, 'application_id_2025'] = row['ApplicationID']
            events_2024.at[i2024, 'status_2025'] = row['Status']
            events_2024.at[i2024, 'earliest_start_date_2025'] = row['StartDate']
            events_2024.at[i2024, 'website_2025'] = row['Website']
            events_2024.at[i2024, 'zip_code_2025'] = row['ZipCode']
            events_2024.at[i2024, 'state_code_2025'] = row['2LetterCode']

    # --- Assign common_date, common_year, common_month ---
    # For matched events: both sides get the 2025 StartDate as common_date
    for i2025 in events_2025.index:
        i2024 = events_2025.at[i2025, 'match_idx_2024']
        if pd.notnull(i2024):
            # If match, use 2025 StartDate for both
            common_date = events_2025.at[i2025, 'StartDate']
            events_2025.at[i2025, 'common_date'] = common_date
            events_2024.at[i2024, 'common_date'] = common_date
            # Common year/month
            events_2025.at[i2025, 'common_year'] = 2025
            events_2024.at[i2024, 'common_year'] = 2025
            events_2025.at[i2025, 'common_month'] = events_2025.at[i2025, 'month']
            events_2024.at[i2024, 'common_month'] = events_2025.at[i2025, 'month']
        else:
            # No match: use this row's own date/year/month
            events_2025.at[i2025, 'common_date'] = events_2025.at[i2025, 'StartDate']
            events_2025.at[i2025, 'common_year'] = events_2025.at[i2025, 'year']
            events_2025.at[i2025, 'common_month'] = events_2025.at[i2025, 'month']

    for i2024 in events_2024.index:
        # Already set if matched above, otherwise set here
        if pd.isnull(events_2024.at[i2024, 'common_date']):
            events_2024.at[i2024, 'common_date'] = events_2024.at[i2024, 'StartDate']
            events_2024.at[i2024, 'common_year'] = events_2024.at[i2024, 'year']
            events_2024.at[i2024, 'common_month'] = events_2024.at[i2024, 'month']

    """
    common_status field logic:
    - For matched events (across 2024/2025), if EITHER year's status is 'cancelled', 'declined', or 'deleted' (case-insensitive),
    then common_status is set to 'cancelled/declined/deleted' for BOTH years' event records.
    - Otherwise, common_status is set to the 2025 status if present, else the 2024 status.
    - For unmatched events, common_status is just the event's own status.
    This ensures that for every event (matched or not), there is a single field for status-based filtering and summary reporting
    that is consistent across years and not split by mismatches in status.
    """
    cancel_statuses = ['cancelled', 'declined', 'deleted']

    for i2025 in events_2025.index:
        i2024 = events_2025.at[i2025, 'match_idx_2024']
        status_2025 = events_2025.at[i2025, 'Status']
        status_2024 = events_2024.at[i2024, 'Status'] if pd.notnull(i2024) else None

        # Assign both statuses for reference
        events_2025.at[i2025, 'status_2024'] = status_2024
        events_2025.at[i2025, 'status_2025'] = status_2025
        if pd.notnull(i2024):
            events_2024.at[i2024, 'status_2024'] = status_2024
            events_2024.at[i2024, 'status_2025'] = status_2025

        # Set common_status if either is cancelled/declined/deleted
        status_2025_low = status_2025.lower() if status_2025 else ''
        status_2024_low = status_2024.lower() if status_2024 else ''
        if any(s in cancel_statuses for s in [status_2025_low, status_2024_low]):
            common_status = 'cancelled/declined/deleted'
        else:
            # Prefer 2025 status if present, else 2024
            common_status = status_2025 if status_2025 else status_2024

        events_2025.at[i2025, 'common_status'] = common_status
        if pd.notnull(i2024):
            events_2024.at[i2024, 'common_status'] = common_status

    # Fill unmatched events with their own status
    for i2024 in events_2024.index:
        if pd.isnull(events_2024.at[i2024, 'common_status']):
            status_2024 = events_2024.at[i2024, 'Status']
            events_2024.at[i2024, 'common_status'] = status_2024
            events_2024.at[i2024, 'status_2024'] = status_2024
            events_2024.at[i2024, 'status_2025'] = None

    for i2025 in events_2025.index:
        if pd.isnull(events_2025.at[i2025, 'common_status']):
            status_2025 = events_2025.at[i2025, 'Status']
            events_2025.at[i2025, 'common_status'] = status_2025
            events_2025.at[i2025, 'status_2025'] = status_2025
            events_2025.at[i2025, 'status_2024'] = None

    # --- Generate summaries by year/month ---
    match_summary_2025 = (
        events_2025.groupby(['year', 'month', 'month_name'])
        .agg(
            total_events=('Name', 'count'),
            matched_events=('has_match', lambda x: x.sum()),
            unmatched_events=('has_match', lambda x: (~x).sum())
        )
        .sort_values(by=['year', 'month'])
        .reset_index()
    )

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

    return events_2025, events_2024, match_summary_2025, match_summary_2024

import pandas as pd
from rapidfuzz import fuzz
from datetime import datetime, date

# --- Threshold constants ---
ALL_CANDIDATES_THRESHOLD    =   90   # For all candidates (highest confidence required)
CURRENT_MONTH_THRESHOLD     =   80   # For candidates in the same month
ADJACENT_MONTH_THRESHOLD    =   80   # For candidates in adjacent months
FALLBACK_THRESHOLD          =   80   # For fallback selection from entire dataset

# Dynamically set the years for YOY analysis
# TODO: 2024 vs 2025
# this_year = datetime.now().year
# last_year = this_year - 1
# TODO: 2025 vs 2026
# this_year = 2026
# last_year = 2025

# Dynamically set the years for YOY analysis
today = date.today()
cutoff = date(today.year, 10, 15)  # Oct 15 of the current year

if today < cutoff:
    # 1/1 through 10/14  → use CURRENT and PRIOR year
    this_year = today.year
    last_year = today.year - 1
else:
    # 10/15 through 12/31 → use NEXT and CURRENT year
    this_year = today.year + 1
    last_year = today.year

def get_match_score_bin(score):
    # Ensure score is a float or None
    if pd.isna(score):
        return None
    try:
        score = float(score)
    except Exception:
        return None
    if score >= 90: return "90-100"
    if score >= 80: return "80-90"
    if score >= 70: return "70-80"
    if score < 70:  return "<70"

def fuzzy_match_events_bidirectional(grouped_df):
    """
    Perform fuzzy matching of last_year events against this_year events using the following logic:
      - First, apply manual matches from a provided list of ApplicationID pairs (this_year <-> last_year). These are assigned directly and excluded from fuzzy matching.
      - Consider all this_year candidates; if a candidate’s combined (Zip+Name) score is above 90, retain that match.
      - Else, look at candidates in the current month; if the best match has a combined score above 80, retain that.
      - Else, look at candidates in adjacent months; if the best match’s score is above 80, retain that.
      - Else, from the entire dataset, select the best candidate with a combined score above 80.

    Combined score is calculated as the average of the fuzzy name score and zipcode score.
    After a match is determined, the function also computes the site similarity and combined (Name+Site) score.

    The match result columns are stored in the last_year and this_year events, ensuring mutual one-to-one assignment.
    """

    def compute_combined_score(name_a, name_b, zip_a, zip_b):
        name_score = fuzz.token_sort_ratio(name_a, name_b)
        zip_score = fuzz.token_sort_ratio(zip_a, zip_b) if zip_a and zip_b else 0
        return round((name_score * 0.5 + zip_score * 0.5), 2), name_score, zip_score

    def compute_site_score(site_a, site_b):
        return fuzz.token_sort_ratio(site_a.lower().strip(), site_b.lower().strip()) if site_a and site_b else 0

    # --- MANUAL MATCHES ---
    # List of tuples: (ApplicationID_this_year, ApplicationID_last_year)
    # These will be matched directly and excluded from fuzzy logic.
    manual_matches = [
        # Example: ('310617', '309039'),    
        # ('this_year_ID', 'last_year_ID'),
        ('310617-Adult Race', '309039-Adult Race'), # this_year USA Triathlon Sprint and Olympic Distance National Championships
        ('310759-Adult Race', '309505-Adult Race'), # this_year = Race in the Clouds - Alma Dirt Festival, last_year = Race in the Clouds - Off Road Festival
        ('310539-Adult Race', '309204-Adult Race'), # this year = Gold Nugget Triathlon, last year = Gold Nugget Triathlon  May 13th-19th 2024
        ('311461-Adult Race', '309459-Adult Race'), # this year = The Boston Triathlon, last year = Columbia Threadneedle Investments Boston Triathlon

        # ADDED on 7/15/2025 FROM DARREN'S LIST FOR SEPT TO NOV 2025
        ('310704-Adult Race','309839-Adult Race'), # Ironman Waco 70.3
        ('310506-Adult Race','309241-Adult Race'), # Visit Panama City Beach IRONMAN Florida
        ('310797-Adult Race','309702-Adult Race'), # 2024 Pacific Coast Triathlon at Crystal Cove
        ('310813-Adult Race','310310-Adult Race'), # Mack Cycle TriKB Triathlon #2 & Mack Cycle TriKB Triathlon #1
        ('310821-Adult Race','310312-Adult Race'), # Mack Cycle TriKB Triathlon #3 & Mack Cycle TriKB Triathlon #2
        ('310687-Adult Race','309354-Adult Race'), # Pilgrimman & The Outsider (Pilgrimman)
        ('311598-Adult Race','310252-Adult Race'), # Bearathlon 2024 & Bearathlon 2025
        ('310843-Adult Race','309462-Adult Race'), # US Performance Center Draft Legal Triathlon Festival & US Performance Center Draft Legal Triathlon Festival
        ('310972-Adult Race','309851-Adult Race'), # Wonders Sprint Triathlon & USA TRIATHLON NEW JERSEY STATE CHAMPIONSHIPS / WONDERS TRIATHLON
        ('310973-Youth Race','310133-Youth Race'), # Wonders Kids Triathlon - September & WONDERS KIDS TRIATHLON - NEW JERSEY STATE CHAMPIONSHIPS
        ('311005-Adult Race','311156-Adult Race'), # World Triathlon Powerman Long Distance Duathlon Championships - Zofingen Switzerland & World Triathlon Powerman Long Distance Duathlon Championships - Zofingen Switzerland
        ('350906-Youth Race','309613-Youth Clinic'), # 2024 Keiki Dip-N-Dash & IRONKiDS KEIKI DIP-N-DASH
        ('310545-Youth Race','309106-Youth Race'), # Toughkids Triathlon NY 2024 And Super Sprint Triathlon & Toughkids Triathlon Lake Welch Harriman State Park
    ]

    # Split original dataset into last_year and this_year subsets
    events_last_year = grouped_df[grouped_df['year'] == last_year].copy()
    events_this_year = grouped_df[grouped_df['year'] == this_year].copy()

    # Initialize match columns
    events_last_year[f'match_idx_{this_year}'] = None
    events_this_year[f'match_idx_last_year'] = None

    events_last_year['match_formula_used'] = ""
    events_this_year['match_formula_used'] = ""

    events_last_year['match_score_name_only'] = None
    events_this_year['match_score_name_only'] = None

    events_last_year['match_score_name_and_zip'] = None
    events_this_year['match_score_name_and_zip'] = None

    events_last_year['match_score_name_and_site'] = None
    events_this_year['match_score_name_and_site'] = None

    events_last_year['match_name_this_year'] = None
    events_this_year['match_name_last_year'] = None
    
    events_last_year['match_score_bin'] = None
    events_this_year['match_score_bin'] = None

    pairs = []  # Store potential matches and associated metadata

    # --- FIRST: ASSIGN MANUAL MATCHES ---
    # We match by ApplicationID (must be string for comparison).
    matched_this_year = set()
    matched_last_year = set()
    for aid_this_year, aid_last_year in manual_matches:
        idx_this_year = events_this_year.index[events_this_year['ApplicationID'].astype(str) == str(aid_this_year)]
        idx_last_year = events_last_year.index[events_last_year['ApplicationID'].astype(str) == str(aid_last_year)]
        if len(idx_this_year) and len(idx_last_year):
            i_this_year = idx_this_year[0]
            i_last_year = idx_last_year[0]

            # Set matches for both sides
            events_this_year.at[i_this_year, f'match_idx_last_year'] = i_last_year
            events_this_year.at[i_this_year, 'match_formula_used'] = 'Manual Match'
            events_this_year.at[i_this_year, 'match_name_last_year'] = events_last_year.at[i_last_year, 'Name']
            events_this_year.at[i_this_year, 'match_score_bin'] = "90-100"  # Manual assumed perfect

            events_last_year.at[i_last_year, f'match_idx_{this_year}'] = i_this_year
            events_last_year.at[i_last_year, 'match_formula_used'] = 'Manual Match'
            events_last_year.at[i_last_year, 'match_name_this_year'] = events_this_year.at[i_this_year, 'Name']
            events_this_year.at[i_last_year, 'match_score_bin'] = "90-100"  # Manual assumed perfect

            matched_this_year.add(i_this_year)
            matched_last_year.add(i_last_year)

    # --- Build all potential pairs between this_year and last_year (excluding already-matched manual pairs) ---
    for i_this_year, row_this_year in events_this_year.drop(index=matched_this_year, errors='ignore').iterrows():
        name_this_year = row_this_year['Name']
        zip_this_year = str(row_this_year.get('ZipCode', '')).strip()
        site_this_year = str(row_this_year.get('Website', '')).strip()
        month_this_year = row_this_year['month']

        for i_last_year, row_last_year in events_last_year.drop(index=matched_last_year, errors='ignore').iterrows():
            name_last_year = row_last_year['Name']
            zip_last_year = str(row_last_year.get('ZipCode', '')).strip()
            site_last_year = str(row_last_year.get('Website', '')).strip()
            month_last_year = row_last_year['month']

            combined_score, name_score, zip_score = compute_combined_score(name_this_year, name_last_year, zip_this_year, zip_last_year)
            site_score = compute_site_score(site_this_year, site_last_year)
            combined_site_score = round((name_score * 0.5 + site_score * 0.5), 2)

            # --- STEP 1: Match on All Candidates ---
            formula = "All Candidates"
            threshold = ALL_CANDIDATES_THRESHOLD

            # --- STEP 2: Match in the Same Month ---
            if month_this_year == month_last_year:
                formula = "Same Month"
                threshold = CURRENT_MONTH_THRESHOLD

            # --- STEP 3: Match in Adjacent Months ---
            elif abs(month_this_year - month_last_year) == 1:
                formula = "Adjacent Month"
                threshold = ADJACENT_MONTH_THRESHOLD

            if combined_score >= threshold:
                pairs.append((i_this_year, i_last_year, combined_score, name_score, combined_site_score, formula))

    # Sort by best score first
    pairs = sorted(pairs, key=lambda x: -x[2])

    # --- Assign the best one-to-one matches (excluding already-matched manual pairs) ---
    for i_this_year, i_last_year, combined_score, name_score, combined_site_score, formula in pairs:
        if i_this_year not in matched_this_year and i_last_year not in matched_last_year:
            events_this_year.at[i_this_year, f'match_idx_last_year'] = i_last_year
            events_this_year.at[i_this_year, 'match_formula_used'] = formula
            events_this_year.at[i_this_year, 'match_score_name_only'] = name_score
            events_this_year.at[i_this_year, 'match_score_name_and_zip'] = combined_score
            events_this_year.at[i_this_year, 'match_score_name_and_site'] = combined_site_score
            events_this_year.at[i_this_year, 'match_name_last_year'] = events_last_year.at[i_last_year, 'Name']
            events_this_year.at[i_this_year, 'match_score_bin'] = get_match_score_bin(combined_score)

            events_last_year.at[i_last_year, f'match_idx_{this_year}'] = i_this_year
            events_last_year.at[i_last_year, 'match_formula_used'] = formula
            events_last_year.at[i_last_year, 'match_score_name_only'] = name_score
            events_last_year.at[i_last_year, 'match_score_name_and_zip'] = combined_score
            events_last_year.at[i_last_year, 'match_score_name_and_site'] = combined_site_score
            events_last_year.at[i_last_year, 'match_name_this_year'] = events_this_year.at[i_this_year, 'Name']
            events_last_year.at[i_last_year, 'match_score_bin'] = get_match_score_bin(combined_score)

            matched_this_year.add(i_this_year)
            matched_last_year.add(i_last_year)

    # --- Annotate matches ---
    events_last_year['has_match'] = events_last_year[f'match_idx_{this_year}'].notnull()
    events_this_year['has_match'] = events_this_year[f'match_idx_last_year'].notnull()

    # Mark matched/unmatched and fill bins for unmatched
    events_this_year.loc[~events_this_year['has_match'], 'match_score_bin'] = 'no_match'
    events_last_year.loc[~events_last_year['has_match'], 'match_score_bin'] = 'no_match'

    # (Optional: Print value counts for sanity check)
    print("This year score bin counts:\n", events_this_year['match_score_bin'].value_counts(dropna=False))
    print("Last year score bin counts:\n", events_last_year['match_score_bin'].value_counts(dropna=False))

    # --- Enrich matched data with key fields ---
    for i_this_year in events_this_year.index:
        i_last_year = events_this_year.at[i_this_year, f'match_idx_last_year']
        if pd.notnull(i_last_year):
            row = events_last_year.loc[i_last_year]
            events_this_year.at[i_this_year, f'application_id_last_year'] = row['ApplicationID']
            events_this_year.at[i_this_year, f'status_{last_year}'] = row['Status']
            events_this_year.at[i_this_year, f'earliest_start_date_last_year'] = row['StartDate']
            events_this_year.at[i_this_year, f'website_last_year'] = row['Website']
            events_this_year.at[i_this_year, f'zip_code_last_year'] = row['ZipCode']
            events_this_year.at[i_this_year, f'state_code_last_year'] = row['2LetterCode']

            events_this_year.at[i_this_year, f'RaceDirectorUserID_{last_year}'] = row['RaceDirectorUserID']
            events_this_year.at[i_this_year, f'Email_{last_year}'] = row['Email']
            
    for i_last_year in events_last_year.index:
        i_this_year = events_last_year.at[i_last_year, f'match_idx_{this_year}']
        if pd.notnull(i_this_year):
            row = events_this_year.loc[i_this_year]
            events_last_year.at[i_last_year, f'application_id_{this_year}'] = row['ApplicationID']
            events_last_year.at[i_last_year, f'status_{this_year}'] = row['Status']
            events_last_year.at[i_last_year, f'earliest_start_date_{this_year}'] = row['StartDate']
            events_last_year.at[i_last_year, f'website_{this_year}'] = row['Website']
            events_last_year.at[i_last_year, f'zip_code_{this_year}'] = row['ZipCode']
            events_last_year.at[i_last_year, f'state_code_{this_year}'] = row['2LetterCode']

            events_last_year.at[i_last_year, f'RaceDirectorUserID_{this_year}'] = row['RaceDirectorUserID']
            events_last_year.at[i_last_year, f'Email_{this_year}'] = row['Email']

    # --- Assign common_date, common_year, common_month ---
    # For matched events: both sides get the this_year StartDate as common_date
    for i_this_year in events_this_year.index:
        i_last_year = events_this_year.at[i_this_year, f'match_idx_last_year']
        if pd.notnull(i_last_year):
            # If match, use this_year StartDate for both
            common_date = events_this_year.at[i_this_year, 'StartDate']
            events_this_year.at[i_this_year, 'common_date'] = common_date
            events_last_year.at[i_last_year, 'common_date'] = common_date
            # Common year/month
            events_this_year.at[i_this_year, 'common_year'] = this_year
            events_last_year.at[i_last_year, 'common_year'] = this_year
            events_this_year.at[i_this_year, 'common_month'] = events_this_year.at[i_this_year, 'month']
            events_last_year.at[i_last_year, 'common_month'] = events_this_year.at[i_this_year, 'month']
        else:
            # No match: use this row's own date/year/month
            events_this_year.at[i_this_year, 'common_date'] = events_this_year.at[i_this_year, 'StartDate']
            events_this_year.at[i_this_year, 'common_year'] = events_this_year.at[i_this_year, 'year']
            events_this_year.at[i_this_year, 'common_month'] = events_this_year.at[i_this_year, 'month']

    for i_last_year in events_last_year.index:
        # Already set if matched above, otherwise set here
        if pd.isnull(events_last_year.at[i_last_year, 'common_date']):
            events_last_year.at[i_last_year, 'common_date'] = events_last_year.at[i_last_year, 'StartDate']
            events_last_year.at[i_last_year, 'common_year'] = events_last_year.at[i_last_year, 'year']
            events_last_year.at[i_last_year, 'common_month'] = events_last_year.at[i_last_year, 'month']

    """
    common_status field logic:
    - For matched events (across 2024/2025), if EITHER year's status is 'cancelled', 'declined', or 'deleted' (case-insensitive),
    then common_status is set to 'cancelled/declined/deleted' for BOTH years' event records.
    - Otherwise, common_status is set to the 2025 status if present, else the 2024 status.
    - For unmatched events, common_status is just the event's own status.
    This ensures that for every event (matched or not), there is a single field for status-based filtering and summary reporting
    that is consistent across years and not split by mismatches in status.
    """
    # Common status field logic
    cancel_statuses = ['cancelled', 'declined', 'deleted']

    for i_this_year in events_this_year.index:
        i_last_year = events_this_year.at[i_this_year, f'match_idx_last_year']
        status_this_year = events_this_year.at[i_this_year, 'Status']
        status_last_year = events_last_year.at[i_last_year, 'Status'] if pd.notnull(i_last_year) else None

        # Assign both statuses for reference
        events_this_year.at[i_this_year, 'status_last_year'] = status_last_year
        events_this_year.at[i_this_year, 'status_this_year'] = status_this_year
        if pd.notnull(i_last_year):
            events_last_year.at[i_last_year, 'status_last_year'] = status_last_year
            events_last_year.at[i_last_year, 'status_this_year'] = status_this_year

        # Set common_status if either is cancelled/declined/deleted
        status_this_year_low = str(status_this_year).lower() if status_this_year else ''
        status_last_year_low = str(status_last_year).lower() if status_last_year else ''

        if any(s in cancel_statuses for s in [status_this_year_low, status_last_year_low]):
            common_status = 'cancelled/declined/deleted'
        else:
            # Prefer this_year status if present, else last_year
            common_status = status_this_year if status_this_year else status_last_year

        events_this_year.at[i_this_year, 'common_status'] = common_status
        if pd.notnull(i_last_year):
            events_last_year.at[i_last_year, 'common_status'] = common_status

    # Fill unmatched events with their own status
    for i_last_year in events_last_year.index:
        if pd.isnull(events_last_year.at[i_last_year, 'common_status']):
            status_last_year = events_last_year.at[i_last_year, 'Status']
            events_last_year.at[i_last_year, 'common_status'] = status_last_year
            events_last_year.at[i_last_year, 'status_last_year'] = status_last_year
            events_last_year.at[i_last_year, 'status_this_year'] = None

    for i_this_year in events_this_year.index:
        if pd.isnull(events_this_year.at[i_this_year, 'common_status']):
            status_this_year = events_this_year.at[i_this_year, 'Status']
            events_this_year.at[i_this_year, 'common_status'] = status_this_year
            events_this_year.at[i_this_year, 'status_this_year'] = status_this_year
            events_this_year.at[i_this_year, 'status_last_year'] = None

    # --- Generate summaries by year/month ---
    match_summary_this_year = (
    events_this_year[
            events_this_year['source'] != 'from_missing_in_event_data_metrics'
        ]
        .groupby(['year', 'month', 'month_name'])
        .agg(
            total_events=('Name', 'count'),
            matched_events=('has_match', lambda x: x.sum()),
            unmatched_events=('has_match', lambda x: (~x).sum())
        )
        .sort_values(by=['year', 'month'])
        .reset_index()
    )

    match_summary_last_year = (
        events_last_year[
            events_last_year['source'] != 'from_missing_in_event_data_metrics'
        ]
        .groupby(['year', 'month', 'month_name'])
        .agg(
            total_events=('Name', 'count'),
            matched_events=('has_match', lambda x: x.sum()),
            unmatched_events=('has_match', lambda x: (~x).sum())
        )
        .sort_values(by=['year', 'month'])
        .reset_index()
    )

    return events_this_year, events_last_year, match_summary_this_year, match_summary_last_year

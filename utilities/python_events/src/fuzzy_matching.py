import pandas as pd
from rapidfuzz import fuzz

# --- Threshold constants ---
ALL_CANDIDATES_THRESHOLD    =   90   # For all candidates (highest confidence required)
CURRENT_MONTH_THRESHOLD     =   80   # For candidates in the same month
ADJACENT_MONTH_THRESHOLD    =   80   # For candidates in adjacent months
FALLBACK_THRESHOLD          =   80   # For fallback selection from entire dataset

def match_events_bidirectional(grouped_df):
    """
    Perform fuzzy matching of 2024 events against 2025 events using the following logic:
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

    # Split original dataset into 2024 and 2025 subsets
    events_2024 = grouped_df[grouped_df['year'] == 2024].copy()
    events_2025 = grouped_df[grouped_df['year'] == 2025].copy()

    # Initialize match columns
    events_2024['match_idx_2025'] = None
    events_2025['match_idx_2024'] = None
    events_2024['match_formula_used'] = ""
    events_2025['match_formula_used'] = ""

    pairs = []  # Store potential matches and associated metadata

    # --- Build all potential pairs between 2025 and 2024 ---
    for i2025, row2025 in events_2025.iterrows():
        name_2025 = row2025['Name']
        zip_2025 = str(row2025.get('ZipCode', '')).strip()
        site_2025 = str(row2025.get('Website', '')).strip()
        month_2025 = row2025['month']

        for i2024, row2024 in events_2024.iterrows():
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

    matched_2025 = set()
    matched_2024 = set()

    # --- Assign the best one-to-one matches ---
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

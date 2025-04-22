import pandas as pd
from rapidfuzz import process, fuzz

def match_events_2025_vs_2024(grouped_df, match_score_threshold):
    """Perform fuzzy matching of 2025 events against 2024 events,
    prioritizing same-month matches and then adjacent months.
    """
    events_2024 = grouped_df[grouped_df['year'] == 2024].copy()
    events_2025 = grouped_df[grouped_df['year'] == 2025].copy()
    names_2024 = events_2024['Name'].tolist()

    # Initialize match columns in events_2025
    match_cols = [
        'match_name_2024', 'match_score_name_only', 'match_score_name_and_site',
        'match_score_name_and_zip', 'has_match', 'application_id_2024', 'status_2024',
        'earliest_race_date_2024', 'website_2024', 'zip_code_2024', 'state_code_2024'
    ]
    for col in match_cols:
        events_2025[col] = None
    events_2025['has_match'] = False

    for idx, row in events_2025.iterrows():
        name_2025 = row['Name']
        site_2025 = str(row.get('Website', '')).strip().lower()
        zip_2025 = str(row.get('ZipCode', '')).strip()
        event_month = row['month']  # Month of the 2025 event

        # --- Candidate Selection ---
        # 1. Same-month candidates
        candidates = events_2024[events_2024['month'] == event_month]
        # 2. If none in same month, try adjacent months
        if candidates.empty:
            adjacent_months = []
            if event_month - 1 >= 1:
                adjacent_months.append(event_month - 1)
            if event_month + 1 <= 12:
                adjacent_months.append(event_month + 1)
            candidates = events_2024[events_2024['month'].isin(adjacent_months)]
        # 3. Fallback to all candidates if still empty
        if candidates.empty:
            candidates = events_2024

        candidate_names = candidates['Name'].tolist()
        best_name_match = process.extractOne(name_2025, candidate_names, scorer=fuzz.token_sort_ratio)

        if best_name_match:
            matched_name, name_score, _ = best_name_match
            # Use first occurrence among candidates with the matched name
            matched_row = events_2024[events_2024['Name'] == matched_name].iloc[0]
            site_2024 = str(matched_row.get('Website', '')).strip().lower()
            zip_2024 = str(matched_row.get('ZipCode', '')).strip()

            # Calculate similarity scores for site and zipcode
            site_score = fuzz.token_sort_ratio(site_2025, site_2024) if site_2025 and site_2024 else 0
            zip_score = fuzz.token_sort_ratio(zip_2025, zip_2024) if zip_2025 and zip_2024 else 0

            combined_zip_score = round((name_score * 0.5 + zip_score * 0.5), 2)
            combined_site_score = round((name_score * 0.5 + site_score * 0.5), 2)

            # Populate match scores
            events_2025.at[idx, 'match_name_2024'] = matched_name
            events_2025.at[idx, 'match_score_name_only'] = name_score
            events_2025.at[idx, 'match_score_name_and_site'] = combined_site_score
            events_2025.at[idx, 'match_score_name_and_zip'] = combined_zip_score

            if combined_zip_score >= match_score_threshold:
                events_2025.at[idx, 'has_match'] = True
                events_2025.at[idx, 'match_formula_used'] = 'Name + ZipCode'

            # Populate related 2024 fields
            events_2025.at[idx, 'application_id_2024'] = matched_row['ApplicationID']
            events_2025.at[idx, 'status_2024'] = matched_row['Status']
            events_2025.at[idx, 'earliest_race_date_2024'] = matched_row['earliest_race_date']
            events_2025.at[idx, 'website_2024'] = matched_row['Website']
            events_2025.at[idx, 'zip_code_2024'] = matched_row['ZipCode']
            events_2025.at[idx, 'state_code_2024'] = matched_row['2LetterCode']
        else:
            # No match found
            events_2025.at[idx, 'has_match'] = False
            events_2025.at[idx, 'match_formula_used'] = 'No Match'
            events_2025.at[idx, 'application_id_2024'] = row['ApplicationID']
            events_2025.at[idx, 'status_2024'] = row['Status']
            events_2025.at[idx, 'earliest_race_date_2024'] = row['earliest_race_date']
            events_2025.at[idx, 'website_2024'] = row['Website']
            events_2025.at[idx, 'zip_code_2024'] = row['ZipCode']
            events_2025.at[idx, 'state_code_2024'] = row['2LetterCode']

    # Generate match summary for 2025 events (aggregated by year, month, and month_name)
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

    return events_2025, events_2024, match_summary


def match_events_2024_vs_2025(events_2024, events_2025, match_score_threshold):
    """Perform fuzzy matching of 2024 events against 2025 events,
    prioritizing same-month matches then adjacent months.
    """
    names_2025 = events_2025['Name'].tolist()

    # Initialize match columns in events_2024
    match_cols_2024 = [
        'match_name_2025', 'match_score_name_only', 'match_score_name_and_site',
        'match_score_name_and_zip', 'has_match', 'application_id_2025', 'status_2025',
        'earliest_race_date_2025', 'website_2025', 'zip_code_2025', 'state_code_2025'
    ]
    for col in match_cols_2024:
        events_2024[col] = None
    events_2024['has_match'] = False

    for idx, row in events_2024.iterrows():
        name_2024 = row['Name']
        site_2024 = str(row.get('Website', '')).strip().lower()
        zip_2024 = str(row.get('ZipCode', '')).strip()
        event_month = row['month']

        # --- Candidate Selection for 2024 -> 2025 ---
        candidates = events_2025[events_2025['month'] == event_month]
        if candidates.empty:
            adjacent_months = []
            if event_month - 1 >= 1:
                adjacent_months.append(event_month - 1)
            if event_month + 1 <= 12:
                adjacent_months.append(event_month + 1)
            candidates = events_2025[events_2025['month'].isin(adjacent_months)]
        if candidates.empty:
            candidates = events_2025

        candidate_names = candidates['Name'].tolist()
        best_name_match = process.extractOne(name_2024, candidate_names, scorer=fuzz.token_sort_ratio)

        if best_name_match:
            matched_name, name_score, _ = best_name_match
            matched_row = events_2025[events_2025['Name'] == matched_name].iloc[0]
            site_2025 = str(matched_row.get('Website', '')).strip().lower()
            zip_2025 = str(matched_row.get('ZipCode', '')).strip()

            site_score = fuzz.token_sort_ratio(site_2024, site_2025) if site_2024 and site_2025 else 0
            zip_score = fuzz.token_sort_ratio(zip_2024, zip_2025) if zip_2024 and zip_2025 else 0

            combined_zip_score = round((name_score * 0.5 + zip_score * 0.5), 2)
            combined_site_score = round((name_score * 0.5 + site_score * 0.5), 2)

            events_2024.at[idx, 'match_name_2025'] = matched_name
            events_2024.at[idx, 'match_score_name_only'] = name_score
            events_2024.at[idx, 'match_score_name_and_site'] = combined_site_score
            events_2024.at[idx, 'match_score_name_and_zip'] = combined_zip_score

            if combined_zip_score >= match_score_threshold:
                events_2024.at[idx, 'has_match'] = True
                events_2024.at[idx, 'match_formula_used'] = 'Name + ZipCode'

            events_2024.at[idx, 'application_id_2025'] = matched_row['ApplicationID']
            events_2024.at[idx, 'status_2025'] = matched_row['Status']
            events_2024.at[idx, 'earliest_race_date_2025'] = matched_row['earliest_race_date']
            events_2024.at[idx, 'website_2025'] = matched_row['Website']
            events_2024.at[idx, 'zip_code_2025'] = matched_row['ZipCode']
            events_2024.at[idx, 'state_code_2025'] = matched_row['2LetterCode']
        else:
            events_2024.at[idx, 'has_match'] = False
            events_2024.at[idx, 'match_formula_used'] = 'No Match'
            events_2024.at[idx, 'application_id_2025'] = row['ApplicationID']
            events_2024.at[idx, 'status_2025'] = row['Status']
            events_2024.at[idx, 'earliest_race_date_2025'] = row['earliest_race_date']
            events_2024.at[idx, 'website_2025'] = row['Website']
            events_2024.at[idx, 'zip_code_2025'] = row['ZipCode']
            events_2024.at[idx, 'state_code_2025'] = row['2LetterCode']

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
    return events_2024, match_summary_2024

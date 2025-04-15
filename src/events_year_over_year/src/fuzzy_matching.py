import pandas as pd
from rapidfuzz import process, fuzz

def match_events_2025_vs_2024(grouped_df, match_score_threshold):
    """
    Perform fuzzy matching of 2025 events against 2024 events using the following logic:
      - Consider all 2024 candidates; if a candidate’s combined (Zip+Name) score is above 90, retain that match.
      - Else, look at candidates in the current month; if the best match has a combined score above 80, retain that.
      - Else, look at candidates in adjacent months; if the best match’s score is above 80, retain that.
      - Else, from the entire dataset, select the best candidate with a combined score above 80.
      
    Combined score is calculated as the average of the fuzzy name score and zipcode score.
    After a match is determined, the function also computes the site similarity and combined (Name+Site) score.
    """

    # Helper function to compute combined name + zipcode score.
    def compute_combined_score(name_a, name_b, zip_a, zip_b):
        name_score = fuzz.token_sort_ratio(name_a, name_b)
        zip_score = fuzz.token_sort_ratio(zip_a, zip_b) if zip_a and zip_b else 0
        combined = round((name_score * 0.5 + zip_score * 0.5), 2)
        return combined, name_score, zip_score

    # Separate events by year.
    events_2024 = grouped_df[grouped_df['year'] == 2024].copy()
    events_2025 = grouped_df[grouped_df['year'] == 2025].copy()

    # Initialize match columns in events_2025.
    match_cols = [
        'match_name_2024', 'match_score_name_only', 'match_score_name_and_site',
        'match_score_name_and_zip', 'has_match', 'application_id_2024', 'status_2024',
        'earliest_race_date_2024', 'website_2024', 'zip_code_2024', 'state_code_2024',
        'match_formula_used'
    ]
    for col in match_cols:
        events_2025[col] = None
    events_2025['has_match'] = False

    # Loop over each event in 2025.
    for idx, row in events_2025.iterrows():
        name_2025 = row['Name']
        site_2025 = str(row.get('Website', '')).strip().lower()
        zip_2025 = str(row.get('ZipCode', '')).strip()
        event_month = row['month']  # Month of the 2025 event

        best_candidate = None
        best_combined_score = 0  # for Name+Zip combination
        best_name_score = 0      # to be used later for site score combination
        match_formula = ""

        # --- STEP 1: Search All Candidates ---
        candidate_pool = events_2024
        for _, candidate in candidate_pool.iterrows():
            candidate_name = candidate['Name']
            candidate_zip = str(candidate.get('ZipCode', '')).strip()
            score, name_score, _ = compute_combined_score(name_2025, candidate_name, zip_2025, candidate_zip)
            if score > best_combined_score:
                best_combined_score = score
                best_candidate = candidate
                best_name_score = name_score

        if best_candidate is not None and best_combined_score > 90:
            match_formula = "All Candidates (Zip+Name > 90)"
        else:
            # --- STEP 2: Candidates in the Current Month ---
            candidate_pool = events_2024[events_2024['month'] == event_month]
            best_candidate = None
            best_combined_score = 0
            for _, candidate in candidate_pool.iterrows():
                candidate_name = candidate['Name']
                candidate_zip = str(candidate.get('ZipCode', '')).strip()
                score, name_score, _ = compute_combined_score(name_2025, candidate_name, zip_2025, candidate_zip)
                if score > best_combined_score:
                    best_combined_score = score
                    best_candidate = candidate
                    best_name_score = name_score

            if best_candidate is not None and best_combined_score > 80:
                match_formula = "Current Month (Zip+Name > 80)"
            else:
                # --- STEP 3: Candidates in Adjacent Months ---
                adjacent_months = []
                if event_month - 1 >= 1:
                    adjacent_months.append(event_month - 1)
                if event_month + 1 <= 12:
                    adjacent_months.append(event_month + 1)
                candidate_pool = events_2024[events_2024['month'].isin(adjacent_months)]
                best_candidate = None
                best_combined_score = 0
                for _, candidate in candidate_pool.iterrows():
                    candidate_name = candidate['Name']
                    candidate_zip = str(candidate.get('ZipCode', '')).strip()
                    score, name_score, _ = compute_combined_score(name_2025, candidate_name, zip_2025, candidate_zip)
                    if score > best_combined_score:
                        best_combined_score = score
                        best_candidate = candidate
                        best_name_score = name_score
                if best_candidate is not None and best_combined_score > 80:
                    match_formula = "Adjacent Months (Zip+Name > 80)"
                else:
                    # --- STEP 4: Fallback on Entire Dataset ---
                    candidate_pool = events_2024
                    best_candidate = None
                    best_combined_score = 0
                    for _, candidate in candidate_pool.iterrows():
                        candidate_name = candidate['Name']
                        candidate_zip = str(candidate.get('ZipCode', '')).strip()
                        score, name_score, _ = compute_combined_score(name_2025, candidate_name, zip_2025, candidate_zip)
                        if score > best_combined_score:
                            best_combined_score = score
                            best_candidate = candidate
                            best_name_score = name_score
                    if best_candidate is not None and best_combined_score > 80:
                        match_formula = "Fallback All Candidates (Zip+Name > 80)"
                    else:
                        match_formula = "No Match"

        # Populate event details for the 2025 event if a candidate is accepted.
        if best_candidate is not None and best_combined_score > 80:
            # Compute site similarity score.
            candidate_site = str(best_candidate.get('Website', '')).strip().lower()
            site_score = fuzz.token_sort_ratio(site_2025, candidate_site) if site_2025 and candidate_site else 0

            # Combined site score: average of the name score and the site score.
            combined_site_score = round((best_name_score * 0.5 + site_score * 0.5), 2)

            events_2025.at[idx, 'match_name_2024'] = best_candidate['Name']
            events_2025.at[idx, 'match_score_name_only'] = best_name_score
            events_2025.at[idx, 'match_score_name_and_site'] = combined_site_score
            events_2025.at[idx, 'match_score_name_and_zip'] = best_combined_score
            events_2025.at[idx, 'has_match'] = True
            events_2025.at[idx, 'match_formula_used'] = match_formula

            # Populate additional fields from the matching 2024 event.
            events_2025.at[idx, 'application_id_2024'] = best_candidate['ApplicationID']
            events_2025.at[idx, 'status_2024'] = best_candidate['Status']
            events_2025.at[idx, 'earliest_race_date_2024'] = best_candidate['earliest_race_date']
            events_2025.at[idx, 'website_2024'] = best_candidate['Website']
            events_2025.at[idx, 'zip_code_2024'] = best_candidate['ZipCode']
            events_2025.at[idx, 'state_code_2024'] = best_candidate['2LetterCode']
        else:
            # If no candidate meets any of the criteria.
            events_2025.at[idx, 'has_match'] = False
            events_2025.at[idx, 'match_formula_used'] = "No Match"
            events_2025.at[idx, 'application_id_2024'] = row['ApplicationID']
            events_2025.at[idx, 'status_2024'] = row['Status']
            events_2025.at[idx, 'earliest_race_date_2024'] = row['earliest_race_date']
            events_2025.at[idx, 'website_2024'] = row['Website']
            events_2025.at[idx, 'zip_code_2024'] = row['ZipCode']
            events_2025.at[idx, 'state_code_2024'] = row['2LetterCode']

    # Generate match summary for 2025 events (aggregated by year, month, and month_name).
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

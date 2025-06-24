import os
import sys
import pandas as pd
from rapidfuzz import fuzz

from pathlib import Path
from directory_utilities import get_output_path, archive_prior_output, parse_args, get_month_info

from data_loader import load_data

# Ensure emoji/unicode output works on Windows
if os.name == 'nt':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

def main():
    # Parse command line arguments
    # python main.py --month 4
    args = parse_args()
    ANALYSIS_MONTH, ANALYSIS_MONTH_NAME = get_month_info(args.month)
    print("🔍 Analysis Month = ", ANALYSIS_MONTH)
    
    # --- CREATE DIRECTORIES ---
    print("🔍 Creating directories & paths")
    directory = "usat_event_python_output_sales_match"
    archive_prior_output(directory)
    event_output_path = get_output_path(directory)

    # ######################################
    # --- LOAD DATA ---
    df = load_data("usat_event_python_input_sales_match", "name_events")

    # Ensure event names are strings
    df['name_events'] = df['name_events'].astype(str)

    print(f"✅ Data loaded: {df.shape[0]} rows, {df.shape[1]} columns")
    # print(f"✅ Data loaded: {df.head(5)}")

    # Fuzzy ratio function
    def ratio(a, b):
        return fuzz.ratio(a, b)   # already returns 0–100

    # Clustering threshold
    threshold = 90

    # Get unique event names
    unique_names = df['name_events'].dropna().unique()

    # Build clusters
    reps = []         # list of representative names
    assignments = {}  # map original name → (common_name, match_score)

    for name in unique_names:
        if not reps:
            # first name forms its own cluster
            reps.append(name)
            assignments[name] = (name, 100)
        else:
            # find best matching existing representative
            best_rep, best_score = max(
                ((rep, ratio(name, rep)) for rep in reps),
                key=lambda x: x[1]
            )
            if best_score >= threshold:
                # assign into that cluster
                assignments[name] = (best_rep, best_score)
            else:
                # create a new cluster
                reps.append(name)
                assignments[name] = (name, 100)

    # Turn assignments into a DataFrame
    assignments_df = (
        pd.DataFrame.from_dict(assignments, orient='index', columns=['common_name', 'match_score'])
        .reset_index()
        .rename(columns={'index': 'name_events'})
    )

    # Merge assignments back into the original data
    df_matched = df.merge(assignments_df, on='name_events', how='left')

    # Reorder columns: common_name, original name, score, then all other year columns
    cols = ['common_name', 'name_events', 'match_score'] + [c for c in df.columns if c != 'name_events']
    df_matched = df_matched[cols]

    # (Optional) Display a preview
    print(df_matched.head(5))

    # Save the full result to CSV for pivoting
    # df_matched.to_csv(event_output_path / 'matched_events.csv', index=False)
    # print("Matched dataset saved to matched_events.csv")

    # Save as CSV
    csv_file = event_output_path / 'matched_events.csv'
    df_matched.to_csv(csv_file, index=False)
    print(f"Matched dataset saved to CSV → {csv_file}")

    # Save as Excel
    excel_file = event_output_path / 'matched_events.xlsx'
    # Simple: pandas picks a default engine (openpyxl or xlsxwriter)
    df_matched.to_excel(excel_file, sheet_name='MatchedEvents', index=False)
    print(f"Matched dataset saved to EXCEL → {excel_file}")
    ##############################

def is_venv():
    return sys.prefix != sys.base_prefix

def test():
    """Lightweight test to verify that the script loads data and initializes key steps."""
    print("🔍 Running lightweight test...")

    print("🐍 Python executable:", sys.executable)
    print("📦 Site-packages location:", next(p for p in sys.path if 'site-packages' in p))
    print("🧪 VENV active:", is_venv())

    if not is_venv():
        print("❌ ERROR: You are not using the virtual environment!")
        print(f"   Python used: {sys.executable}")
        sys.exit(1)

    try:
        # Load and display basic info from data
        df = load_data("usat_event_python_input_sales_match", "name_events")
        print(f"✅ Data loaded: {df.shape[0]} rows, {df.shape[1]} columns")
        print(f"✅ Data loaded: {df.head(10)}")

        print("🎉 Test passed successfully.")

    except Exception as e:
        print("❌ Test failed:", str(e))

# NOTE: See note_test_run.txt to view how to test this file
# NOTE: See notes_venv_setup.txt to setup venv environment

if __name__ == "__main__":
    if "--test" in sys.argv:
        test()
    else:
        main()

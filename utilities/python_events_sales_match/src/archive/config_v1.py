import os
import calendar
from pathlib import Path

# --- CONFIGURATION ---
# --- FILE PATH SHOULD BE AT THE LEVEL OF THE index.js thus using "src/" prefix
# INPUT_FILE = "src/event_input/santioning_list_041523_w_created_date_fixed.xlsx" 

PATH_PREFIX_OUTPUT = "src/event_output/"

# input
INPUT_FILE = Path("src") / "event_input" / "test.csv"

# output
OUTPUT_DIR  = Path("src") / "event_output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT_FILE = OUTPUT_DIR / "cleaned_grouped_event_data_with_summary.xlsx"

MATCH_SCORE_THRESHOLD = 80  # Adjustable threshold; see fuzzy_matching.py

# --- MONTH CONFIGURATION FOR EVENT TIMING ---
ANALYSIS_MONTH = 4  # April (1 = January, ..., 12 = December)
MONTH_NAME = calendar.month_name[ANALYSIS_MONTH]

import os
import calendar

# --- CONFIGURATION ---
# --- FILE PATH SHOULD BE AT THE LEVEL OF THE index.js thus using "src/" prefix
# INPUT_FILE = "src/event_input/santioning_list_040723.xlsx" 
# INPUT_FILE = "src/event_input/santioning_list_041423_wo_created_date.xlsx"  
# INPUT_FILE = "src/event_input/santioning_list_041423_w_created_date.xlsx" 
INPUT_FILE = "src/event_input/santioning_list_041523_w_created_date.xlsx" 

PATH_PREFIX_OUTPUT = "src/event_output/"
OUTPUT_FILE = f"{PATH_PREFIX_OUTPUT}cleaned_grouped_event_data_with_summary.xlsx"
os.makedirs("src/event_output", exist_ok=True)

MATCH_SCORE_THRESHOLD = 80  # Adjustable threshold; see fuzzy_matching.py

# --- MONTH CONFIGURATION FOR EVENT TIMING ---
ANALYSIS_MONTH = 4  # April (1 = January, ..., 12 = December)
MONTH_NAME = calendar.month_name[ANALYSIS_MONTH]

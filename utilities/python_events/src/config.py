import os
import calendar
from pathlib import Path

# Base directory for resolving relative paths (the directory containing this config file)
BASE_DIR = Path(__file__).resolve().parent

# --- INPUT CONFIGURATION ---
# Always points to src/event_input/test.csv regardless of current working directory
# INPUT_FILE = BASE_DIR / "event_input" / "test.csv"
INPUT_FILE = BASE_DIR / "event_input" / "results_2025-04-23_16-42-07_python_event_data_offset_0_batch_1.csv"

# --- OUTPUT CONFIGURATION ---
# Directory for output files under src/event_output
OUTPUT_DIR = BASE_DIR / "event_output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Path prefix for backward compatibility (as a string)
# If main still uses PATH_PREFIX_OUTPUT, it will now be absolute
PATH_PREFIX_OUTPUT = str(OUTPUT_DIR) + os.sep

# Full path to the main Excel output
OUTPUT_FILE = OUTPUT_DIR / "cleaned_grouped_event_data_with_summary.xlsx"

# --- ANALYSIS PARAMETERS ---
# Threshold for fuzzy matching
MATCH_SCORE_THRESHOLD = 80

# Month configuration for timing analysis
ANALYSIS_MONTH = 4  # April
MONTH_NAME = calendar.month_name[ANALYSIS_MONTH]

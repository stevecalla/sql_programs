# import pandas as pd
# from config import INPUT_FILE

# def load_data():
#     """Load the input Excel file into a pandas DataFrame."""
#     return pd.read_excel(INPUT_FILE)

import os
import pandas as pd
from config import INPUT_FILE

def load_data():
    """
    Load the input file (Excel or CSV) into a pandas DataFrame,
    based on the file extension of INPUT_FILE.
    """
    _, ext = os.path.splitext(INPUT_FILE)
    ext = ext.lower()

    if ext in ('.xls', '.xlsx', '.xlsm', '.xlsb'):
        return pd.read_excel(INPUT_FILE)
    elif ext == '.csv':
        return pd.read_csv(INPUT_FILE)
    else:
        raise ValueError(f"Unsupported file format: {ext!r}. "
                         "Expected .csv, .xls, .xlsx, .xlsm or .xlsb.")

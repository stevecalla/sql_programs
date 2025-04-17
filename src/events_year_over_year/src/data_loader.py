import pandas as pd
from config import INPUT_FILE

def load_data():
    """Load the input Excel file into a pandas DataFrame."""
    return pd.read_excel(INPUT_FILE)

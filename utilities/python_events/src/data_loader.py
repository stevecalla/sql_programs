from pathlib import Path
import pandas as pd

from directory_utilities import get_os_path

# Extensions we’ll consider
EXCEL_EXTS = {'.xls', '.xlsx', '.xlsm', '.xlsb'}
CSV_EXTS   = {'.csv'}
ALL_EXTS   = EXCEL_EXTS | CSV_EXTS

def load_data(subfolder: str) -> pd.DataFrame:
    """
    1) Scans the specified subfolder under the platform-appropriate directory for CSV/Excel files.
    2) Picks the newest one.
    3) Loads it into a DataFrame.
    4) Strips header whitespace.
    5) Verifies that 'RaceDate' exists.
    """
    data_dir = get_os_path(subfolder)
    print(f"Looking in data directory: {data_dir!r}")

    if not data_dir.exists():
        raise FileNotFoundError(f"No such directory: {data_dir!r}")

    # find all candidate files
    files = [
        p for p in data_dir.iterdir()
        if p.is_file() and p.suffix.lower() in ALL_EXTS
    ]
    print(f"Found files: {[p.name for p in files]}")

    if not files:
        raise FileNotFoundError(f"No CSV/Excel files in {data_dir!r}")

    # pick the most recently modified
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    chosen = files[0]
    print(f"Loading file: {chosen.name} (full path: {chosen.resolve()})")

    # load into pandas
    if chosen.suffix.lower() in EXCEL_EXTS:
        df = pd.read_excel(chosen)
    else:
        df = pd.read_csv(chosen)

    # strip whitespace from column names
    df.columns = df.columns.str.strip()
    print(f"Columns after strip: {df.columns.tolist()}")

    # verify RaceDate exists
    if 'RaceDate' not in df.columns:
        raise KeyError(
            f"'RaceDate' column not found in loaded file; got {df.columns.tolist()}"
        )

    return df

# load_data("usat_python_data")
# load_data("usat_event_output")

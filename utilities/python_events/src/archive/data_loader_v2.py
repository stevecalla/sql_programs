import platform
import getpass
from pathlib import Path
import pandas as pd

# --- CONFIGURE YOUR FOLDERS HERE ---
BASE_PATHS = {
    'Linux': {
        'steve-calla': Path('/home/steve-calla/development/usat/data/usat_python_data'),
        'usat-server': Path('/home/usat-server/development/usat/data/usat_python_data'),
        'default':     Path('/home/other-user/development/usat/data/usat_python_data'),
    },
    'Darwin': Path('/Users/teamkwsc/development/usat/data/usat_python_data'),
    'Windows': Path(r'C:\ProgramData\MySQL\MySQL Server 8.0\Uploads\data\usat_python_data'),
}

# Extensions we’ll consider
EXCEL_EXTS = {'.xls', '.xlsx', '.xlsm', '.xlsb'}
CSV_EXTS   = {'.csv'}
ALL_EXTS   = EXCEL_EXTS | CSV_EXTS


def get_data_dir() -> Path:
    """
    Picks the right base folder for your platform/user.
    """
    os_name = platform.system()  # 'Linux', 'Darwin', or 'Windows'
    if os_name == 'Linux':
        user = getpass.getuser()
        return BASE_PATHS['Linux'].get(user, BASE_PATHS['Linux']['default'])
    elif os_name in ('Darwin', 'Windows'):
        return BASE_PATHS[os_name]
    else:
        raise RuntimeError(f"Unsupported OS: {os_name}")


def load_data() -> pd.DataFrame:
    """
    1) Scans the platform-appropriate directory for CSV/Excel files.
    2) Picks the newest one.
    3) Loads it into a DataFrame.
    4) Strips header whitespace.
    5) Verifies that 'RaceDate' exists.
    """
    data_dir = get_data_dir()
    # print(f"Looking in data directory: {data_dir!r}")

    if not data_dir.exists():
        raise FileNotFoundError(f"No such directory: {data_dir!r}")

    # find all candidate files
    files = [
        p for p in data_dir.iterdir()
        if p.is_file() and p.suffix.lower() in ALL_EXTS
    ]
    # print(f"Found files: {[p.name for p in files]}")

    if not files:
        raise FileNotFoundError(f"No CSV/Excel files in {data_dir!r}")

    # pick the most recently modified
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    chosen = files[0]
    # print(f"Loading file: {chosen.name} (full path: {chosen.resolve()})")

    # load into pandas
    if chosen.suffix.lower() in EXCEL_EXTS:
        df = pd.read_excel(chosen)
    else:
        df = pd.read_csv(chosen)

    # strip whitespace from column names
    df.columns = df.columns.str.strip()
    # print(f"Columns after strip: {df.columns.tolist()}")

    # verify RaceDate exists
    if 'RaceDate' not in df.columns:
        raise KeyError(
            f"'RaceDate' column not found in loaded file; got {df.columns.tolist()}"
        )

    return df

# load_data()

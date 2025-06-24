import pandas as pd
import platform
import getpass
from pathlib import Path
import argparse
import datetime
import calendar
import shutil

# --- CONFIGURE YOUR FOLDERS HERE ---
BASE_PATHS = {
    'Linux': {
        'steve-calla': Path('/home/steve-calla/development/usat/data'),
        'usat-server': Path('/home/usat-server/development/usat/data'),
        'default':     Path('/home/other-user/development/usat/data'),
    },
    'Darwin': Path('/Users/teamkwsc/development/usat/data'),
    'Windows': Path(r'C:\ProgramData\MySQL\MySQL Server 8.0\Uploads\data'),
}

def get_os_path(subfolder: str = "usat_data") -> Path:
    """
    Picks the right base folder for your platform/user and appends the given subfolder.
    """
    os_name = platform.system()  # 'Linux', 'Darwin', or 'Windows'
    if os_name == 'Linux':
        user = getpass.getuser()
        base = BASE_PATHS['Linux'].get(user, BASE_PATHS['Linux']['default'])
    elif os_name in ('Darwin', 'Windows'):
        base = BASE_PATHS[os_name]
    else:
        raise RuntimeError(f"Unsupported OS: {os_name}")
    
    full_path = base / subfolder  # replaces hardcoded final directory

    # print(f"directory: {subfolder}")
    # print(f"full path: {full_path}")

    return full_path

def get_output_path(directory: str = "test"):
    path = get_os_path(directory)
    path.mkdir(parents=True, exist_ok=True)
    return path

def archive_prior_output(directory: str = "test"):
    path = get_os_path(directory)
    archive_old = path.exists()  # True or false; Automatically archive if directory already exists

    if archive_old:
        archive_path = get_os_path(f"{directory}_archive")
        archive_path.mkdir(parents=True, exist_ok=True)

        # Clear existing archive directory
        for file in archive_path.glob("*"):
            if file.is_file():
                file.unlink()

        # Move current files to archive
        for file in path.glob("*"):
            if file.is_file():
                shutil.move(str(file), archive_path / file.name)

    return

# Argument parsing helpers
def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--month",
        type=int,
        choices=range(1, 13),
        default=datetime.datetime.now().month,
        help="Analysis month as an integer between 1 (January) and 12 (December). Defaults to current month."
    )
    return parser.parse_args()

def get_month_info(month_number):
    month_name = calendar.month_name[month_number]
    return month_number, month_name

# get_data_path()
# get_output_path()


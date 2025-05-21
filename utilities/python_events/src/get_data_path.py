import platform
import getpass
from pathlib import Path
import pandas as pd

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

def get_data_path(subfolder: str = "usat_data") -> Path:
    """
    Picks the right base folder for your platform/user and appends the given subfolder.
    """
    os_name = platform.system()  # 'Linux', 'Darwin', or 'Windows'
    if os_name == 'Linux':
        user = getpass.getuser()
        base = BASE_PATHS['Linux'].get(useqr, BASE_PATHS['Linux']['default'])
    elif os_name in ('Darwin', 'Windows'):
        base = BASE_PATHS[os_name]
    else:
        raise RuntimeError(f"Unsupported OS: {os_name}")
    
    full_path = base / subfolder  # replaces hardcoded final directory

    # print(f"directory: {subfolder}")
    # print(f"full path: {full_path}")

    return full_path

# get_data_path()

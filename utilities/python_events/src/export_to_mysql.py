import os
import pandas as pd
from sqlalchemy import create_engine
from dotenv import load_dotenv

# NOTE: STEP #1: GET .ENV VARIABLES
dotenv_path = os.path.abspath('../../../.env')
load_dotenv(dotenv_path=dotenv_path)
# print("Resolved .env path:", dotenv_path)
# print("File exists:", os.path.exists(dotenv_path))

# --- Get credentials from environment ---
MYSQL_HOST = os.getenv("LOCAL_HOST")
MYSQL_PORT = os.getenv("MYSQL_PORT", "3306")
MYSQL_USER = os.getenv("LOCAL_MYSQL_USER")
MYSQL_PASSWORD = os.getenv("LOCAL_MYSQL_PASSWORD")
MYSQL_DB = os.getenv("LOCAL_USAT_SALES_DB")

# --- Build the SQLAlchemy URL ---
# mysql_url = "mysql+pymysql://USERNAME:PASSWORD@HOST:3306/DATABASE"   # <--- edit this
mysql_url = f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DB}"

# NOTE: STEP #2: RUN FUNCTION TO PUSH DATA TO MYSQL
def push_df_to_mysql(df, table_name):
    """Push DataFrame to MySQL, replacing the table if it exists."""
    engine = create_engine(mysql_url)
    df.to_sql(table_name, con=engine, if_exists='replace', index=False, chunksize=1000)
    print(f"Pushed {len(df)} rows to MySQL table '{table_name}'")

# NOTE: ---- TEST DATA ----
# test_data = pd.DataFrame({
#     "ApplicationID": [1001, 1002, 1003],
#     "Name": ["Dallas Tri", "Frisco Tri", "Austin Du"],
#     "StartDate": ["2025-05-01", "2025-06-15", "2025-08-10"],
#     "Status": ["approved", "cancelled", "approved"],
#     "Value": [500, 200, 300],
# })
# ---- TEST TABLE NAME ----
# table_name = "test_python_table"

# ---- TEST RUN THE PUSH ----
# push_df_to_mysql(test_data, table_name)



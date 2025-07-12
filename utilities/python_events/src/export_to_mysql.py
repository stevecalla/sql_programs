import os
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, String

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
def push_df_to_mysql(df, zip_col_candidates, table_name):
    """Push DataFrame to MySQL, replacing the table if it exists."""

    engine = create_engine(mysql_url)

    # Only include columns that actually exist in your DataFrame
    dtype = {col: String(5) for col in zip_col_candidates if col in df.columns}
    
    df.to_sql(
        'event_data_metrics_yoy_match',    # table name
        con=engine,                        # your engine
        if_exists='replace',               # replace table if exists
        index=False,                       # don't write DataFrame index as a column
        chunksize=1000,                    # batch insert
        dtype=dtype                        # Safe: only includes present columns
        # dtype={'ZipCode_con': String(10)}  # force zip column as VARCHAR(5)
    )

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



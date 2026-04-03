# Rev Rec History Snapshot README

## Purpose
This process creates monthly history snapshots from `rev_recognition_allocation_data` and stores them in `rev_recognition_allocation_data_history`.

It also provides backup and restore functionality to protect against mistakes during reloads.

The goal is to:
- preview the data
- backup current history (before changes)
- delete and reload a monthly snapshot
- validate the results
- restore if needed

---

## Snapshot Naming
Snapshot versions use this format:

revenue_month_YYYY_MM

Example:
revenue_month_2025_03

Snapshot version is derived directly from:
revenue_year_month

---

## Process Flow

### Step 0: Test Query (optional)

Function:
step_5_test_query()

Query:
SELECT *
FROM rev_recognition_allocation_data
WHERE revenue_year_date = 2025
LIMIT 1;

What it does:
- confirms table access
- ensures queries run successfully

---

### Step 1: Preview the source data

Function:
step_5_query_rev_rec_2025_history_snapshot()

Query:
SELECT
  CURRENT_TIMESTAMP AS as_of_snapshot_date_mtn,
  CONCAT('revenue_month_', REPLACE(revenue_year_month, '-', '_')) AS snapshot_version,
  t.*
FROM rev_recognition_allocation_data t
WHERE revenue_year_date = 2025;

What it does:
- previews rows before inserting
- confirms snapshot_version logic
- validates filters

---

### Step 2: Backup current history table (REQUIRED before changes)

Function:
step_5_query_backup_rev_rec_history_table()

Query:
DROP TABLE IF EXISTS rev_recognition_allocation_data_history_backup;

CREATE TABLE rev_recognition_allocation_data_history_backup AS
SELECT *
FROM rev_recognition_allocation_data_history;

What it does:
- creates a full backup of history
- overwrites previous backup
- provides a restore point if anything goes wrong

---

### Step 3: Delete the snapshot to reload

Function:
step_5_query_delete_rev_rec_history_snapshot(snapshot_version)

Query:
DELETE FROM rev_recognition_allocation_data_history
WHERE snapshot_version = 'revenue_month_2025_03';

What it does:
- removes one snapshot from history
- prevents duplicate inserts
- prepares for clean reload

---

### Step 4: Insert monthly snapshot

Function:
step_5_query_insert_rev_rec_monthly_history_snapshot(revenue_year, revenue_month)

Query:
SELECT
  CURRENT_TIMESTAMP AS as_of_snapshot_date_mtn,
  CONCAT('revenue_month_', REPLACE(revenue_year_month, '-', '_')) AS snapshot_version,
  t.*
FROM rev_recognition_allocation_data t
WHERE revenue_year_date = <YEAR>
  AND revenue_month_date = <MONTH>;

Behavior:
- if revenue_year and revenue_month are provided → uses them
- if not provided → defaults to prior month

What it does:
- inserts one month of data into history
- derives snapshot_version from source data
- ensures consistency between data and snapshot label

---

### Step 5: Validate history snapshot

Function:
step_5_query_validate_rev_rec_history_snapshot(snapshot_version, revenue_year_date)

Query:
SELECT 
  snapshot_version,
  as_of_snapshot_date_mtn,
  revenue_year_date,
  FORMAT(COUNT(*), 0) AS count_rows,
  FORMAT(SUM(monthly_revenue), 3) AS total_monthly_revenue
FROM rev_recognition_allocation_data_history
WHERE snapshot_version = 'revenue_month_2025_03'
  AND revenue_year_date = 2025
GROUP BY 1, 2, 3;

What it does:
- confirms row counts
- confirms revenue totals
- validates insert success

---

### Step 6: Validate source data (compare)

Function:
step_5_query_validate_rev_rec_source_month(revenue_year, revenue_month)

Query:
SELECT 
  FORMAT(COUNT(*), 0) AS count_rows,
  FORMAT(SUM(monthly_revenue), 3) AS total_monthly_revenue
FROM rev_recognition_allocation_data
WHERE revenue_year_date = 2025
  AND revenue_month_date = 3;

What it does:
- summarizes source data
- used to compare with history
- ensures data integrity

---

### Step 7: Restore full history table (if needed)

Function:
step_5_query_restore_rev_rec_history_table_from_backup()

Query:
DELETE FROM rev_recognition_allocation_data_history;

INSERT INTO rev_recognition_allocation_data_history
SELECT *
FROM rev_recognition_allocation_data_history_backup;

What it does:
- fully restores history table from backup
- use when major issues occur

---

### Step 8: Restore one snapshot (preferred recovery)

Function:
step_5_query_restore_rev_rec_history_snapshot_from_backup(snapshot_version)

Query:
DELETE FROM rev_recognition_allocation_data_history
WHERE snapshot_version = 'revenue_month_2025_03';

INSERT INTO rev_recognition_allocation_data_history
SELECT *
FROM rev_recognition_allocation_data_history_backup
WHERE snapshot_version = 'revenue_month_2025_03';

What it does:
- restores a single month from backup
- safer than full table restore
- recommended for most fixes

---

## Recommended Workflow

### Normal Monthly Load
1. Preview data  
2. Backup history  
3. Delete snapshot  
4. Insert snapshot  
5. Validate history  
6. Validate source  
7. Compare results  

---

### If a Mistake Occurs
1. Delete bad snapshot  
2. Restore snapshot from backup  
3. Validate  

---

## Key Rule

BACKUP → DELETE → INSERT → VALIDATE

---

## Summary

This process provides:
- clean monthly snapshots
- controlled reruns
- protection against user mistakes
- simple recovery options

Always run backup before making changes.
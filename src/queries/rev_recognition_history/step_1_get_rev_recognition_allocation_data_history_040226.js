// ============================================================
// REV REC HISTORY SNAPSHOT + BACKUP / RESTORE QUERIES
// ============================================================
// PURPOSE:
// - Create monthly snapshots from rev_recognition_allocation_data
// - Store in rev_recognition_allocation_data_history
// - Prevent duplicates via delete → insert pattern
// - Protect against mistakes with backup / restore queries
// - Validate history vs source


// ============================================================
// STEP 0: TEST QUERY
// ============================================================
// - Ensures source table can be queried

function step_1_test_query() {
    return `
        SELECT
            *
        FROM rev_recognition_allocation_data AS t
        WHERE 1 = 1
            AND revenue_year_date = 2025
        LIMIT 1
        ;
    `;
}

// ============================================================
// STEP 1: 2025 History Baseline
// ============================================================
// - Inspect rows before inserting into history
// - Confirms snapshot_version and filters

function step_1_query_rev_rec_2025_history_snapshot() {
    return `
        SELECT
            CURRENT_TIMESTAMP AS as_of_snapshot_date_mtn,
            CONCAT('revenue_month_', REPLACE(revenue_year_month, '-', '_')) AS snapshot_version,
            t.*
        FROM rev_recognition_allocation_data AS t
        WHERE 1 = 1
            AND revenue_year_date = 2025
            -- AND new_member_category_6_sa <> 'Lifetime'
            -- LIMIT 1000
        ;
    `;
}

// ============================================================
// STEP 2: BACKUP HISTORY TABLE
// ============================================================
// - Run BEFORE delete / reload activity
// - Replaces backup table with current history table
// - Gives a restore point if user makes a mistake

function step_1_query_backup_rev_rec_history_table() {
    return `
        DROP TABLE IF EXISTS rev_recognition_allocation_data_history_backup;

        CREATE TABLE rev_recognition_allocation_data_history_backup AS
        SELECT 
            *
        FROM rev_recognition_allocation_data_history
        ;
    `;
}

// ============================================================
// STEP 3: DELETE SNAPSHOT FROM HISTORY
// ============================================================
// - Removes one snapshot before rerun
// - Prevents duplicate monthly loads

function step_1_query_delete_rev_rec_history_snapshot(snapshot_version) {
    return `
        DELETE FROM rev_recognition_allocation_data_history
        WHERE 1 = 1
            AND snapshot_version = '${snapshot_version}'
            -- AND snapshot_version LIKE 'revenue_month_2025%'
        ;
    `;
}

// ============================================================
// STEP 4: INSERT MONTHLY SNAPSHOT
// ============================================================
// - Loads one month into history
// - If revenue_year / revenue_month are provided, uses them
// - Otherwise defaults to prior month
// - snapshot_version is derived from revenue_year_month in source data

function step_1_query_insert_rev_rec_monthly_history_snapshot(created_at_mtn, created_at_utc, QUERY_OPTIONS) {

    const { history_revenue_year, history_revenue_month } = QUERY_OPTIONS;

    const use_provided_values =
        history_revenue_year !== null &&
        history_revenue_year !== undefined &&
        history_revenue_month !== null &&
        history_revenue_month !== undefined;

    const snapshot_year = use_provided_values
        ? history_revenue_year
        : `YEAR(CURDATE() - INTERVAL 1 MONTH)`;

    const snapshot_month = use_provided_values
        ? history_revenue_month
        : `MONTH(CURDATE() - INTERVAL 1 MONTH)`;

    return `
        SELECT
            CURRENT_TIMESTAMP AS as_of_snapshot_date_mtn,
            CONCAT('revenue_month_', REPLACE(revenue_year_month, '-', '_')) AS snapshot_version,
            t.*
        FROM rev_recognition_allocation_data AS t
        WHERE 1 = 1
            AND revenue_year_date = ${snapshot_year}
            AND revenue_month_date = ${snapshot_month}
        ;
    `;
}

// ============================================================
// STEP 4 (v2): INSERT MONTHLY SNAPSHOT (SKIP IF EXISTS)
// ============================================================
// PURPOSE:
// - Builds a monthly snapshot from rev_recognition_allocation_data
// - Generates a consistent snapshot_version (e.g., revenue_month_2026_03)
// - Checks if that snapshot_version already exists in history
// - Returns rows ONLY if the snapshot does NOT already exist
//
// BEHAVIOR:
// - If snapshot exists in history → returns 0 rows (skip load)
// - If snapshot does not exist → returns full dataset for insert
//
// NOTE:
// - Existence check is at the snapshot level (not row-level)
// - Assumes snapshot_version is indexed in history for performance

function step_1_query_insert_rev_rec_monthly_history_snapshot_v2(created_at_mtn, created_at_utc, QUERY_OPTIONS) {

    const { history_revenue_year, history_revenue_month, use_year_where_statement } = QUERY_OPTIONS;

    // Determine whether to use provided year/month or default to prior month
    const use_provided_values =
        history_revenue_year !== null &&
        history_revenue_year !== undefined &&
        history_revenue_month !== null &&
        history_revenue_month !== undefined;

    const snapshot_year = use_provided_values
        ? history_revenue_year
        : `YEAR(CURDATE() - INTERVAL 1 MONTH)`;

    const snapshot_month = use_provided_values
        ? history_revenue_month
        : `MONTH(CURDATE() - INTERVAL 1 MONTH)`;

    const where_statement_by_2025 = `AND t.revenue_year_date = 2025`;

    const where_statement_by_month = `
        AND t.revenue_year_date = ${snapshot_year}
        AND t.revenue_month_date = ${snapshot_month}
    `;

    const where_statement = use_year_where_statement ? where_statement_by_2025 : where_statement_by_month;

    return `
        -- Step 1: Build the target snapshot for the given month
        WITH target_snapshot AS (
            SELECT
                CURRENT_TIMESTAMP AS as_of_snapshot_date_mtn,

                -- Standardized snapshot identifier (e.g., revenue_month_2026_03)
                CONCAT('revenue_month_', REPLACE(t.revenue_year_month, '-', '_')) AS snapshot_version,

                -- All source fields
                t.*
            FROM rev_recognition_allocation_data AS t
            WHERE 1 = 1
                ${where_statement}
        )

        -- Step 2: Only return rows if this snapshot does NOT already exist in history
        SELECT
            *
        FROM target_snapshot ts
        WHERE NOT EXISTS (
            SELECT 1
            FROM rev_recognition_allocation_data_history h
            WHERE h.snapshot_version = ts.snapshot_version
        )
        ;
    `;
}

// ============================================================
// STEP 5: VALIDATE SOURCE & HISTORY SNAPSHOT
// ============================================================
// - Summarizes one snapshot in history
// - Used after insert or restore

function step_1_query_validate_rev_rec_history_snapshot() {
    return `
        SELECT 
            'rev_recognition_allocation_data' AS source,
            revenue_year_date,
            FORMAT(COUNT(*), 0) AS count_rows,
            FORMAT(SUM(monthly_revenue) / COUNT(*), 3) AS avg_monthly_revenue,
            FORMAT(SUM(monthly_revenue), 3) AS total_monthly_revenue,
            FORMAT(SUM(monthly_revenue_less_deduction), 3) AS total_monthly_revenue_less_deduction
        FROM rev_recognition_allocation_data
        WHERE 1 = 1
            -- AND revenue_year_date = 2025
            AND revenue_year_date = 2026
            AND revenue_month_date = 3
        GROUP BY 2

        UNION ALL

        SELECT 
            'rev_recognition_allocation_data_history' AS source,
            revenue_year_date,
            FORMAT(COUNT(*), 0) AS count_rows,
            FORMAT(SUM(monthly_revenue) / COUNT(*), 3) AS avg_monthly_revenue,
            FORMAT(SUM(monthly_revenue), 3) AS total_monthly_revenue,
            FORMAT(SUM(monthly_revenue_less_deduction), 3) AS total_monthly_revenue_less_deduction
        FROM rev_recognition_allocation_data_history
        WHERE 1 = 1
            -- AND revenue_year_date = 2025
            AND revenue_year_date = 2026
            AND revenue_month_date = 3
        GROUP BY 2

        ORDER BY 2;
    `;
}

// ============================================================
// STEP 7: RESTORE FULL HISTORY TABLE FROM BACKUP
// ============================================================
// - Replaces current history table contents with backup table
// - Use only if a full rollback is needed

function step_1_query_restore_rev_rec_history_table_from_backup() {
    return `
        DELETE FROM rev_recognition_allocation_data_history;

        INSERT INTO rev_recognition_allocation_data_history
        SELECT *
        FROM rev_recognition_allocation_data_history_backup
        ;
    `;
}

// ============================================================
// STEP 8: RESTORE ONE SNAPSHOT FROM BACKUP
// ============================================================
// - Deletes one snapshot from history
// - Re-inserts that snapshot from backup
// - Safer than restoring the full table when only one month is affected

function step_1_query_restore_rev_rec_history_snapshot_from_backup(snapshot_version) {
    return `
        DELETE FROM rev_recognition_allocation_data_history
        WHERE 1 = 1
            AND snapshot_version = '${snapshot_version}'
        ;

        INSERT INTO rev_recognition_allocation_data_history
        SELECT *
        FROM rev_recognition_allocation_data_history_backup
        WHERE 1 = 1
            AND snapshot_version = '${snapshot_version}'
        ;
    `;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    step_1_test_query,
    step_1_query_rev_rec_2025_history_snapshot,

    step_1_query_backup_rev_rec_history_table,
    step_1_query_delete_rev_rec_history_snapshot,

    step_1_query_insert_rev_rec_monthly_history_snapshot,
    step_1_query_insert_rev_rec_monthly_history_snapshot_v2,

    step_1_query_validate_rev_rec_history_snapshot,

    step_1_query_restore_rev_rec_history_table_from_backup,
    step_1_query_restore_rev_rec_history_snapshot_from_backup,
};
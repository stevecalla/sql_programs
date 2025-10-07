const sales_data_table = 'all_membership_sales_data_2015_left';
const deleted_profiles_table_name = 'all_membership_sales_data_deleted_profiles';
const audit_table_name = 'all_membership_sales_deleted_profiles_audit';

const query_alter_drop_deleted_profiles = `
        -- 0) Quick sanity check
            SELECT 'staging_count' AS label, FORMAT(COUNT(*), 0) AS count_rows
            FROM all_membership_sales_data_deleted_profiles;

        -- 2) Preview impact on sales table
            SELECT 'candidate_sales_rows' AS label, FORMAT(COUNT(*), 0) AS rows_to_delete
            FROM all_membership_sales_data_2015_left s
            JOIN all_membership_sales_data_deleted_profiles d ON d.id_profiles = s.id_profiles;

        -- Optional sample
            SELECT 'sample_rows' AS label, s.id_profiles, s.id_membership_periods_sa, d.deleted_at_profile
            FROM all_membership_sales_data_2015_left s
            JOIN all_membership_sales_data_deleted_profiles d ON d.id_profiles = s.id_profiles
            ORDER BY s.id_profiles
            LIMIT 5;

        -- 3) Create audit table mirroring SALES (not the staging table)
            CREATE TABLE IF NOT EXISTS all_membership_sales_deleted_profiles_audit
            LIKE all_membership_sales_data_2015_left;

        -- === Guard: add columns if missing (portable) ===
        -- audit_deleted_on
            SET @col_exists := (
                SELECT 
                    COUNT(*) FROM information_schema.columns
                WHERE table_schema = DATABASE()
                    AND table_name = 'all_membership_sales_deleted_profiles_audit'
                    AND column_name = 'audit_deleted_on'
                );
                SET @sql := IF(@col_exists = 0,
                'ALTER TABLE all_membership_sales_deleted_profiles_audit ADD COLUMN audit_deleted_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
                'SELECT "audit_deleted_on exists" AS info'
                );
            PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

        -- audit_deleted_reason
            SET @col_exists := (
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = DATABASE()
                AND table_name = 'all_membership_sales_deleted_profiles_audit'
                AND column_name = 'audit_deleted_reason'
            );
            SET @sql := IF(@col_exists = 0,
            'ALTER TABLE all_membership_sales_deleted_profiles_audit ADD COLUMN audit_deleted_reason VARCHAR(255) NULL',
            'SELECT "audit_deleted_reason exists" AS info'
            );
            PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

        -- deleted_at_profile
            SET @col_exists := (
                SELECT 
                    COUNT(*) 
                FROM information_schema.columns
                WHERE table_schema = DATABASE()
                    AND table_name = 'all_membership_sales_deleted_profiles_audit'
                    AND column_name = 'deleted_at_profile'
                );
                SET @sql := IF(@col_exists = 0,
                'ALTER TABLE all_membership_sales_deleted_profiles_audit ADD COLUMN deleted_at_profile DATETIME NULL',
                'SELECT "deleted_at_profile exists" AS info'
                );
            PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

        -- 4) Archive + Delete atomically
            START TRANSACTION;

            -- Archive candidates
            INSERT INTO all_membership_sales_deleted_profiles_audit
            SELECT s.*,
                    NOW() AS audit_deleted_on,
                    'profile_deleted' AS audit_deleted_reason,
                    d.deleted_at_profile
            FROM all_membership_sales_data_2015_left s
            JOIN all_membership_sales_data_deleted_profiles d ON d.id_profiles = s.id_profiles;

            SELECT 'archived_rows' AS label, FORMAT(ROW_COUNT(), 0) AS rows_archived;

            -- Gate: ensure candidates still match
            SELECT COUNT(*) AS candidate_rows_before_delete
            FROM all_membership_sales_data_2015_left s
            JOIN all_membership_sales_data_deleted_profiles d ON d.id_profiles = s.id_profiles;

            -- Delete
            DELETE s
            FROM all_membership_sales_data_2015_left s
            JOIN all_membership_sales_data_deleted_profiles d ON d.id_profiles = s.id_profiles;

            SELECT ROW_COUNT() AS rows_deleted;

        COMMIT;

        -- 5) Post-checks
        SELECT 
            'remaining_candidates_post_delete' AS label, COUNT(*) AS remaining
        FROM all_membership_sales_data_2015_left s
        JOIN all_membership_sales_data_deleted_profiles d ON d.id_profiles = s.id_profiles;

        SELECT 'finished' AS status, NOW() AS finished_at;
`;

module.exports = { 
    query_alter_drop_deleted_profiles,
};
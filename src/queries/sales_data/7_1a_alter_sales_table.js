// Source Query: C:\Users\calla\development\usat\sql_code\25_member_sales_ad_hoc_updates\update_member_sales_ticketsocket_23_v_28_092425.sql

const { id_group_1, id_group_2, id_group_3 } = require("./7_1a_alter_sales_table_ids/alter_sales_table_ids");

const query_alter_sales_table = `
    /* 1) Create table of the IDs */
        DROP TABLE IF EXISTS all_membership_sales_bad_ticket_socket_price;

        CREATE TABLE IF NOT EXISTS all_membership_sales_bad_ticket_socket_price (
        id_membership_periods_sa BIGINT PRIMARY KEY,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=MEMORY;

    -- /* 2) Populate it using values list */
        INSERT INTO all_membership_sales_bad_ticket_socket_price (id_membership_periods_sa)
        VALUES
            ${id_group_1}
        ;

        INSERT INTO all_membership_sales_bad_ticket_socket_price (id_membership_periods_sa)
        VALUES
            ${id_group_2}
        ;

        INSERT INTO all_membership_sales_bad_ticket_socket_price (id_membership_periods_sa)
        VALUES
            ${id_group_3}
        ;

        -- check count of total rows
        SELECT 
            "sample record" AS query_label, 
            s.* 
        FROM all_membership_sales_bad_ticket_socket_price AS s 
        LIMIT 1
        ;
        SELECT 
            "check count of records" AS query_label,
            FORMAT(COUNT(*), 0), 
            FORMAT(6836, 0) AS "required_records", 
            CASE WHEN COUNT(*) - 6836 = 0 THEN "CHECK" ELSE "NO CHECK" END AS verify 
        FROM all_membership_sales_bad_ticket_socket_price AS s
        ;
    
        -- 3) Match against all membership table; 
        -- skip step as index added to all_membership_sales_data_2015_left table creation 
            -- ALTER TABLE all_membership_sales_data_2015_left
                -- ADD KEY idx_id_membership_periods_sa (id_membership_periods_sa)

        -- Verify that all records are at 23
            SELECT 
                "Verify that all records are at 23" AS query_label,
                ts.id_membership_periods_sa,
                s.id_membership_periods_sa, 
                s.actual_membership_fee_6_sa, 
                s.actual_membership_fee_6_rule_sa 
            FROM all_membership_sales_bad_ticket_socket_price AS ts
                LEFT JOIN all_membership_sales_data_2015_left AS s ON s.id_membership_periods_sa = ts.id_membership_periods_sa
            WHERE 1 = 1
                AND s.actual_membership_fee_6_sa = 23
                -- AND s.actual_membership_fee_6_sa = 28
            LIMIT 1
            ;

        /* 3a) Update price (only rows currently at 23) */
        /* --- Optional: preview what will change --- */
            SELECT 
                "count of rows to change" AS query_label,
                COUNT(*) AS rows_to_change
            FROM all_membership_sales_data_2015_left s
                JOIN all_membership_sales_bad_ticket_socket_price AS ts USING (id_membership_periods_sa)
            WHERE s.actual_membership_fee_6_sa = 23
            ;

        -- 4) Update records
            START TRANSACTION;

                -- 1) Show the current minimum before update
                SELECT MIN(s2.actual_membership_fee_6_sa) AS min_fee_before
                FROM all_membership_sales_data_2015_left s2
                JOIN all_membership_sales_bad_ticket_socket_price ts2 USING (id_membership_periods_sa);

                -- 2) Show how many rows are candidates (currently = 23)
                SELECT COUNT(*) AS candidate_rows
                FROM all_membership_sales_data_2015_left s2
                JOIN all_membership_sales_bad_ticket_socket_price ts2 USING (id_membership_periods_sa)
                WHERE s2.actual_membership_fee_6_sa = 23;

                -- 3) Perform the gated update; Only update if min price is < $28 (should be $23)
                WITH stats AS (
                    SELECT MIN(s2.actual_membership_fee_6_sa) AS min_fee
                    FROM all_membership_sales_data_2015_left s2
                    JOIN all_membership_sales_bad_ticket_socket_price ts2 USING (id_membership_periods_sa)
                )
                    UPDATE all_membership_sales_data_2015_left s
                    JOIN all_membership_sales_bad_ticket_socket_price ts USING (id_membership_periods_sa)
                    JOIN stats ON stats.min_fee < 28   -- gate: only update if MIN < 28
                    SET s.actual_membership_fee_6_sa = 28,
                        s.actual_membership_fee_6_rule_sa = 'manually modified by s. calla'
                    WHERE s.actual_membership_fee_6_sa = 23;

                -- 4) Tell you how many rows were changed
                SELECT ROW_COUNT() AS rows_changed;

                -- 5) Show the new minimum and a sample of updated rows
                SELECT 
                    MIN(s2.actual_membership_fee_6_sa) AS min_fee_after
                FROM all_membership_sales_data_2015_left s2
                JOIN all_membership_sales_bad_ticket_socket_price ts2 USING (id_membership_periods_sa);

                SELECT 
                    s.id_membership_periods_sa, s.actual_membership_fee_6_sa, s.actual_membership_fee_6_rule_sa
                FROM all_membership_sales_data_2015_left s
                JOIN all_membership_sales_bad_ticket_socket_price ts USING (id_membership_periods_sa)
                ORDER BY s.id_membership_periods_sa
                LIMIT 2;

            COMMIT;
            
            /* --- Optional: verify a few rows --- */
            SELECT 
                "verify records changed" AS query_label,
                id_membership_periods_sa, 
                actual_membership_fee_6_sa, 
                actual_membership_fee_6_rule_sa,
                COUNT(*) OVER () AS row_count   -- ✅ adds row count at the first column 
            FROM all_membership_sales_data_2015_left s
                JOIN all_membership_sales_bad_ticket_socket_price AS ts USING (id_membership_periods_sa)
            WHERE actual_membership_fee_6_sa = 23
            LIMIT 2
            ;    
`;

module.exports = { 
    query_alter_sales_table,
};
[1mdiff --git a/src/google_cloud/queries/query_member_data.js b/src/google_cloud/queries/query_member_data.js[m
[1mindex 20a9a5d..0c1a724 100644[m
[1m--- a/src/google_cloud/queries/query_member_data.js[m
[1m+++ b/src/google_cloud/queries/query_member_data.js[m
[36m@@ -146,10 +146,11 @@[m [masync function query_member_data(batch_size = 10, offset = 0) {[m
             region_name_events,[m
             region_abbr_events,[m
 [m
[31m-            -- OTHER -- todo:[m
[32m+[m[32m            -- OTHER --[m
             DATE_FORMAT(created_at_ma, '%Y-%m-%d %H:%i:%s') AS created_at_ma,[m
             order_id_orders_products,[m
             id_registration_audit,[m
[32m+[m[32m            confirmation_number_registration_audit,[m
             name_registration_companies,[m
 [m
             DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn, -- date '2024-02-12'        [m
[1mdiff --git a/src/google_cloud/queries/query_rev_recognition_base_data.js b/src/google_cloud/queries/query_rev_recognition_base_data.js[m
[1mindex 04ea915..6265346 100644[m
[1m--- a/src/google_cloud/queries/query_rev_recognition_base_data.js[m
[1m+++ b/src/google_cloud/queries/query_rev_recognition_base_data.js[m
[36m@@ -62,8 +62,12 @@[m [masync function query_rev_recognition_base_data(batch_size = 10, offset = 0) {[m
             [m
             is_youth_premier,[m
             is_lifetime,[m
[32m+[m[41m     [m
[32m+[m[32m            upgraded_from_id_mp,[m
[32m+[m[32m            upgraded_to_id_mp,[m
[32m+[m[32m            has_upgrade_from_or_to_path,[m
 [m
[31m-             has_created_at_gt_purchased_on,[m
[32m+[m[32m            has_created_at_gt_purchased_on,[m
 [m
             actual_membership_fee_6_rule_sa,[m
             sales_revenue,[m
[1mdiff --git a/src/google_cloud/schemas/schema_member_data.js b/src/google_cloud/schemas/schema_member_data.js[m
[1mindex 77ca354..a2992c3 100644[m
[1m--- a/src/google_cloud/schemas/schema_member_data.js[m
[1m+++ b/src/google_cloud/schemas/schema_member_data.js[m
[36m@@ -693,6 +693,13 @@[m [mconst members_schema = [[m
         "description": null,[m
         "fields": [][m
     },[m
[32m+[m[32m    {[m
[32m+[m[32m        "name": "confirmation_number_registration_audit",[m
[32m+[m[32m        "mode": "NULLABLE",[m
[32m+[m[32m        "type": "STRING",[m
[32m+[m[32m        "description": null,[m
[32m+[m[32m        "fields": [][m
[32m+[m[32m    },[m
     {[m
         "name": "name_registration_companies",[m
         "mode": "NULLABLE",[m
[1mdiff --git a/src/google_cloud/schemas/schema_rev_recognition_base_data.js b/src/google_cloud/schemas/schema_rev_recognition_base_data.js[m
[1mindex 7a69f61..54ea5b7 100644[m
[1m--- a/src/google_cloud/schemas/schema_rev_recognition_base_data.js[m
[1m+++ b/src/google_cloud/schemas/schema_rev_recognition_base_data.js[m
[36m@@ -299,6 +299,27 @@[m [mconst rev_recognition_base_data_schema = [[m
     description: "1 if lifetime membership",[m
     fields: [][m
   },[m
[32m+[m[32m  {[m
[32m+[m[32m    name: "upgraded_from_id_mp",[m
[32m+[m[32m    mode: "NULLABLE",[m
[32m+[m[32m    type: "INTEGER",[m
[32m+[m[32m    description: "Id of the membership upgraded from",[m
[32m+[m[32m    fields: [][m
[32m+[m[32m  },[m
[32m+[m[32m  {[m
[32m+[m[32m    name: "upgraded_to_id_mp",[m
[32m+[m[32m    mode: "NULLABLE",[m
[32m+[m[32m    type: "INTEGER",[m
[32m+[m[32m    description: "Id of the membership upgraded to",[m
[32m+[m[32m    fields: [][m
[32m+[m[32m  },[m
[32m+[m[32m  {[m
[32m+[m[32m    name: "has_upgrade_from_or_to_path",[m
[32m+[m[32m    mode: "NULLABLE",[m
[32m+[m[32m    type: "INTEGER",[m
[32m+[m[32m    description: "Has eithre an upgrade from or upgrade to id",[m
[32m+[m[32m    fields: [][m
[32m+[m[32m  },[m
   {[m
     name: "has_created_at_gt_purchased_on",[m
     mode: "NULLABLE",[m
[1mdiff --git a/src/queries/create_drop_db_table/query_create_rev_recognition_base_table.js b/src/queries/create_drop_db_table/query_create_rev_recognition_base_table.js[m
[1mindex bca061d..d10442e 100644[m
[1m--- a/src/queries/create_drop_db_table/query_create_rev_recognition_base_table.js[m
[1m+++ b/src/queries/create_drop_db_table/query_create_rev_recognition_base_table.js[m
[36m@@ -65,6 +65,10 @@[m [mconst flags = `[m
   is_youth_premier INT,[m
   is_lifetime INT,[m
 [m
[32m+[m[32m  upgraded_from_id_mp INT,[m
[32m+[m[32m  upgraded_to_id_mp INT,[m
[32m+[m[32m  has_upgrade_from_or_to_path INT,[m
[32m+[m
   has_created_at_gt_purchased_on INT,[m
 `;[m
 [m
[1mdiff --git a/src/queries/create_drop_db_table/query_create_sales_table.js b/src/queries/create_drop_db_table/query_create_sales_table.js[m
[1mindex 464bef7..c8b4de7 100644[m
[1m--- a/src/queries/create_drop_db_table/query_create_sales_table.js[m
[1m+++ b/src/queries/create_drop_db_table/query_create_sales_table.js[m
[36m@@ -184,6 +184,7 @@[m [mconst orders_products_table = `[m
 const registration_audit_table = `[m
   -- REGISTRATION AUDIT[m
   id_registration_audit INT,[m
[32m+[m[32m  confirmation_number_registration_audit VARCHAR(255),[m
   date_of_birth_registration_audit DATE,[m
 `;[m
 [m
[36m@@ -211,6 +212,7 @@[m [mconst index_fields = `[m
   INDEX idx_id_events (id_events),[m
   INDEX idx_name_events (name_events),[m
   INDEX idx_name_events_starts_events (name_events, starts_events),[m
[32m+[m[32m  INDEX idx_upgrade_chain (upgraded_from_id_mp, id_membership_periods_sa),[m
   [m
   INDEX idx_real_membership_types (real_membership_types_sa),[m
   INDEX idx_new_member_category_6 (new_member_category_6_sa),[m
[1mdiff --git a/src/queries/load_data/query_load_sales_data.js b/src/queries/load_data/query_load_sales_data.js[m
[1mindex 7ca4284..43eac6e 100644[m
[1m--- a/src/queries/load_data/query_load_sales_data.js[m
[1m+++ b/src/queries/load_data/query_load_sales_data.js[m
[36m@@ -184,6 +184,7 @@[m [mconst orders_products_table = `[m
 const registration_audit_table = `[m
     -- REGISTRATION AUDIT[m
     id_registration_audit,[m
[32m+[m[32m    confirmation_number_registration_audit,[m
     @date_of_birth_registration_audit, [m
 `;[m
 [m
[1mdiff --git a/src/queries/rev_recognition/step_1_get_rev_recognition_base_data_050325.js b/src/queries/rev_recognition/step_1_get_rev_recognition_base_data_050325.js[m
[1mindex 87ed4a1..df4b7c6 100644[m
[1m--- a/src/queries/rev_recognition/step_1_get_rev_recognition_base_data_050325.js[m
[1m+++ b/src/queries/rev_recognition/step_1_get_rev_recognition_base_data_050325.js[m
[36m@@ -84,6 +84,14 @@[m [mfunction step_1_query_rev_recognition_data(created_at_mtn, created_at_utc, QUERY[m
         CASE WHEN a.new_member_category_6_sa LIKE "%Youth Premier%" THEN 1 ELSE 0 END AS is_youth_premier,[m
         CASE WHEN a.new_member_category_6_sa = 'Lifetime' THEN 1 ELSE 0 END AS is_lifetime,[m
 [m
[32m+[m[32m        a.upgraded_from_id_mp,[m
[32m+[m[32m        b.upgraded_to_id_mp,[m
[32m+[m[32m        CASE[m[41m [m
[32m+[m[32m            WHEN a.upgraded_from_id_mp IS NOT NULL THEN 1[m[41m [m
[32m+[m[32m            WHEN b.upgraded_to_id_mp IS NOT NULL THEN 1[m[41m [m
[32m+[m[32m            ELSE 0[m[41m [m
[32m+[m[32m        END AS has_upgrade_from_or_to_path,[m
[32m+[m
         CASE [m
             WHEN YEAR(a.created_at_mp) > YEAR(a.purchased_on_date_mp)[m
               OR (YEAR(a.created_at_mp) = YEAR(a.purchased_on_date_mp)[m
[36m@@ -100,19 +108,25 @@[m [mfunction step_1_query_rev_recognition_data(created_at_mtn, created_at_utc, QUERY[m
 [m
     FROM all_membership_sales_data_2015_left a[m
       -- INNER JOIN rev_recognition_base_profile_ids_data p ON a.id_profiles = p.id_profiles[m
[31m-      [m
[32m+[m
[32m+[m[32m      LEFT JOIN rev_recognition_base_upgraded_from_ids_data b ON a.id_membership_periods_sa = b.upgraded_from_id_mp[m
[32m+[m
[32m+[m[32m      -- Optional: filter to only the batch you're processing[m
       INNER JOIN ([m
         SELECT [m
           id_profiles[m
         FROM rev_recognition_base_profile_ids_data[m
[32m+[m[32m        WHERE 1 = 1[m
[32m+[m[32m          -- AND id_profiles IN (2599832, 2737677) -- upgraded from / to examples[m
         ORDER BY id_profiles[m
[31m-[m
[32m+[m[41m        [m
         LIMIT ${limit_size} OFFSET ${offset_size}[m
         -- LIMIT 100000 OFFSET 0[m
         [m
       ) p ON a.id_profiles = p.id_profiles[m
 [m
[31m-    ORDER BY a.id_profiles, a.starts_mp;[m
[32m+[m[32m    ORDER BY a.id_profiles, a.starts_mp[m
[32m+[m[32m    ;[m
   `;[m
 }[m
   [m
[1mdiff --git a/src/queries/rev_recognition/step_1a_get_rev_recognition_profile_ids_data_050325.js b/src/queries/rev_recognition/step_1a_get_rev_recognition_profile_ids_data_050325.js[m
[1mindex 336ffa4..6f645fc 100644[m
[1m--- a/src/queries/rev_recognition/step_1a_get_rev_recognition_profile_ids_data_050325.js[m
[1m+++ b/src/queries/rev_recognition/step_1a_get_rev_recognition_profile_ids_data_050325.js[m
[36m@@ -7,9 +7,15 @@[m [mfunction step_1a_query_rev_recognition_profile_ids_data(created_at_mtn, created_[m
             '${created_at_mtn}' AS created_at_mtn,[m
             '${created_at_utc}' AS created_at_utc[m
 [m
[31m-[m
         FROM all_membership_sales_data_2015_left[m
[31m-        WHERE ends_mp >= '${QUERY_OPTIONS.ends_mp}'[m
[32m+[m[32m        WHERE 1 = 1[m
[32m+[m[32m          AND ends_mp >= '${QUERY_OPTIONS.ends_mp}'[m
[32m+[m[41m          [m
[32m+[m[32m        -- TESTING EXAMPLES[m
[32m+[m[32m        -- AND ends_mp = '${QUERY_OPTIONS.ends_mp}'[m
[32m+[m[32m        -- AND id_profiles IN (54, 57, 60) -- basic test examples[m
[32m+[m[32m        -- AND id_profiles IN (2599832, 2737677) -- upgraded from / to examples[m
[32m+[m
         -- LIMIT 7000[m
         ;[m
       `[m
[1mdiff --git a/src/queries/sales_data/6_all_fields_logic.js b/src/queries/sales_data/6_all_fields_logic.js[m
[1mindex 3b464ff..3169ca6 100644[m
[1m--- a/src/queries/sales_data/6_all_fields_logic.js[m
[1m+++ b/src/queries/sales_data/6_all_fields_logic.js[m
[36m@@ -289,6 +289,7 @@[m [mconst orders_products_table = ` -- todo:[m
 const registration_audit_table = ` -- todo:[m
     -- REGISTRATION AUDIT[m
     registration_audit.id AS id_registration_audit,[m
[32m+[m[32m    registration_audit.confirmation_number AS confirmation_number_registration_audit,[m
     registration_audit.date_of_birth AS date_of_birth_registration_audit,[m
 `;[m
 [m
[1mdiff --git a/src/revenue_recognition/step_0_run_recognition_jobs_050325.js b/src/revenue_recognition/step_0_run_recognition_jobs_050325.js[m
[1mindex d6a9f56..82dc75c 100644[m
[1m--- a/src/revenue_recognition/step_0_run_recognition_jobs_050325.js[m
[1m+++ b/src/revenue_recognition/step_0_run_recognition_jobs_050325.js[m
[36m@@ -111,7 +111,7 @@[m [masync function execute_run_recognition_data_jobs() {[m
   return elapsedTime;[m
 }[m
 [m
[31m-// execute_run_recognition_data_jobs();[m
[32m+[m[32mexecute_run_recognition_data_jobs();[m
 [m
 module.exports = {[m
   execute_run_recognition_data_jobs,[m
[1mdiff --git a/src/revenue_recognition/step_1_create_recognition_base_data.js b/src/revenue_recognition/step_1_create_recognition_base_data.js[m
[1mindex 013bb2d..f67d7c7 100644[m
[1m--- a/src/revenue_recognition/step_1_create_recognition_base_data.js[m
[1m+++ b/src/revenue_recognition/step_1_create_recognition_base_data.js[m
[36m@@ -12,6 +12,9 @@[m [mconst { step_1_query_rev_recognition_data } = require('../queries/rev_recognitio[m
 const { query_create_rev_recognition_profile_ids_table } = require('../queries/create_drop_db_table/query_create_rev_recognition_profile_ids_table');[m
 const { step_1a_query_rev_recognition_profile_ids_data } = require('../queries/rev_recognition/step_1a_get_rev_recognition_profile_ids_data_050325');[m
 [m
[32m+[m[32mconst { query_create_rev_recognition_upgraded_from_ids_table } = require('../queries/create_drop_db_table/query_create_rev_recognition_upgraded_from_ids_table');[m
[32m+[m[32mconst { step_1b_query_rev_recognition_upgraded_from_ids_data } = require('../queries/rev_recognition/step_1b_get_rev_recognition_upgraded_from_ids_data_050325')[m
[32m+[m
 // TRANSFER FUNCTION[m
 const { execute_transfer_data_between_tables } = require('../../utilities/transfer_local_data_between_local_tables/1_transfer_data_between_local_tables');[m
 [m
[36m@@ -34,17 +37,29 @@[m [masync function execute_create_recognition_base_data() {[m
     is_create_table: true,[m
   };[m
   [m
[31m-  // Step 1: Create and populate the profile IDs table[m
[31m-  // NOTE: only run is_not_test === true[m
[31m-  if (is_not_test) {[m
[31m-    BATCH_SIZE = 2000;[m
[31m-    TABLE_NAME = 'rev_recognition_base_profile_ids_data';[m
[31m-    CREATE_TABLE_QUERY = await query_create_rev_recognition_profile_ids_table(TABLE_NAME);[m
[31m-    GET_DATA_QUERY = step_1a_query_rev_recognition_profile_ids_data;[m
[31m-[m
[31m-    // CREATE TABLE & GET / TRANSFER DATA[m
[31m-    await execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY, QUERY_OPTIONS);[m
[31m-  }[m
[32m+[m[32m  // // Step 1: Create and populate the profile IDs table[m
[32m+[m[32m  // // NOTE: only run is_not_test === true[m
[32m+[m[32m  // if (is_not_test) {[m
[32m+[m[32m  //   BATCH_SIZE = 2000;[m
[32m+[m[32m  //   TABLE_NAME = 'rev_recognition_base_profile_ids_data';[m
[32m+[m[32m  //   CREATE_TABLE_QUERY = await query_create_rev_recognition_profile_ids_table(TABLE_NAME);[m
[32m+[m[32m  //   GET_DATA_QUERY = step_1a_query_rev_recognition_profile_ids_data;[m
[32m+[m
[32m+[m[32m  //   // CREATE TABLE & GET / TRANSFER DATA[m
[32m+[m[32m  //   await execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY, QUERY_OPTIONS);[m
[32m+[m[32m  // }[m
[32m+[m
[32m+[m[32m  // // Step 1b: Create and populate the upgraded from table[m
[32m+[m[32m  // // NOTE: only run is_not_test === true[m
[32m+[m[32m  // if (is_not_test) {[m
[32m+[m[32m  //   BATCH_SIZE = 2000;[m
[32m+[m[32m  //   TABLE_NAME = 'rev_recognition_base_upgraded_from_ids_data';[m
[32m+[m[32m  //   CREATE_TABLE_QUERY = await query_create_rev_recognition_upgraded_from_ids_table(TABLE_NAME);[m
[32m+[m[32m  //   GET_DATA_QUERY = step_1b_query_rev_recognition_upgraded_from_ids_data;[m
[32m+[m
[32m+[m[32m  //   // CREATE TABLE & GET / TRANSFER DATA[m
[32m+[m[32m  //   await execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY, QUERY_OPTIONS);[m
[32m+[m[32m  // }[m
 [m
   // Step 2: Count number of rows in rev_recognition_base_profile_ids_data[m
   const src = await get_src_connection();[m
[1mdiff --git a/src/sales_data/step_0_run_sales_data_jobs_010425.js b/src/sales_data/step_0_run_sales_data_jobs_010425.js[m
[1mindex b0f7353..ec5bf5a 100644[m
[1m--- a/src/sales_data/step_0_run_sales_data_jobs_010425.js[m
[1m+++ b/src/sales_data/step_0_run_sales_data_jobs_010425.js[m
[36m@@ -21,21 +21,21 @@[m [mconst { execute_load_big_query_actual_vs_goal_metrics} = require('./step_6a_load[m
 [m
 const { slack_message_api } = require('../../utilities/slack_messaging/slack_message_api');[m
 [m
[31m-const run_step_1  = true; // get sales data[m
[31m-const run_step_2  = true; // load sales data[m
[31m-const run_step_2a = true; // load region table[m
[32m+[m[32mconst run_step_1  = false; // get sales data[m
[32m+[m[32mconst run_step_2  = false; // load sales data[m
[32m+[m[32mconst run_step_2a = false; // load region table[m
 [m
 const run_step_3  = true; // create sales key metrics stats table[m
[31m-const run_step_3a = true; // load sales key metrics stats to biqquery[m
[32m+[m[32mconst run_step_3a = false; // load sales key metrics stats to biqquery[m
 [m
[31m-const run_step_4  = true; // create year-over-year common date table[m
[31m-const run_step_4a = true; // load sales key metrics stats to biqquery[m
[32m+[m[32mconst run_step_4  = false; // create year-over-year common date table[m
[32m+[m[32mconst run_step_4a = false; // load sales key metrics stats to biqquery[m
 [m
[31m-const run_step_5  = true; // load sales goal data[m
[31m-const run_step_5a = true; // load sales goals to bigquery[m
[32m+[m[32mconst run_step_5  = false; // load sales goal data[m
[32m+[m[32mconst run_step_5a = false; // load sales goals to bigquery[m
 [m
[31m-const run_step_6  = true; // create actual vs goal data table[m
[31m-const run_step_6a = true; // load actual vs goal to bigquery[m
[32m+[m[32mconst run_step_6  = false; // create actual vs goal data table[m
[32m+[m[32mconst run_step_6a = false; // load actual vs goal to bigquery[m
 [m
 async function executeSteps(stepFunctions, stepName) {[m
   for (let i = 0; i < stepFunctions.length; i++) {[m
[36m@@ -142,7 +142,7 @@[m [masync function execute_run_sales_data_jobs() {[m
   return elapsedTime;[m
 }[m
 [m
[31m-// execute_run_sales_data_jobs();[m
[32m+[m[32mexecute_run_sales_data_jobs();[m
 [m
 module.exports = {[m
   execute_run_sales_data_jobs,[m
[1mdiff --git a/src/sales_data/step_1_get_sales_data.js b/src/sales_data/step_1_get_sales_data.js[m
[1mindex afac925..71b7c55 100644[m
[1m--- a/src/sales_data/step_1_get_sales_data.js[m
[1m+++ b/src/sales_data/step_1_get_sales_data.js[m
[36m@@ -322,7 +322,7 @@[m [masync function execute_get_sales_data() {[m
     let offset = 0;[m
     const retrieval_batch_size = 50000; // Retrieve 50,000 records at a time[m
     const write_batch_size = 5000; // Write 1,000 records at a time[m
[31m-    const start_year = 2010; // Default = 2010[m
[32m+[m[32m    const start_year = 2025; // Default = 2010[m
     const membershipPeriodEnds = '2008-01-01';[m
     const period_interval = 6; // create date periods for 6 month durations; options in include 1 month and 3 months[m
 [m
[1mdiff --git a/utilities/excel_to_markdown/excel_to_markdown.md b/utilities/excel_to_markdown/excel_to_markdown.md[m
[1mindex 76cc698..d657fdd 100644[m
[1m--- a/utilities/excel_to_markdown/excel_to_markdown.md[m
[1m+++ b/utilities/excel_to_markdown/excel_to_markdown.md[m
[36m@@ -276,4 +276,16 @@[m [mAs of 5/2/25[m
 | Youth Race                          | 193    | 195   | 195   | 0           |[m
 | Grand Total                         | 1,106  | 1,120 | 1,125 | 5           |[m
 [m
[32m+[m[32m| Type                | 2024  | 2025  | diff |[m
[32m+[m[32m|---------------------|-------|-------|------|[m
[32m+[m[32m| Adult Race          | 825   | 809   | -16  |[m
[32m+[m[32m| Adult Clinic        | 90    | 83    | -7   |[m
[32m+[m[32m| Youth Race          | 210   | 195   | -15  |[m
[32m+[m[32m| Youth Clinic        | 33    | 29    | -4   |[m
[32m+[m[32m| No Race Designation | 0     | 9     | 9    |[m
[32m+[m[32m| Total               | 1,158 | 1,125 | -33  |[m
[41m+[m
[41m+[m
[41m+[m
[41m+[m
 [m

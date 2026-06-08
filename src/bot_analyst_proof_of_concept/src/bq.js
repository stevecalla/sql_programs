/**
 * bq.js
 * step_1_support: bigquery ping (select 1)
 * step_2_support: deterministic table_count
 * step_3_support: list_sources (tables)
 * step_4_support: membership_ytd
 */

const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });

const { BigQuery } = require("@google-cloud/bigquery");

function clean_project_id(value) {
    return String(value || "")
        .trim()
        .replace(/^['"]+|['"]+$/g, "") // remove wrapping quotes
        .replace(/,+$/g, "");          // remove trailing commas
}

function get_bigquery_client() {
    const project_id_raw = process.env.USAT_BQ_PROJECT_ID;
    const credentials_raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_USAT_AI_BOT_ANALYST;

    if (!project_id_raw) throw new Error("missing USAT_BQ_PROJECT_ID in env");
    if (!credentials_raw) throw new Error("missing GOOGLE_APPLICATION_CREDENTIALS_USAT_AI_BOT_ANALYST in env");

    const project_id = clean_project_id(project_id_raw);

    if (!/^[a-z][a-z0-9-]{5,62}$/.test(project_id)) {
        throw new Error(`invalid USAT_BQ_PROJECT_ID after cleanup: "${project_id}"`);
    }

    let credentials;
    try {
        credentials = JSON.parse(credentials_raw);
    } catch {
        throw new Error("invalid JSON in GOOGLE_APPLICATION_CREDENTIALS_USAT_AI_BOT_ANALYST");
    }

    return new BigQuery({
        projectId: project_id,
        credentials,
    });
}

async function bq_query_one(sql, params = undefined) {
    const bq = get_bigquery_client();

    const [job] = await bq.createQueryJob({
        query: sql,
        location: "US",
        ...(params ? { params } : {}),
    });

    const [rows] = await job.getQueryResults();
    return rows?.[0] || null;
}

async function bq_ping() {
    const row = await bq_query_one("SELECT 1 AS ok");
    return row?.ok === 1;
}

async function bq_test_table_count(dataset_id, table_id) {
    if (!dataset_id || !table_id) throw new Error("missing dataset_id or table_id");

    const safe_identifier = /^[a-zA-Z0-9_-]+$/;
    if (!safe_identifier.test(dataset_id)) throw new Error(`invalid dataset_id: "${dataset_id}"`);
    if (!safe_identifier.test(table_id)) throw new Error(`invalid table_id: "${table_id}"`);

    const bq = get_bigquery_client();
    const project_id = bq.projectId;

    const sql = `
        SELECT COUNT(1) AS row_count
        FROM \`${project_id}.${dataset_id}.${table_id}\`
    `;

    const row = await bq_query_one(sql);
    return Number(row?.row_count || 0);
}

async function bq_list_tables(dataset_id) {
    if (!dataset_id) throw new Error("missing dataset_id");

    const safe_identifier = /^[a-zA-Z0-9_-]+$/;
    if (!safe_identifier.test(dataset_id)) {
        throw new Error(`invalid dataset_id: "${dataset_id}"`);
    }

    const bq = get_bigquery_client();
    const project_id = bq.projectId;

    const sql = `
        SELECT
          table_name,
          table_type
        FROM \`${project_id}.region-us.INFORMATION_SCHEMA.TABLES\`
        WHERE table_schema = @dataset_id
        ORDER BY table_name
    `;

    const [job] = await bq.createQueryJob({
        query: sql,
        location: "US",
        params: { dataset_id },
    });

    const [rows] = await job.getQueryResults();

    return rows.map(r => ({
        table_name: r.table_name,
        table_type: r.table_type,
    }));
}

/**
 * deterministic business metric:
 * - tries to use is_sales_ytd if present
 * - falls back to total unique profiles if not
 */

function bq_value_to_string(v) {
    if (v == null) return null;
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);

    // BigQuery date/timestamp wrappers sometimes come back like { value: 'YYYY-MM-DD' }
    if (typeof v === "object" && typeof v.value === "string") return v.value;

    return String(v);
}

// async function bq_membership_ytd() {
//     const bq = get_bigquery_client();
//     const project_id = bq.projectId;

//     const dataset_id = "membership_reporting";
//     const table_id = "membership_data";

//     // attempt #1: prefer is_sales_ytd filter (most likely what you want)
//     const sql_filtered = `
//         SELECT
//           CURRENT_DATE() AS as_of_date,
//           COUNT(DISTINCT id_profiles) AS unique_profiles
//         FROM \`${project_id}.${dataset_id}.${table_id}\`
//         -- WHERE is_sales_ytd = TRUE
//     `;

//     try {
//         const row = await bq_query_one(sql_filtered);

//         const results = {
//             dataset_id,
//             table_id,
//             metric_scope: "ytd",
//             as_of_date: bq_value_to_string(row?.as_of_date),
//             unique_profiles: Number(row?.unique_profiles || 0),
//         };

//         return results;
//     } catch (err) {

//         // attempt #2: fallback to total if the column doesn't exist
//         const sql_total = `
//             SELECT
//               CURRENT_DATE() AS as_of_date,
//               COUNT(DISTINCT id_profiles) AS unique_profiles
//             FROM \`${project_id}.${dataset_id}.${table_id}\`
//         `;

//         const row = await bq_query_one(sql_total);

//         const results = {
//             dataset_id,
//             table_id,
//             metric_scope: "total_fallback",
//             as_of_date: bq_value_to_string(row?.as_of_date),
//             unique_profiles: Number(row?.unique_profiles || 0),
//             note: `fallback_used: ${String(err?.message || err).slice(0, 180)}`,
//         };
        
//         return results;
//     }
// }

async function bq_membership_ytd() {
    const bq = get_bigquery_client();
    const project_id = bq.projectId;

    const dataset_id = "membership_reporting";
    const table_id = "membership_data"; // keep your current table

    // ytd = purchased_on_adjusted_mp in current year and <= today
    const sql_ytd = `
        SELECT
            CURRENT_DATE() AS as_of_date,
            COUNT(DISTINCT id_profiles) AS unique_profiles,
            COUNT(id_profiles) AS total_sales
        FROM \`${project_id}.${dataset_id}.${table_id}\`
        WHERE DATE(purchased_on_adjusted_mp) <= CURRENT_DATE()
          AND EXTRACT(YEAR FROM DATE(purchased_on_adjusted_mp)) = EXTRACT(YEAR FROM CURRENT_DATE())
    `;

    try {
        const row = await bq_query_one(sql_ytd);

        return {
            dataset_id,
            table_id,
            metric_scope: "ytd_by_purchase_date",
            as_of_date: bq_value_to_string(row?.as_of_date),
            unique_profiles: Number(row?.unique_profiles || 0),
            total_sales: Number(row?.total_sales || 0),
        };
    } catch (err) {
        // fallback to total if the column doesn't exist or type issues
        const sql_total = `
            SELECT
                CURRENT_DATE() AS as_of_date,
                COUNT(DISTINCT id_profiles) AS unique_profiles,
                COUNT(id_profiles) AS total_sales
            FROM \`${project_id}.${dataset_id}.${table_id}\`
        `;

        const row = await bq_query_one(sql_total);

        return {
            dataset_id,
            table_id,
            metric_scope: "total_fallback",
            as_of_date: bq_value_to_string(row?.as_of_date),
            unique_profiles: Number(row?.unique_profiles || 0),
            total_sales: Number(row?.total_sales || 0),
            note: `fallback_used: ${String(err?.message || err).slice(0, 180)}`,
        };
    }
}

module.exports = {
    get_bigquery_client,
    bq_query_one,
    bq_ping,
    bq_test_table_count,
    bq_list_tables,
    bq_membership_ytd,
};

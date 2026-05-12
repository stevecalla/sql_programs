const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql = require('mysql2');
const mysqlP = require('mysql2/promise');
const { Client } = require('ssh2');
const sshClient = new Client();

const { 
    forwardConfig, 
    dbConfig, 
    sshConfig,
    local_usat_sales_db_config,
} = require('../../utilities/config');

const {
    query_create_mtn_utc_timestamps,
    query_step_10_create_participation_rankings_table,
} = require("../queries/participation_data/step_10_create_participation_state_championship_query");

const { runTimer, stopTimer } = require('../../utilities/timer');

// Connect to Vapor through SSH tunnel
async function create_connection() {
    console.log('create SSH connection to Vapor');

    const getSshConfig = await sshConfig();

    return new Promise((resolve, reject) => {
        sshClient.on('ready', () => {
            console.log('\nSSH tunnel established.\n');

            const { srcHost, srcPort, dstHost, dstPort } = forwardConfig;

            sshClient.forwardOut(
                srcHost,
                srcPort,
                dstHost,
                dstPort,
                (err, stream) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const updatedDbServer = {
                        ...dbConfig,
                        stream,
                        multipleStatements: true,
                        ssl: {
                            rejectUnauthorized: false,
                        },
                    };

                    const pool = mysql.createPool(updatedDbServer);

                    resolve(pool);
                }
            );
        }).connect(getSshConfig);
    });
}

// Get local MySQL connection
async function get_dst_connection() {
    const cfg = await local_usat_sales_db_config();
    return await mysqlP.createConnection(cfg);
}

// Execute MySQL query against Vapor
async function execute_mysql_working_query(pool, db_name, query) {
    const startTime = performance.now();

    return new Promise((resolve, reject) => {
        pool.query(`USE ${db_name};`, (useError) => {
            if (useError) {
                console.error('Error selecting database:', useError);
                return reject(useError);
            }

            pool.query({ sql: query }, (queryError, results) => {
                const endTime = performance.now();
                const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);

                if (queryError) {
                    console.error('Error executing query:', queryError);
                    return reject(queryError);
                }

                console.log("Query results - Elapsed Time:", elapsedTime, "sec");
                resolve(results);
            });
        });
    });
}

// Keep original created at dates function pattern
async function get_created_at_dates(pool, db_name, table_name) {
    const query = await query_create_mtn_utc_timestamps();

    const result = await execute_mysql_working_query(pool, db_name, query);

    const { created_at_mtn, created_at_utc } = result[2][0];

    return { created_at_mtn, created_at_utc };
}

// Convert existing CREATE TABLE AS query into read-only SELECT query
async function query_select_participation_rankings_data(table_name) {
    const create_query = await query_step_10_create_participation_rankings_table(table_name);

    const with_index = create_query.toUpperCase().indexOf('WITH ');

    if (with_index === -1) {
        throw new Error('Unable to convert CREATE TABLE query to SELECT query. WITH clause not found.');
    }

    return create_query.slice(with_index).replace(/;\s*$/, '');
}

function get_local_column_type(column_name, value) {
    const text_columns = new Set([
        'ids_membership_periods',
        'ids_membership_type_membership_periods',
        'names_membership_types',
        'starts_membership_periods',
        'ends_membership_periods',
        'groups_membership_types',
        'ids_events',
        'starts_events',
        'names_events',
        'age_race_results',
        'designations_races',
        'names_distance_types',
        'names_race_types',
        'ids_race_results',
    ]);

    const date_time_columns = new Set([
        'created_at_mtn',
        'created_at_utc',
    ]);

    const date_columns = new Set([
        'date_of_birth_profiles',
        'ranked_at_ranking_list_periods',
    ]);

    const decimal_columns = new Set([
        'score_ranking_list_period_entries',
        'multiplier_score_ranking_list_period_entries',
    ]);

    const integer_columns = new Set([
        'id_profiles',
        'count_membership_periods',
        'count_distinct_profiles',
        'count_total_race_results',
        'id_ranking_lists',
        'min_age_groups',
        'max_age_groups',
        'id_ranking_list_period_entries',
        'member_number_ranking_list_period_entries',
        'rank_ranking_list_period_entries',
        'all_american_ranking_list_period_entries',
    ]);

    if (text_columns.has(column_name)) return 'TEXT';
    if (date_columns.has(column_name)) return 'DATE NULL';
    if (date_time_columns.has(column_name)) return 'DATETIME NULL';
    if (decimal_columns.has(column_name)) return 'DECIMAL(18,6) NULL';
    if (integer_columns.has(column_name)) return 'BIGINT NULL';

    if (value instanceof Date) return 'DATETIME NULL';
    if (typeof value === 'number' && Number.isInteger(value)) return 'BIGINT NULL';
    if (typeof value === 'number') return 'DECIMAL(18,6) NULL';

    return 'VARCHAR(255) NULL';
}

async function create_local_table_from_first_row(dst, table_name, first_row) {
    const columns = Object.keys(first_row);

    const column_defs = columns.map((column_name) => {
        const column_type = get_local_column_type(column_name, first_row[column_name]);
        return `\`${column_name}\` ${column_type}`;
    });

    const sql = `
DROP TABLE IF EXISTS \`${table_name}\`;

CREATE TABLE \`${table_name}\` (
    ${column_defs.join(',\n    ')}
);
`;

    await dst.query(sql);
}

function query_append_indexes(table_name) {
    return `
        ALTER TABLE \`${table_name}\`
            ADD INDEX idx_id_profiles (id_profiles),
            ADD INDEX idx_ranked_name_race_types (ranked_name_race_types),
            ADD INDEX idx_profile_ranked_race_type (id_profiles, ranked_name_race_types),
            ADD INDEX idx_ranking_lookup (
                ranked_at_ranking_list_periods,
                name_ranking_series,
                ranked_name_race_types,
                ranked_age_bin
            ),
            ADD INDEX idx_created_at_mtn (created_at_mtn),
            ADD INDEX idx_created_at_utc (created_at_utc)
        ;
`;
}

// Insert one batch of rows into local
async function flush_batch(dst, tableName, rows) {
    if (!rows || rows.length === 0) return;

    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `\`${c}\``).join(',');
    const placeholders = rows.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    const sql = `INSERT INTO \`${tableName}\` (${colList}) VALUES ${placeholders}`;

    const values = [];

    for (const row of rows) {
        for (const col of cols) {
            values.push(row[col]);
        }
    }

    await dst.execute(sql, values);
}

// Read from Vapor and write to local
async function transfer_vapor_query_to_local(src, dst, src_db_name, table_name, created_at_mtn, created_at_utc) {
    const BATCH_SIZE = 500;

    runTimer(`transfer_vapor_to_local`);

    await new Promise((resolve, reject) => {
        src.query(`USE ${src_db_name};`, (useError) => {
            if (useError) return reject(useError);
            resolve();
        });
    });

    const select_query = await query_select_participation_rankings_data(table_name);

    console.log(`Reading data from Vapor and writing to local table: ${table_name}`);

    const stream = src.query(select_query).stream();

    let buffer = [];
    let local_table_created = false;

    await dst.beginTransaction();

    try {
        for await (const row of stream) {
            const row_with_created_at = {
                ...row,
                created_at_mtn,
                created_at_utc,
            };

            if (!local_table_created) {
                await create_local_table_from_first_row(dst, table_name, row_with_created_at);
                local_table_created = true;
            }

            buffer.push(row_with_created_at);

            if (buffer.length >= BATCH_SIZE) {
                await flush_batch(dst, table_name, buffer);
                buffer = [];
            }
        }

        if (!local_table_created) {
            console.log('No rows returned from Vapor query. Creating empty local table was skipped.');
        }

        if (buffer.length) {
            await flush_batch(dst, table_name, buffer);
        }

        if (local_table_created) {
            await dst.query(query_append_indexes(table_name));
        }

        await dst.commit();

        console.log(`Transfer successful: ${table_name}`);
    } catch (error) {
        await dst.rollback();
        console.error(`Transfer failed, rolled back local transaction:`, error);
        throw error;
    }

    stopTimer(`transfer_vapor_to_local`);
}

async function main() {
    let pool;
    let dst;
    const startTime = performance.now();

    try {
        pool = await create_connection();
        dst = await get_dst_connection();

        const db_name = `vapor`;
        const table_name = `all_participation_state_rankings_results`;

        console.log(`Source Database: ${db_name}`);
        console.log(`Local Table: ${table_name}`);

        // STEP #1: GET CREATED AT DATES USING ORIGINAL FUNCTION
        const { created_at_mtn, created_at_utc } = await get_created_at_dates(
            pool,
            db_name,
            table_name
        );

        console.log('CREATED AT DATES =', created_at_mtn, created_at_utc);

        // STEP #2: READ FROM VAPOR AND WRITE TO LOCAL
        await transfer_vapor_query_to_local(
            pool,
            dst,
            db_name,
            table_name,
            created_at_mtn,
            created_at_utc
        );

        console.log('Read from Vapor and local transfer executed successfully.');
    } catch (error) {
        console.log('Read or transfer NOT executed successfully.');
        console.error('Error:', error);
    } finally {
        if (pool) {
            await pool.end(err => {
                if (err) {
                    console.error('Error closing source connection pool:', err.message);
                } else {
                    console.log('Source connection pool closed successfully.');
                }
            });
        }

        if (dst) {
            await dst.end();
            console.log('Destination DB connection closed successfully.');
        }

        sshClient.end();

        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);

        console.log(`\nTIME LOG. Elapsed Time: ${elapsedTime || "Oops error getting time"} sec\n`);

        return elapsedTime;
    }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("error during event load:", error);
    process.exitCode = 1;
  });
}

module.exports = {
    execute_create_participation_state_championship_data: main,
};
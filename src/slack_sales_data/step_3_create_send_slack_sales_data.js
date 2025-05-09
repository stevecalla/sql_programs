const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { Client } = require('ssh2');
const sshClient = new Client();
const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

const { query_slack_sales_data } = require('../queries/slack_sales_data/get_sales_data_112524');
const { send_slack_followup_message } = require('../../utilities/slack_messaging/send_followup_message');
const { create_slack_sales_message } = require('../../utilities/slack_messaging/slack_sales_message');
const { slack_message_api } = require('../../utilities/slack_messaging/slack_message_api');

// Connect to MySQL
async function create_connection() {

    console.log('create connection');

    try {
        // Create a connection to MySQL
        const config_details = await local_usat_sales_db_config();

        const pool = create_local_db_connection(config_details);

        return (pool);

    } catch (error) {
        console.log(`Error connecting: ${error}`)
    }
}

// STEP #1: GET / QUERY DAILY PROMO DATA
async function execute_query_get_sales_data(pool, query) {
    return new Promise((resolve, reject) => {

        const startTime = performance.now();

        pool.query(query, (queryError, results) => {
            const endTime = performance.now();
            const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

            if (queryError) {
                console.error('Error executing select query:', queryError);
                reject(queryError);
            } else {

                // console.table(results);
                // console.log(results);

                console.log(`Query results length: ${results.length}, Elapsed Time: ${elapsedTime} sec`);

                resolve(results);
            }
        });
    });
}

async function execute_create_send_slack_sales_data(is_cron_job = true, channel_id, channel_name, user_id) {
    let pool;
    let results;
    const startTime = performance.now();

    try {
        // STEP #1: GET / QUERY Promo DATA & RETURN RESULTS
        pool = await create_connection();

        // STEP #2: GET DATA FOR SLACK MESSAGE
        const query = query_slack_sales_data();
        results = await execute_query_get_sales_data(pool, query);

        if (results) {
            // STEP #3: CREATE SLACK MESSAGE
            const slack_message = await create_slack_sales_message(results);
            console.log('step_3_get_slack... =', slack_message);

            // STEP #4: SEND CRON SCHEDULED MESSAGE TO SLACK
            // ONLY EXECUTE IF is_cron_job is true

            // TESTING VARIABLEj
            const send_slack_to_calla = false;
            console.log('send slack to calla =', send_slack_to_calla);
            console.log('is cron = ', is_cron_job);

            if (send_slack_to_calla && is_cron_job) {
                console.log('1 =', send_slack_to_calla, is_cron_job, send_slack_to_calla && is_cron_job);
                await slack_message_api(slack_message, "steve_calla_slack_channel");
            } else if(is_cron_job) {
                console.log('2 =', send_slack_to_calla, is_cron_job, send_slack_to_calla && is_cron_job);
                await slack_message_api(slack_message, "daily_sales_bot_slack_channel");
            } else {
                // Send a follow-up message to Slack
                await send_slack_followup_message(channel_id, channel_name, user_id, slack_message);
            }

        } else {
            const slack_message = "Error - No results";
            await slack_message_api(slack_message, "steve_calla_slack_channel");
        }

    } catch (error) {
        console.error('Error:', error);

        const slack_message = `Error - No results: error`;
        await slack_message_api(slack_message, "steve_calla_slack_channel");

        throw error;

    } finally {
        // Ensure cleanup happens even if there is an error
        if (pool) {
            await new Promise((resolve, reject) => {
                pool.end(err => {
                    if (err) {
                        console.error('Error closing connection pool:', err.message);
                        reject(err);
                    } else {
                        console.log('Connection pool closed successfully.');
                        resolve();
                    }
                });
            });
        }

        if (sshClient) {
            sshClient.end(err => {
                if (err) {
                    console.error('Error closing SSH connection pool:', err.message);
                } else {
                    console.log('SSH Connection pool closed successfully.');
                }
            });
        }

        // LOG RESULTS
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

        console.log(`\nAll lead data queries executed successfully. Elapsed Time: ${elapsedTime ? elapsedTime : "Oops error getting time"} sec\n`);

        return elapsedTime;
    }
}

// Run the main function
// execute_create_send_slack_sales_data();

module.exports = {
    execute_create_send_slack_sales_data,
}
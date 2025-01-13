const { exec } = require('child_process');

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" }); // add path to read.env file

const GOOGLE_CLOUD_ACCOUNT = process.env.GOOGLE_CLOUD_ACCOUNT_USAT;
const GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID_USAT;

// LOGIN TO THE GOOGLE CLOUD ACCOUNT
async function execute_google_cloud_command(action, log_message) {
    // console.log(action);

    const command_login = `gcloud config set account ${GOOGLE_CLOUD_ACCOUNT}`;
    const command_set_property_id = `gcloud config set project ${GOOGLE_CLOUD_PROJECT_ID}`;

    action = action === "login" ? command_login : command_set_property_id;
    // console.log(action)

    try {
        const startTime = performance.now();
        
        const command = action;
        // console.log(command);

        // AWAIT EXECUTION OF GSUTIL CP COMMAND
        await new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error:', error);
                    reject(error); // REJECT THE PROMISE IF THERE'S AN ERROR
                    return;
                }

                console.log(`\n${log_message}`);
                console.log('stdout:', stdout);
                console.error('stderr:', stderr);

                resolve(); // RESOLVE THE PROMISE AFTER UPLOAD COMPLETES
            });
        });

        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1000).toFixed(2); // CONVERT MS TO SEC
        console.log(`Elapsed Time: ${elapsedTime}`)
        return elapsedTime; // RETURN ELAPSED TIME AFTER ALL UPLOADS COMPLETE
    }

    catch (error) {
        console.error('Error:', error);
        throw error; // THROW ERROR IF AN ERROR OCCURS DURING UPLOAD PROCESS
    }
}

// execute_google_cloud_command("login", "Login successful");
// execute_google_cloud_command("set_property_id", "Project Id set successfully.");

module.exports = {
    execute_google_cloud_command
};

// COMMANDS
    // gcloud auth login = LOGIN
    // gcloud auth list = VIEW ACCOUNTS AND SIGNED IN ACCOUNT
    // gcloud config set account steve@ezhire.life = SET ACCOUNT
    // gcloud config set project ${GOOGLE_CLOUD_PROJECT_ID_EZHRE} = SET PROJECT ID
       // const command_set_project_id = `gcloud config set project ${GOOGLE_CLOUD_PROJECT_ID_EZHRE}`;
    // gcloud projects list = VIEW PROJECT LIST FOR PROJECT ID
        // const command_get_projects_list = `gcloud projects list`;
    // gcloud config get-value project = SEE CURRENT PROJECT
    // const command_get_current_default_project = `gcloud config get-value project`;

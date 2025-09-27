const fs = require("fs");
const { determine_ubuntu_update_log_file_path } = require('../determineOSPath');
const { slack_message_api } = require("../slack_messaging/slack_message_api");

async function read_ubuntu_update_log(char_limit = -500) {
    const file_name = 'ubuntu-update.log';

    const ubuntu_update_log_content = await determine_ubuntu_update_log_file_path(file_name);
    const { file_path, platform } = ubuntu_update_log_content;

    console.log(platform);
    console.log(file_path);

    try {
        const data = fs.readFileSync(file_path, "utf8");

        // Character count = string length
        const char_count = data.length;

        // Get only the last 1000 characters
        const last_n_char = data.slice(char_limit);

        console.log("Last 1000 characters:\n", last_n_char);
        console.log(`\nTotal Characters: ${char_count.toLocaleString()}`);
        // console.log("File content:\n", data);

        return last_n_char;

    } catch (err) {
        console.error(`Error reading file at ${file_name}:`, err.message);
        return null;
    }
}

async function send_ubuntu_log_via_slack() {
    let message = await read_ubuntu_update_log(-2000);

    message = `\n================\nUBUNUTU SYSTEM UPDATE / UPGRADE\n================\n${message} \n\n================\nUBUNUTU SYSTEM UPDATE / UPGRADE \n================\n`

    await slack_message_api(message, "steve_calla_slack_channel");
}

// Example usage:
if (require.main === module) {
    // read_ubuntu_update_log();
    send_ubuntu_log_via_slack();
}

module.exports = {
  read_ubuntu_update_log,
  send_ubuntu_log_via_slack,
}

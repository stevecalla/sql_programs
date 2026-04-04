const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

function parse_slack_command(req) {
    const result = {};

    // Start with query params (curl / manual testing)
    if (req.query && Object.keys(req.query).length > 0) {
        Object.assign(result, req.query);
    }

    // Override / add from Slack body text
    if (req.body && Object.keys(req.body).length > 0 && req.body.text) {
        const args = req.body.text.trim().split(/\s+/);

        for (const arg of args) {
            const [key, value] = arg.split('=');

            if (key && value) {
                result[key.toLowerCase()] = value;
            }
        }
    }

    return result;
}

function validate_command_password(req) {
    const parsed = parse_slack_command(req);

    const provided_password = parsed.password;
    const expected_password = process.env.SLACK_COMMAND_PASSWORD;

    if (!expected_password) {
        return {
            is_valid: false,
            error: 'Server misconfiguration: missing SLACK_COMMAND_PASSWORD',
            status: 500,
        };
    }

    if (provided_password !== expected_password) {
        return {
            is_valid: false,
            error: '⛔ Invalid password.',
            status: 403,
        };
    }

    return {
        is_valid: true,
        parsed, // pass parsed args back so you can reuse them
    };
}

module.exports = {
    parse_slack_command,
    validate_command_password,
};
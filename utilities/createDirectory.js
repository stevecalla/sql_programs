const fs = require('fs');
const path = require('path');
const { determineOSPath } = require('./determineOSPath');

async function create_directory(directoryName) {
    const os_path = await determineOSPath();
    const directoryPath = path.join(os_path, directoryName);

    // CHECK IF DIRECTORY EXISTS, IF NOT, CREATE IT
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }

    return directoryPath;
}

module.exports = { create_directory };
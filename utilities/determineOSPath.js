const os = require('os');
const path = require("path");

// Define paths for different platforms and users
const csv_export_paths = {
    linux: {
        'steve-calla': '/home/steve-calla/development/usat/data/',
        'usat-server': '/home/usat-server/development/usat/data/'
    },
    mac: '/Users/teamkwsc/development/usat/data/',
    windows: 'C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/'
};

async function determineOSUser() {
    const os_user_name = os.userInfo().username;
    return os_user_name;
}

async function determineOSPath() {
    // Get the current platform
    const platform = process.platform;
    
    if (platform === 'darwin') {// macOS
        return csv_export_paths.mac;
    } else if (platform === 'linux') {
        const username = await determineOSUser();
        return csv_export_paths.linux[username] || csv_export_paths.linux['usat-server'];
    } else {// Windows
        return csv_export_paths.windows;
    }
}

// READ UBUNTU SERVER UPDATE LOG
const ubuntu_folder_path = {
    linux: {
        'steve-calla': '/home/steve-calla/development/usat/sql_programs/utilities/cron_update_ubuntu',
        'usat-server': '/home/usat-server/development/usat/sql_programs/utilities/cron_update_ubuntu'
    },
    mac: '/Users/teamkwsc/development/usat/sql_programs/utilities/cron_update_ubuntu',
    windows: 'C:\\Users\\calla\\development\\usat\\sql_programs\\utilities\\cron_update_ubuntu'
}

async function determine_ubuntu_update_log_file_path(file_name) {
    // Get the current platform
    const platform = process.platform;
    let dir_path = "";

    if (platform === 'darwin') {// macOS
        dir_path = ubuntu_folder_path.mac;
    } else if (platform === 'linux') {
        const username = await determineOSUser();
        dir_path = ubuntu_folder_path.linux[username] || csv_export_paths.linux['usat-server'];
    } else {// Windows
        dir_path = ubuntu_folder_path.windows;
    }
    
    // Append filename in a cross-platform way
    const file_path = path.normalize(path.join(dir_path, file_name));

    return { file_path, platform};
}

module.exports = { 
    determineOSPath, 
    determineOSUser,
    determine_ubuntu_update_log_file_path,
};


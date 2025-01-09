const os = require('os');

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

module.exports = { determineOSPath, determineOSUser };


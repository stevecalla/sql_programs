const csv_export_path_linux = `/home/steve-calla/development/usat/data/`;
const csv_export_path_mac = `/Users/teamkwsc/development/usat/data/`;
const csv_export_path_windows = `C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/`;

async function determineOSPath() {
    // Determine the CSV export path based on the OS
    const isMac = process.platform === 'darwin'; // macOS
    const isLinux = process.platform === 'linux'; // Linux
    const os_path = isMac ? csv_export_path_mac : (isLinux ? csv_export_path_linux : csv_export_path_windows);
    return os_path;
}

module.exports = { determineOSPath };

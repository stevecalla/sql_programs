const csv_export_path = `C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/`;
const csv_export_path_mac = `/Users/teamkwsc/development/usat/data/`;

async function determineOSPath() {
    // Determine the CSV export path based on the OS
    const isMac = process.platform === 'darwin'; // macOS
    // const isWindows = process.platform === 'win32'; // Windows
    const os_path = isMac ? csv_export_path_mac : csv_export_path;
    return os_path;
}

module.exports = { determineOSPath };
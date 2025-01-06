const fs = require('fs');
const { getCurrentDateForFileNaming, getCurrentDateTime } = require('./getCurrentDate');

function generateLogFile(source, content, passedFolderPath) {
    // CREATE FILE NAME
    const date = getCurrentDateForFileNaming();
    const fileName = `log_${source}_${date}.txt`;
    // console.log('File name = ', fileName);

    // CREATE FILE PATH
    const defaultFolderPath = `C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/logs`;
    const folderPath = passedFolderPath ? `${passedFolderPath}/logs` : `${defaultFolderPath}`;
    const filePath = folderPath ? `${folderPath}/${fileName}` : `${defaultFolderPath}/${fileName}`;
    // console.log('File path = ', folderPath);

    // CREATE CONTENT
    const logContent = `${getCurrentDateTime()} - ${content}\n`;

    // const filePath = 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\data\\logs\\log_loading_booking_data_2024-04-02.txt';

    // CHECK IF FOLDER EXISTS, IF NOT, CREATE IT
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        // console.log(`Folder created: ${folderPath}`);
    }

    // CHECK IF FILE EXISTS, IF NOT, CREATE IT
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, 'Timestamp,Log Content\n'); // Add header if the file is created
        // console.log(`File created: ${filePath}`);
    }

    // use fs.access to check if the file or directory is accessible and writable
    fs.access(filePath, fs.constants.W_OK, (err) => {
        if (err) {
            console.error('Error accessing file:', err);
            // Handle permission error or choose an alternative file path
        } else {
            // console.log('File is accessible and writable.');

            // Proceed with writing to the file
            // APPEND CONTENT TO THE FILE
            
            fs.appendFileSync(filePath, logContent);

            // console.log(`Content appended to ${filePath}`);
        }
    });

}

// generateLogFile('bookingsData', 'Log message content', '');

module.exports = {
    generateLogFile,
};

const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config({path: "../.env"}); // adding the path ensures each folder will read the .env file as necessary
const connectionLimitThrottle = 30;

// console.log(process.env); // double check if env variables are available
// console.log(process.env.MYSQL_HOST); // double check if env variables are available

const dbConfig = {
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: connectionLimitThrottle,
};

const sshConfig = {
    host: process.env.SSH_HOST,
    port: parseInt(process.env.SSH_PORT),
    username: process.env.SSH_USERNAME,
    // password: process.env.SSH_PASSWORD,
    // privateKey: fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH),
    privateKey: fs.existsSync(process.env.SSH_PRIVATE_KEY_PATH) && fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH) || fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH_MAC),
};

const forwardConfig = {
    srcHost: '127.0.0.1',
    srcPort: 3306,
    dstHost: process.env.MYSQL_HOST,
    dstPort: parseInt(process.env.MYSQL_PORT),
};

const local_usat_sales_db_config = {
    host: process.env.LOCAL_HOST,
    port: 3306,
    user: process.env.LOCAL_MYSQL_USER,
    password: process.env.LOCAL_MYSQL_PASSWORD,
    database: process.env.LOCAL_USAT_SALES_DB,
    connectionLimit: 20,
};

// const csv_export_path = `C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/`;
// const csv_export_path_mac = `/Users/teamkwsc/development/usat/data/`;

module.exports = {
    dbConfig,
    sshConfig,
    forwardConfig,
    // csv_export_path,
    // csv_export_path_mac,
    local_usat_sales_db_config,
};
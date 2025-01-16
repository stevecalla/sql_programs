const fs = require('fs').promises; // Use promises API
const dotenv = require('dotenv');
dotenv.config({ path: "../.env" });

const { determineOSUser } = require('./determineOSPath');
const connectionLimitThrottle = 30;

// console.log(process.env);
// console.log(process.env.MYSQL_HOST);

async function getPrivateKey() {
    const isMac = process.platform === 'darwin'; // macOS
    const isLinux = process.platform === 'linux'; // Lijnux
    const os_user = await determineOSUser();

    let privateKeyPath = "";

    if (isMac)
        privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH_MAC
    else if (isLinux && os_user === "usat-server") 
        privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH_LINUX_USAT_SERVER
    else if (isLinux && os_user === "steve-calla")
        privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH_LINUX
    else
        privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH_WINDOWS

    try {
        // Check if the private key file exists
        await fs.access(privateKeyPath); // Check file existence

        // Read and return the private key
        return await fs.readFile(privateKeyPath);
    } catch (error) {
        throw new Error(`Private key not found or cannot be read at ${privateKeyPath}: ${error.message}`);
    }
}

const dbConfig = {
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: connectionLimitThrottle,
};

async function sshConfig() {
    return {
        host: process.env.SSH_HOST,
        port: parseInt(process.env.SSH_PORT),
        username: process.env.SSH_USERNAME,
        // password: process.env.SSH_PASSWORD,
        // privateKey: fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH),
        privateKey: await getPrivateKey(),
    }
};

const forwardConfig = {
    srcHost: '127.0.0.1',
    srcPort: 3306,
    dstHost: process.env.MYSQL_HOST,
    dstPort: parseInt(process.env.MYSQL_PORT),
};

async function local_usat_sales_db_config() {
    const config = {
        host: process.env.LOCAL_HOST,
        port: 3306,
        user: process.env.LOCAL_MYSQL_USER,
        password: process.env.LOCAL_MYSQL_PASSWORD,
        database: process.env.LOCAL_USAT_SALES_DB,
        connectionLimit: 20,
        multipleStatements: true // Enable multiple statements
    };

    // console.log(config);

    return config;
};

// local_usat_sales_db_config();

module.exports = {
    dbConfig,
    sshConfig,
    forwardConfig,
    local_usat_sales_db_config,
};
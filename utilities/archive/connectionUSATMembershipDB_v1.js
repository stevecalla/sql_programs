const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql = require('mysql2');
const { Client } = require('ssh2');
const { forwardConfig, dbConfig, sshConfig } = require('./config');

const sshClient = new Client();

// Function to create a Promise for managing the SSH connection and MySQL queries
async function create_usat_membership_connection() {

    const getSshConfig = await sshConfig();

    return new Promise((resolve, reject) => {
        sshClient.on('ready', () => {
            console.log('\nSSH tunnel established.\n');

            const { srcHost, srcPort, dstHost, dstPort } = forwardConfig;
            
            sshClient.forwardOut(
                srcHost,
                srcPort,
                dstHost,
                dstPort,
                (err, stream) => {
                    if (err) reject(err);

                    const updatedDbServer = {
                        ...dbConfig,
                        stream,
                        ssl: {
                            rejectUnauthorized: false,
                        },
                    };

                    const pool = mysql.createPool(updatedDbServer);

                    resolve(pool);
                }
            );
        }).connect(getSshConfig);
    });
}

module.exports = {
    create_usat_membership_connection
}



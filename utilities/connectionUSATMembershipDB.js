const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql = require('mysql2');
const { Client } = require('ssh2');
const { forwardConfig, dbConfig, sshConfig } = require('./config');

// Function to create a MySQL connection over SSH tunnel
async function create_usat_membership_connection() {
    
    const sshClient = new Client(); // <-- now fresh each time!
    const getSshConfig = await sshConfig();

    return new Promise((resolve, reject) => {
        sshClient
        .on('ready', () => {
            console.log('\n🔐 SSH tunnel established.\n');

            const { srcHost, srcPort, dstHost, dstPort } = forwardConfig;

            sshClient.forwardOut(
            srcHost,
            srcPort,
            dstHost,
            dstPort,
            (err, stream) => {
                if (err) {
                console.error('❌ Failed to forward SSH port:', err);
                reject(err);
                return;
                }

                // Optional: catch stream errors early
                stream.on('error', (streamErr) => {
                console.error('❌ Stream error from SSH tunnel:', streamErr);
                reject(streamErr);
                });

                const connection = mysql.createConnection({
                ...dbConfig,
                stream,
                ssl: {
                    rejectUnauthorized: false,
                },
                });

                resolve({ connection, sshClient });
            }
            );
        })
        .on('error', (sshErr) => {
            console.error('❌ SSH connection error:', sshErr);
            reject(sshErr);
        })
        .connect({
            ...getSshConfig,
            keepaliveInterval: 10000,
            keepaliveCountMax: 5,
        });
    });
}

module.exports = {
  create_usat_membership_connection
};
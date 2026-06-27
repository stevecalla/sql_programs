const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql = require('mysql2');
const { Client } = require('ssh2');
const { forwardConfig, dbConfig, sshConfig } = require('./config');

// One connection attempt over a fresh SSH tunnel (unchanged behavior).
async function try_usat_membership_connection() {

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
                    ssl: { rejectUnauthorized: false },
                    multipleStatements: true, // 👈 allow multiple SQL statements
                });

                // Handle (don't crash on) a dropped DB connection — e.g. PROTOCOL_CONNECTION_LOST /
                // ECONNREFUSED when the tunnel blips. Without this, the 'error' is unhandled and the
                // whole process exits (which is what crash-looped usat_slack).
                connection.on('error', (dbErr) => {
                    console.error('❌ MySQL connection error (handled, not fatal):', dbErr && dbErr.code, dbErr && dbErr.message);
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

// Retry a few times with backoff so a transient blip (DNS EAI_AGAIN, handshake timeout, ECONNRESET)
// is ridden out instead of bubbling up and crash-looping the caller. Same return shape as before.
async function create_usat_membership_connection() {
    const attempts = Number(process.env.DB_CONNECT_RETRIES) || 4;
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await try_usat_membership_connection();
        } catch (err) {
            lastErr = err;
            console.error(`❌ DB connect attempt ${i}/${attempts} failed:`, (err && (err.code || err.level)) || '', err && err.message);
            if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i)); // 1s, 2s, 3s…
        }
    }
    throw lastErr;
}

module.exports = {
  create_usat_membership_connection
};

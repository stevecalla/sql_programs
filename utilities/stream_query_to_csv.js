const fs = require('fs');
const path = require('path');
const fastcsv = require('fast-csv');
const mysql = require('mysql2');

/**
 * Stream query results directly to CSV
 */
// async function streamQueryToCsv(pool, query, filePath) {
//     return new Promise((resolve, reject) => {
//         const writeStream = fs.createWriteStream(filePath);
//         const csvStream = fastcsv.format({ headers: true });

//         const queryStream = pool.query(query).stream();

//         queryStream
//             .on('data', row => csvStream.write(row))
//             .on('end', () => {
//                 csvStream.end();
//             })
//             .on('error', err => {
//                 console.error('\nStream error:', err);
//                 reject(err);
//             });

//         csvStream
//             .pipe(writeStream)
//             .on('finish', () => {
//                 console.log(`\n✔️ Streamed to: ${filePath}`);
//                 resolve();
//             })
//             .on('error', err => {
//                 console.error('\nCSV Stream error:', err);
//                 reject(err);
//             });
//     });
// }

/**
 * Stream query results directly to CSV and return the last seen ID
 * @param {object} pool - MySQL connection pool
 * @param {string} query - SQL query to execute
 * @param {string} filePath - Path to output CSV
 * @param {string} idField - Field name to track for lastSeenId (e.g., 'id_profiles')
 * @returns {Promise<{ lastSeenId: any }>}
 */

// async function streamQueryToCsvAndTrackLastId(pool, query, filePath, idField) {
async function streamQueryToCsv(pool, query, filePath, idField) {
    return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(filePath);
        const csvStream = fastcsv.format({ headers: true });
        let lastSeenId = null;

        const queryStream = pool.query(query).stream();

        queryStream
            .on('data', row => {
                csvStream.write(row);
                if (row[idField] !== undefined) {
                    lastSeenId = row[idField];
                }
            })
            .on('end', () => {
                csvStream.end(); // this triggers resolve via writeStream
            })
            .on('error', err => {
                console.error('\nStream error:', err);
                reject(err);
            });

        csvStream
            .pipe(writeStream)
            .on('finish', () => {
                console.log(`\n✔️ Streamed to: ${filePath}`);
                resolve({ lastSeenId });
            })
            .on('error', err => {
                console.error('\nCSV Stream error:', err);
                reject(err);
            });
    });
}

// module.exports = {
//     streamQueryToCsvAndTrackLastId
// };


module.exports = {
    streamQueryToCsv
};

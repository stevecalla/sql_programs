const fs = require('fs');
const path = require('path');
const fastcsv = require('fast-csv');
const mysql = require('mysql2');

/**
 * Stream query results directly to CSV
 */
async function streamQueryToCsv(pool, query, filePath) {
    return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(filePath);
        const csvStream = fastcsv.format({ headers: true });

        const queryStream = pool.query(query).stream();

        queryStream
            .on('data', row => csvStream.write(row))
            .on('end', () => {
                csvStream.end();
            })
            .on('error', err => {
                console.error('Stream error:', err);
                reject(err);
            });

        csvStream
            .pipe(writeStream)
            .on('finish', () => {
                console.log(`✔️ Streamed to: ${filePath}`);
                resolve();
            })
            .on('error', err => {
                console.error('CSV Stream error:', err);
                reject(err);
            });
    });
}

module.exports = {
    streamQueryToCsv
};

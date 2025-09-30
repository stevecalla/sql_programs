const fs = require('fs');
const fastcsv = require('fast-csv');
const { Transform } = require('stream');

// const path = require('path');
// const mysql = require('mysql2');

/**
 * Stream query results directly to CSV
 */
async function streamQueryToCsv(pool, query, filePath, fileFlags = 'w') {
    return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(filePath, { flags: fileFlags });

        // const csvStream = fastcsv.format({ headers: true });
        const csvStream = fastcsv.format({
            headers: true,
            writeBOM: true,     // Excel-friendly
            quoteColumns: true, 
            quote: '"',                 // default, but make explicit
            escape: '"',                // escape quotes by doubling
            includeEndRowDelimiter: true,
            writeHeaders: true,
            // If only some columns need quoting:
            // quoteColumns: { colA: true, colB: true, ... }
            // To be safest (bigger files but robust), always quote:
            alwaysQuote: true

        });

        // const queryStream = pool.query(query).stream();
        const queryStream = pool.query(query).stream({ highWaterMark: 1000 });

        let rows_count = 0;
        let charCount = 0;
        let byteCount = 0;

        // Counts Unicode code points (proper char count) and bytes
        const charCounter = new Transform({
            decodeStrings: false, // chunk will be a string
            transform(chunk, enc, cb) {
                // count characters (code points)
                charCount += [...chunk].length;
                // count bytes written (utf8)
                byteCount += Buffer.byteLength(chunk, 'utf8');
                this.push(chunk); // pass through
                cb();
            }
        });

        queryStream
        .on('data', (row) => { rows_count += 1; csvStream.write(row); })
        .on('end',  () => csvStream.end())
        .on('error', (err) => reject(err));

        csvStream
            .pipe(charCounter)
            .pipe(writeStream)
            .on('finish', async () => {
                // stat (authoritative size on disk)
                let size = byteCount;
                try {
                const { size: statSize } = await fs.promises.stat(filePath);
                size = statSize;
                } catch {}
                
                // console.log(`Wrote #1: ${rows_count} rows_count to ${filePath} (${size.toLocaleString()} bytes) ${charCount.toLocaleString()} characters`);

                resolve({ filePath, rows_count, sizeBytes: size, charCount });
            })
            .on('error', (err) => reject(err));
            });
}

module.exports = {
    streamQueryToCsv
};

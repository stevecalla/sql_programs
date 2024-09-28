const mysql = require('mysql2');

// Function to create a Promise for managing the SSH connection and MySQL queries
function create_local_db_connection(conf_details) {
    return new Promise((resolve, reject) => {

        // MySQL configuration
        const mysqlConfig = conf_details;

        // Create a MySQL connection pool
        const pool = mysql.createPool(mysqlConfig);

        // Handle process termination signals. Shutdown gracefully on ctrl+c
        process.on('SIGINT', () => {
            console.log('\nReceived SIGINT signal. Closing database connection pool.');
            pool.end(err => {
                if (err) {
                    console.error('Error closing connection pool:', err.message);
                } else {
                    console.log('Connection pool closed successfully.');
                    process.exit(0); // Exit the process gracefully
                }
            });
        });

        // Close the connection pool when your application is shutting down
        process.on('exit', () => {
            console.log('\nExiting application. Closing database connection pool.');
            pool.end(err => {
                if (pool & err) {
                    console.error('Error closing connection pool:', err.message);
                } else {
                    console.log('Connection pool closed successfully.');
                }
            });
        });

        resolve(pool);
    });
}

module.exports = {
    create_local_db_connection
}


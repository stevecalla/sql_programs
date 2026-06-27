const mysql = require('mysql2');

// Register process-shutdown handlers ONCE for the whole process, and track live pools so we can close
// them on exit. Previously SIGINT/exit listeners were added on EVERY create_local_db_connection() call,
// which leaked process listeners (the "11 SIGINT/exit listeners" MaxListenersExceededWarning) since each
// job run created a fresh pool and never removed its handlers.
const _pools = new Set();
let _cleanup_registered = false;

function _register_cleanup_once() {
    if (_cleanup_registered) return;
    _cleanup_registered = true;

    const close_all = () => {
        for (const p of _pools) {
            try { p.end(err => { if (err) console.error('Error closing connection pool:', err.message); }); } catch (e) {}
        }
    };

    // Graceful shutdown on ctrl+c
    process.on('SIGINT', () => {
        console.log('\nReceived SIGINT signal. Closing database connection pool(s).');
        close_all();
        process.exit(0);
    });

    // Close any still-open pools when the application is shutting down
    process.on('exit', () => {
        console.log('\nExiting application. Closing database connection pool(s).');
        close_all();
    });
}

// Function to create a Promise for managing the SSH connection and MySQL queries
function create_local_db_connection(conf_details) {
    return new Promise((resolve, reject) => {

        // MySQL configuration
        const mysqlConfig = conf_details;

        // Create a MySQL connection pool
        const pool = mysql.createPool(mysqlConfig);

        // Track this pool; stop tracking it when the caller closes it (callers already call pool.end()).
        _pools.add(pool);
        const _end = pool.end.bind(pool);
        pool.end = (cb) => { _pools.delete(pool); return _end(cb); };

        // Register process-level cleanup once (no longer per-pool — this was the listener leak).
        _register_cleanup_once();

        resolve(pool);
    });
}

module.exports = {
    create_local_db_connection
}

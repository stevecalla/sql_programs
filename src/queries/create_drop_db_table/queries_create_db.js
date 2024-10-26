function query_create_database(db_name) {
    return(`CREATE DATABASE IF NOT EXISTS ${db_name}`);
}

module.exports = {
    query_create_database
}
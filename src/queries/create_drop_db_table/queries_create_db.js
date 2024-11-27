function query_create_database(db_name) {
    return(`CREATE DATABASE IF NOT EXISTS ${db_name}`);
}

function query_create_table(table_name) {
    return(`CREATE TABLE IF EXISTS ${table_name}`);
}

module.exports = {
    query_create_database,
    query_create_table,
}
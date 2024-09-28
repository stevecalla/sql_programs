function query_drop_database(db_name) {
    return(`DROP DATABASE IF EXISTS ${db_name}`);
}

function query_drop_table(table_name) {
    return(`DROP TABLE IF EXISTS ${table_name}`);
}

module.exports = {
    query_drop_database,
    query_drop_table
}
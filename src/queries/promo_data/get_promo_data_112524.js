function query_promo_data() {
    return `
        SELECT * FROM members LIMIT 1;
    `;
}

module.exports = {
    query_promo_data,
}
function main() {
    return `
        DROP TABLE IF EXISTS step_7a_event_name_clean;

        CREATE TABLE step_7a_event_name_clean AS
            WITH distinct_event_names AS (
                SELECT
                    id_events,
                    MIN(name_events) AS name_events
                FROM all_membership_sales_data_2015_left
                WHERE id_events IS NOT NULL
                GROUP BY id_events
            )
            SELECT
                den.id_events,
                LOWER(den.name_events) AS name_events_lower,
                TRIM(
                    REGEXP_REPLACE(
                        REPLACE(
                            REPLACE(
                                REGEXP_REPLACE(
                                    REGEXP_REPLACE(
                                        REGEXP_REPLACE(
                                            LOWER(den.name_events),
                                            '(^|\\s)[0-9]{4}(\\s|$)',
                                            ' '
                                        ),
                                        '(^|\\s)the\\s+[0-9]{1,2}(st|nd|rd|th)(\\s|$)',
                                        ' '
                                    ),
                                    '(^|\\s)[0-9]{1,2}(st|nd|rd|th)(\\s|$)',
                                    ' '
                                ),
                                '-',
                                ' '
                            ),
                            '/',
                            ' '
                        ),
                        '[[:space:]]+',
                        ' '
                    )
                ) AS cleaned_name_events
            FROM distinct_event_names AS den
        ;

        CREATE INDEX idx_event_name_clean_id_events
            ON step_7a_event_name_clean (id_events);
    `;
}

module.exports = {
    step_7a_event_name_clean: main,
}
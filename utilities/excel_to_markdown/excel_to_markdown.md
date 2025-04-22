Shift+Alt+V

| summary                   | value |
|---------------------------|-------|
| total_events_2024         | 86    |
| total_events_2025         | 79    |
| unique_events_2024        | 82    |
| unique_events_2025        | 78    |
| duplicate_events_2024     | 5     |
| duplicate_events_2025     | 2     |
| matched_events            | 50    |
| new_events                | 28    |
| unmatched_2024_events     | 31    |
| new_events_over_threshold | 0     |
| timing_changes            | 41    |


| value_status                  | count_2024 |
|-------------------------------|------------|
| Complete                      | 43         |
| Action Required - Post Race   | 28         |
| Post Race Submitted - Pending | 8          |
| Cancelled                     | 4          |
| Deleted                       | 2          |
| Draft                         | 1          |

| value_status                  | count_2025 |
|-------------------------------|------------|
| Approved                      | 65         |
| Action Required - Application | 10         |
| Draft                         | 3          |
| Cancelled                     | 1          |

| ApplicationID | Name                                     | StartDate |
|---------------|------------------------------------------|-----------|
| 310009        | 2025 Ironman Texas Triathlon             | 4/20/2025 |
| 310118        | 2025 Memorial Hermann Ironman 70.3 Texas | 4/1/2025  |


| ApplicationID | Name                                               | StartDate |
|---------------|----------------------------------------------------|-----------|
| 308783        | 2024 Ironman Texas Triathlon                       | 4/21/2024 |
| 308784        | 2024 Memorial Hermann Ironman 70.3 Texas           | 4/1/2024  |

╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║                   CERTIFICATE OF RECOGNITION                   ║
║                LEVEL 1 LOOKER STUDIO DATA ANALYST              ║
║                    BADGE #1: EARLY ADOPTOR                     ║
║                    BADGE #2: GET STUFF DONE                    ║
║                    BADGE #3: SHARING KNOWLDGE                  ║
║                                                                ║
║   This certifies that                                          ║
║                                                                ║
║                          Krista Prescott                       ║
║                                                                ║
║   has successfully met the requirements and is hereby          ║
║   officially certified as a Level 1 "Just Get Stuff Done"      ║
║   Looker Studio Data Analyst.                                  ║
║                                                                ║
║   Awarded on:   4/8/2025________________                       ║
║                                                                ║
║   Signature:    Teach a Person to Fish Foundation              ║
║                                                                ║
║           Congratulations and keep up the great work!          ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

| ApplicationID | Name                     | StartDate | RaceDate   |
|---------------|--------------------------|-----------|------------|
| 309261        | The Great Loon Triathlon | 8/17/2025 | 2024-08-18 |
| 309811        | OBX TRI                  | 9/13/2025 | 9/14/2024  |

Great Loon Tri StartDate (event date) should be 8/17/24 and OBX RaceDate should be 9/14/25?


| month_name | Value        | 2024 | 2025 | difference |
|------------|--------------|------|------|------------|
| April      | Adult Clinic | 7    | 10   | 3          |
| April      | Adult Event  | 52   | 50   | -2         |
| April      | Youth Clinic | 4    | 4    | 0          |
| April      | Youth Event  | 12   | 12   | 0          |
| April      | Total        | 75   | 76   | 1          |

| month_name | Value        | 2024 | 2025 | difference |
|------------|--------------|------|------|------------|
| May        | Adult Clinic | 12   | 10   | -2         |
| May        | Adult Event  | 87   | 107  | 20         |
| May        | Youth Clinic | 1    | 1    | 0          |
| May        | Youth Event  | 21   | 28   | 7          |
| April      | Total        | 121  | 146  | 25         |

| Row Labels   | 2025        | 2024        | difference        |
|--------------|-------------|-------------|-------------------|
| Adult Clinic | 81          | 90          | -9                |
| Adult Event  | 806         | 826         | -20               |
| Youth Clinic | 26          | 33          | -7                |
| Youth Event  | 193         | 209         | -16               |
| Grand Total  | 1,106       | 1,158       | -52               |








| report_field        | membership_db_field                                                     | table       |
|---------------------|-------------------------------------------------------------------------|-------------|
| ApplicationID       | sanctioning_event_id AS id_sactioning_events,                           | events      |
| Name                | name AS name_events,                                                    | events      |
| StartDate           | DATE_FORMAT(e.starts, '%Y-%m-%d') AS starts_events,                     | events      |
| RaceDate            | DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date_races,              | races       |
| Status              |     -- the event table (e.status) status doesn't match; source?         |             |
| 2LetterCode         |  e.state_code AS state_code_events,                                     | events      |
| ZipCode             | e.zip AS zip_events,                                                    | events      |
| Value               |  et.name AS name_event_type,                                            | event_types |
| RaceDirectorUserID  |     -- what join is necessary; i looked at ; source?                    |             |
| Website             |  e.event_website_url,                                                   | events      |
| RegistrationWebsite | e.registration_url,                                                     | events      |
| Email               |     -- what join is necessary; i looked at ; source?                    |             |
| CreatedDate         | DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_events,    | events      |
| Gender              |     -- race gender; i couldn't find in races table; source?             |










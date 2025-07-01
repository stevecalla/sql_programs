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


| # event_year | is_test | is_deleted | total_events | is_not_deleted_not_test_events |
|--------------|---------|------------|--------------|--------------------------------|
| 1            | 0       | 0          | 2            | 2                              |
| 1980         | 0       | 7          | 0            | -7                             |
| 2006         | 0       | 0          | 2            | 2                              |
| 2007         | 0       | 0          | 1            | 1                              |
| 2008         | 0       | 0          | 3            | 3                              |
| 2009         | 1       | 0          | 1356         | 1355                           |
| 2010         | 1       | 0          | 1472         | 1471                           |
| 2011         | 0       | 0          | 1642         | 1642                           |
| 2012         | 1       | 0          | 2714         | 2713                           |
| 2013         | 0       | 0          | 2578         | 2578                           |
| 2014         | 0       | 0          | 2515         | 2515                           |
| 2015         | 9       | 240        | 2623         | 2374                           |
| 2016         | 9       | 212        | 2434         | 2213                           |
| 2017         | 7       | 193        | 2219         | 2019                           |
| 2018         | 7       | 68         | 2071         | 1996                           |
| 2019         | 20      | 49         | 1987         | 1918                           |
| 2020         | 16      | 79         | 1945         | 1850                           |
| 2021         | 4       | 141        | 1720         | 1575                           |
| 2022         | 13      | 202        | 1595         | 1380                           |
| 2023         | 4       | 160        | 1568         | 1404                           |
| 2024         | 3       | 129        | 1467         | 1335                           |
| 2025         | 12      | 99         | 1246         | 1135                           |
| 2026         | 1       | 1          | 25           | 23                             |
| 2028         | 1       | 1          | 1            | -1                             |
| 2048         | 0       | 1          | 1            | 0                              |
| 2109         | 0       | 1          | 1            | 0                              |
|              | 109     | 1583       | 33188        | 31496                          |



| # id_events | id_sanctioning_events | id_races | id_designation_custom_races | designation_races | event_type_id_events | name_event_type |
|-------------|-----------------------|----------|-----------------------------|-------------------|----------------------|-----------------|
| 32227       | 310522                | 4256954  | 310522-Adult Race           | Adult Race        | 1                    | Adult Event     |
| 32227       | 310522                | 4257690  | 310522                      |                   | 1                    | Adult Event     |

| 29355       | 307623                | 4252305  | 307623-Adult Race           | Adult Race        | 2                    | Adult Clinic    |
| 29355       | 307623                | 4252334  | 307623-Adult Clinic         | Adult Clinic      | 
2                    | Adult Clinic    |



| id_events | id_sanctioning_events | id_races | designation_races | id_designation_custom_races | event_type_id_events | name_event_type | name_event_type_or_race_desigation |
|-----------|-----------------------|----------|-------------------|-----------------------------|----------------------|-----------------|------------------------------------|
| 32227     | 310522                | 4256954  | Adult Race        | 310522-Adult Race           | 1                    | Adult Event     | Adult Event                        |
| 32227     | 310522                | 4257690  | Youth Race        | 310522-Youth Race           | 1                    | Adult Event     | Adult Event                        |

| 29355     | 307623                | 4252334  | Adult Clinic      | 307623-Adult Clinic         | 2                    | Adult Clinic    | Adult Clinic                       |


| Full Year                           | 2024  | 2025  | difference |
|-------------------------------------|-------|-------|------------|
| Adult Clinic                        | 90    | 83    | -7         |
| Adult Race                          | 825   | 809   | -16        |
| Youth Clinic                        | 33    | 29    | -4         |
| Youth Race                          | 210   | 193   | -17        |
| missing_event_type_race_designation | 0     | 1     | 1          |
| Total                               | 1,158 | 1,115 | -43        |
|                                     |       |       |            |
| April                               | 2024  | 2025  | difference |
| Adult Clinic                        | 7     | 11    | 4          |
| Adult Race                          | 52    | 50    | -2         |
| Youth Clinic                        | 4     | 5     | 1          |
| Youth Race                          | 12    | 13    | 1          |
| missing_event_type_race_designation | 0     | 0     | 0          |
| Total                               | 75    | 79    | 4          |
|                                     |       |       |            |
| May                                 | 2024  | 2025  | difference |
| Adult Clinic                        | 12    | 11    | -1         |
| Adult Race                          | 87    | 106   | 19         |
| Youth Clinic                        | 1     | 3     | 2          |
| Youth Race                          | 22    | 26    | 4          |
| missing_event_type_race_designation | 0     | 1     | 1          |
| Total                               | 122   | 147   | 25         |
|                                     |       |       |            |
| June                                | 2024  | 2025  | difference |
| Adult Clinic                        | 16    | 12    | -4         |
| Adult Race                          | 152   | 150   | -2         |
| Youth Clinic                        | 8     | 7     | -1         |
| Youth Race                          | 35    | 34    | -1         |
| missing_event_type_race_designation | 0     | 0     | 0          |
| Total                               | 211   | 203   | -8         |

| sanctioning id | created date | status 5/1             | status 5/2    |
|----------------|--------------|------------------------|---------------|
| 350168         | 4/22/2025    | in membership          | missing       |
| 350260         | 4/29/2025    | in membership          | in membership |
| 350265         | 4/29/2025    | in membership          | in membership |
| 350270         | 4/29/2025    | mising from membership | in membership |
| 350272         | 4/30/2025    | mising from membership | in member     |
| 350276         | 4/30/2025    | mising from membership | in member     |
| 350278         | 4/30/2025    | mising from membership | missing       |
| 350286         | 5/1/2025     | mising from membership | missing       |
| 350292         | 45779        | in membership          | new           |
| 350301         | 45779        | in membership          | new           |


As of 4/15/25
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

As of 5/2/25
| month_name                          | (All)       |             |             |
|-------------------------------------|-------------|-------------|-------------|
|                                     |             |             |             |
| Row Labels                          | Sum of 2024 | Sum of 2025 | Sum of diff |
| Adult Clinic                        | 90          | 83          | -7          |
| Adult Race                          | 825         | 808         | -17         |
| missing_event_type_race_designation | 0           | 5           | 5           |
| Youth Clinic                        | 33          | 29          | -4          |
| Youth Race                          | 209         | 195         | -14         |
| Grand Total                         | 1157        | 1120        | -37         |
|                                     |             |             |             |
| month_name                          | April       |             |             |
|                                     |             |             |             |
| Row Labels                          | Sum of 2024 | Sum of 2025 | Sum of diff |
| Adult Clinic                        | 7           | 11          | 4           |
| Adult Race                          | 52          | 50          | -2          |
| Youth Clinic                        | 4           | 5           | 1           |
| Youth Race                          | 12          | 13          | 1           |
| Grand Total                         | 75          | 79          | 4           |
|                                     |             |             |             |
| month_name                          | May         |             |             |
|                                     |             |             |             |
| Row Labels                          | Sum of 2024 | Sum of 2025 | Sum of diff |
| Adult Clinic                        | 12          | 11          | -1          |
| Adult Race                          | 87          | 106         | 19          |
| missing_event_type_race_designation | 0           | 2           | 2           |
| Youth Clinic                        | 1           | 3           | 2           |
| Youth Race                          | 22          | 26          | 4           |
| Grand Total                         | 122         | 148         | 26          |
|                                     |             |             |             |
| month_name                          | June        |             |             |
|                                     |             |             |             |
| Row Labels                          | Sum of 2024 | Sum of 2025 | Sum of diff |
| Adult Clinic                        | 16          | 12          | -4          |
| Adult Race                          | 152         | 150         | -2          |
| missing_event_type_race_designation | 0           | 1           | 1           |
| Youth Clinic                        | 8           | 7           | -1          |
| Youth Race                          | 35          | 35          | 0           |
| Grand Total                         | 211         | 205         | -6          |

| Row Labels                          | v 4/15 | v 5/2 | Sum of diff |
|-------------------------------------|--------|-------|-------------|
| Adult Clinic                        | 81     | 83    | 2           |
| Adult Race                          | 806    | 808   | 2           |
| missing_event_type_race_designation | 0      | 5     | 5           |
| Youth Clinic                        | 26     | 29    | 3           |
| Youth Race                          | 193    | 195   | 2           |
| Grand Total                         | 1106   | 1120  | 14          |

| Row Labels                          | v 4/15 | v 5/2 | v 5/9 | Sum of diff |
|-------------------------------------|--------|-------|-------|-------------|
| Adult Clinic                        | 81     | 83    | 83    | 0           |
| Adult Race                          | 806    | 808   | 809   | 1           |
| missing_event_type_race_designation | 0      | 5     | 9     | 4           |
| Youth Clinic                        | 26     | 29    | 29    | 0           |
| Youth Race                          | 193    | 195   | 195   | 0           |
| Grand Total                         | 1,106  | 1,120 | 1,125 | 5           |

| Type                | 2024  | 2025  | diff |
|---------------------|-------|-------|------|
| Adult Race          | 825   | 809   | -16  |
| Adult Clinic        | 90    | 83    | -7   |
| Youth Race          | 210   | 195   | -15  |
| Youth Clinic        | 33    | 29    | -4   |
| No Race Designation | 0     | 9     | 9    |
| Total               | 1,158 | 1,125 | -33  |

| # combination_type | num_combinations |
|--------------------|------------------|
| unique             | 2,137,819        |
| duplicate          | 163,071          |

| # combination_count_bin | num_combinations |
|-------------------------|------------------|
| 1) 1                    | 2,137,819        |
| 2) 2                    | 150,200          |
| 3) 3-10                 | 12,798           |
| 4) 11-20                | 6                |
| 5) 21+                  | 67               |


| Row Labels                          | v 4/15 | v 5/2 | v 5/9 | v 5/15 (draft) | Sum of diff |
|-------------------------------------|--------|-------|-------|----------------|-------------|
| Adult Clinic                        | 81     | 83    | 83    | 83             | 0           |
| Adult Race                          | 806    | 808   | 809   | 812            | 3           |
| missing_event_type_race_designation | 0      | 5     | 9     | 20             | 11          |
| Youth Clinic                        | 26     | 29    | 29    | 29             | 0           |
| Youth Race                          | 193    | 195   | 195   | 193            | -2          |
| Grand Total                         | 1,106  | 1,120 | 1,125 | 1,137          | 12          |





| # query_name                  | query_criteria                               | confidence_level                           | FORMAT(COUNT(*), 0) |
|-------------------------------|----------------------------------------------|--------------------------------------------|---------------------|
| chatgpt_dedupe_enhanced_query | chatgpt_dedupe_first_last_name_dob_phone_zip | duplicate_risk_2_duplicates                | 63                  |
| chatgpt_dedupe_enhanced_query | chatgpt_dedupe_first_last_name_dob_phone_zip | moderate_duplicate_risk_3_to_10_duplicates | 2                   |
| chatgpt_dedupe_enhanced_query | chatgpt_dedupe_first_last_name_dob_phone_zip | needs_review_missing_field(s)              | 55,860              |
| chatgpt_dedupe_enhanced_query | chatgpt_dedupe_first_last_name_dob_phone_zip |                                            | 55,925              |

| # query_name                   | query_criteria                            | confidence_level                           | FORMAT(COUNT(*), 0) |
|--------------------------------|-------------------------------------------|--------------------------------------------|---------------------|
| calla_#1_dedupe_enhanced_query | calla_#1_dedupe_first_last_name_dob_email | duplicate_risk_2_duplicates                | 757                 |
| calla_#1_dedupe_enhanced_query | calla_#1_dedupe_first_last_name_dob_email | elevated_duplicate_risk_11_to_20_dupicates | 1                   |
| calla_#1_dedupe_enhanced_query | calla_#1_dedupe_first_last_name_dob_email | high_duplicate_risk_21_or_more_duplicates  | 37                  |
| calla_#1_dedupe_enhanced_query | calla_#1_dedupe_first_last_name_dob_email | needs_review_missing_field(s)              | 8,158               |
| calla_#1_dedupe_enhanced_query | calla_#1_dedupe_first_last_name_dob_email |                                            | 8,953               |

| # query_name          | query_criteria                        | confidence_level                           | FORMAT(COUNT(*), 0) |
|-----------------------|---------------------------------------|--------------------------------------------|---------------------|
| dedupe_enhanced_query | calla_#2_dedupe_first_last_name_email | duplicate_risk_2_duplicates                | 6,331               |
| dedupe_enhanced_query | calla_#2_dedupe_first_last_name_email | elevated_duplicate_risk_11_to_20_dupicates | 1                   |
| dedupe_enhanced_query | calla_#2_dedupe_first_last_name_email | high_duplicate_risk_21_or_more_duplicates  | 37                  |
| dedupe_enhanced_query | calla_#2_dedupe_first_last_name_email | moderate_duplicate_risk_3_to_10_duplicates | 89                  |
| dedupe_enhanced_query | calla_#2_dedupe_first_last_name_email | needs_review_missing_field(s)              | 66,663              |
| dedupe_enhanced_query | calla_#2_dedupe_first_last_name_email |                                            | 73,121              |



year	2025		
is_match	0		
            
| year        | 2025                                                            |         |                        |
|-------------|-----------------------------------------------------------------|---------|------------------------|
| is_match    | 0                                                               |         |                        |
|             |                                                                 |         |                        |
| sanction_id | Name                                                            | Status  | Count of ApplicationID |
| 310200      | 2025 Florida Anvil Ultra Triathlon - Double World Championship  | DELETED | 1                      |
| 311130      | 2025 Startline Coaching Off Season group training - Brooklyn NY | DRAFT   | 1                      |
| 311531      | 2025 Florida ANVIL Ultra Triathlon                              | DELETED | 1                      |
| 350317      | Oro Valley Triathlon and Duathlon Festival                      | PENDING | 1                      |
| Grand Total |                                                                 |         | 4                      |




Sales: As of TU5/20


SALES
| MTD                 | REV   | UNITS | RPU
|---------------------|-------|-------|------
| Goal - Abs          | $735K | 25.6K | $28.73
| Goal                | +18%  | +1.4% | 16.8%

| Actual - MTD        | +26%  | +  2% | +23%
| May '25 - MTD       | $443K | 14.5K | $30.56
| May '24 - MTD       | $355K | 14.2K | $24.59
| abs diff            | $ 87K |   164 | $ 5.50

|---------------------|-------|-------|------
| Goal                | +18%  | +1.4% | 16.8%
| Actual - YTD April  | +26%  | + 2%  | +23%


RANKED RESULTS
|                | Races  | Races   | Racers  | Racers |
| MTD            | 2024   | 2025    | 2024    | 2025   |  
|----------------|--------|---------|---------|--------| 
| Q125           | 56     | 54      | 10.9K   | 11.0K  | 
| April          | 64     | 48      | 23.1K   | 17.9K  | 
| May            | 103    | 21      | 30.5K   |  3.4K  |

EVENTS
| Type                | 2024  | 2025  | diff |
|---------------------|-------|-------|------|
| Adult Race          | 825   | 812   | -13  |
| Adult Clinic        | 90    | 83    | -7   |
| Youth Race          | 210   | 193   | -17  |
| Youth Clinic        | 33    | 29    | -4   |
| No Race Designation | 0     | 20    | 20   |
| Total               | 1,158 | 1,137 | -21  |

* Working with Sam to manually update race designation & event status


| # id_sanctioning_events | start_date_races | starts_events | has_race_start_date_less_than_event_start_date |
|-------------------------|------------------|---------------|------------------------------------------------|
| 308910                  | 2024-10-16       | 2024-10-17    | 1                                              |
| 309918                  | 2024-02-18       | 2024-06-23    | 1                                              |
| 310353                  | 2024-09-17       | 2024-09-22    | 1                                              |
| 310427                  | 2025-05-17       | 2025-05-18    | 1                                              |
| 310589                  | 2025-03-28       | 2025-04-16    | 1                                              |
| 310589                  | 2025-03-30       | 2025-04-16    | 1                                              |
| 310988                  | 2025-05-09       | 2025-05-10    | 1                                              |
| 311125                  | 2025-05-10       | 2025-05-11    | 1                                              |

| # id_sanctioning_events | start_date_races | starts_events | has_race_start_date_less_than_event_start_date |
|-------------------------|------------------|---------------|------------------------------------------------|
| 308910-Adult Race       | 2024-10-16       | 2024-10-17    | 1                                              |
| 309400-Adult Race       | 2024-05-04       | 2024-05-05    | 1                                              |
| 309918-Adult Race       | 2024-02-18       | 2024-06-23    | 1                                              |
| 310032-Youth Race       | 2024-07-27       | 2024-08-24    | 1                                              |
| 310136-Youth Race       | 2024-08-07       | 2024-09-07    | 1                                              |
| 310353-Adult Race       | 2024-09-17       | 2024-09-22    | 1                                              |
| 310427-Adult Race       | 2025-05-17       | 2025-05-18    | 1                                              |
| 310589-Adult Race       | 2025-03-28       | 2025-04-16    | 1                                              |
| 310589-Adult Race       | 2025-03-30       | 2025-04-16    | 1                                              |
| 310694-Adult Race       | 2025-07-12       | 2025-07-13    | 1                                              |
| 310844-Adult Race       | 2025-07-19       | 2025-07-20    | 1                                              |
| 310984-Adult Race       | 2025-10-03       | 2025-10-04    | 1                                              |
| 310988-Adult Race       | 2025-05-09       | 2025-05-10    | 1                                              |
| 310991-Adult Race       | 2025-09-26       | 2025-09-27    | 1                                              |
| 310992-Adult Race       | 2025-10-24       | 2025-10-25    | 1                                              |
| 311125-Adult Race       | 2025-05-10       | 2025-05-11    | 1                                              |
| 311133-Youth Race       | 2025-01-01       | 2025-05-17    | 1                                              |
| 311233-Youth Race       | 2025-05-31       | 2025-08-02    | 1                                              |
| 311266-Adult Race       | 2025-06-07       | 2025-08-02    | 1                                              |
| 311667-Adult Race       | 2025-06-14       | 2025-06-15    | 1                                              |
| 350155-Adult Race       | 2025-09-06       | 2025-09-27    | 1                                              |
| 350162-Youth Clinic     | 2025-05-30       | 2025-10-04    | 1                                              |
| 350514                  | 2025-07-26       | 2025-07-27    | 1                                              |
| 350554                  | 2025-05-31       | 2025-06-07    | 1                                              |


| Events       | Jan | Feb | Mar | Apr | May | Total |
|--------------|-----|-----|-----|-----|-----|-------|
| Sanctioned   | 4   | 26  | 35  | 62  | 133 | 260   |
| Race Results | 4   | 20  | 32  | 53  | 62  | 171   |
| Variance     | 0   | -6  | -3  | -9  | -71 | -89   |

| event type                          | 2024 | 2025 | difference |
|-------------------------------------|------|------|------------|
| Adult Clinic                        | 16   | 16   | 0          |
| Adult Race                          | 152  | 149  | -3         |
| Youth Clinic                        | 8    | 7    | -1         |
| Youth Race                          | 34   | 36   | 2          |
| missing_event_type_race_designation | 0    | 3    | 3          |
| Total                               | 210  | 211  | 1          |

| command           | description                                            | usage_hint                                  |
|-------------------|--------------------------------------------------------|---------------------------------------------|
| /sales            | Enter "/sales" for real time membership sales.         |                                             |
| /revenue          | Enter "/revenue" for latest membership revenue         | month=ytd type=one_day category=bronze      |
| /revenue-examples | Some examples of how to request revenue stats          |                                             |
| /events           | Enter "/events" for latest sanctioned event counts     | /events or /events month=5                  |
| /races            | Enter "/races" for latest race results                 | /races                                      |
| /news             | Enter "/news subject=triathlon" for recent google news | /news or /news subject=usatriathlon count=5 |

| data                | auto schedule                         | data update       |
|---------------------|---------------------------------------|-------------------|
| /sales              | 8am, 10am, 12 noon, 4pm, 8pm, 11:58pm | real time         |
| /sales              | 8:30am daily                          | nightly ~2am      |
| /events             | 8:32am daily                          | 7am, 12 noon, 5pm |
| /races              | 8:35 am daily                         | nightly ~3am      |
| /news               | 10:30am, 5pm dally                    | real time         |
| revenue recognition | none                                  | nightly ~5am      |
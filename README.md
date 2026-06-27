# Mock Attendance App

[![License:  MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Index

1. [Description](#description)
2. [Installation](#installation)
3. [Usage](#usage)
4. [Features](#features)
5. [Technology](#technology)
6. [Contributing](#contributing)
7. [Resources](#resources)
8. [License](#license)

## Description

```
AS the owner of company that sells software to track attendance for educational institutions.

I WANT client educational institutions to be able to log in to an application that provides a basic attendance management dashboard (see requirements below).

SO THAT tracking attendance is fast and accurate using a single page web application.
````

## Usage

This app is deployed using Retool. From a development perspective, this app uses Node.js, Javascript, MySQL, Google Cloud Services, Google Bigquery for the backend and Retool for the front-end. See the technology list below for more detail.

## Features

## MVP Requirements:

1. Data: Information on School, Classes, Teachers, Students and Attendance.
2. Sorting: Ensure user can filter, search and sort data on various demensions using a clickable column hearder toggle.
3. Filter/Search: Ensure user can filter and/or search data on various demensions.
4. Attendance: Ensure the user can update attendance record as necessary.
5. Reporting: Ensure the app provides basic stats such as percentage of students present.
6. Responsiveness: Ensure the app is responsive to various screen sizes and devices.
7. Design: Ensure the layout is functionally intutive and visually appealing.

There are total of 6 pages. Three (3) pages are "teacher" specific with logic to identify the loggin teacher then pre-filter the data for that teach only. These pages are prefixed with "My" under the "My Classes" menu. Three (3) pages provide data for all students.

1. My Dashboard / All Dashboard: Provides a basic over of key metrics such as percent of student absent/present as well as counts for each. In desktop, a chart displays percent present and the absolute number of students present or absent by date.
2. My Attendance / All Attendance: Provides a tabbed component to summarize attendance stats by date, teacher, student as well as a table component to view the detailed records of student attendance with the ability to update the "Present" checkbox. This table also has a search box that uses fuzzy match logic to search the entire table as well as a filter option in the lower right hand cornder. In addition the tables are sortable using a toggle for each column. Above the table is a dynamic field that updates to show the "selected" row data which allows the user to be sure they are clicking / reviewing the correct row and in mobile format allows the user to rollover each row to see the selected row information rather than needing to scroll to the right.
3. My Data / All Data: Provides a more detailed data table with all the functionality described in bullet 2 above as well as the ability to update attendance and add a note to each attendance record.

In addition, this Github repo creates the backend datebase as noted below:
1. MySQL/Seed Data/Google Cloud: The code in this Github repo is specifically designed to use Nodejs and Javascrit to (a) create the DB structure with related tables and seed data and automatically upload this information from a local MySQL DB to Google Services and Google Bigquery (in a five step process that is outlined in the SRC file).

## Future Enhancements:

1. Add access to reports / data based on user need to know requirements.
2. Improve the UI by using Retool repeatable components rather than tables specifically to accomodate responsive design.
3. Review app settings to ensure compliance with basic web accessibility standards. Incorporate UserWay or a similar tool.
4. Include metrics comparing attendance performance against goals or standards defined by client.
5. Add email and sharing capability with slack or other resources that are permitted given data sensitivity.
6. Ensure the current download functionality for each table is compliant with client procedures.
7. Integrate this dashboard with app designed to provide more functionality beyond reporting.
8. Conduct client research to align features and design with practical use and needs.
9. Integrate appropriate alerts and notifications to confirm attendance status updates.
10. Add/leverage Retool functionality for testing, modules, versioning, analytics tracking, login/out and more.
11. Add validation for notes input, spinners as UX appropriate, reset button for filters on the My Students table, and complete the attendance update log to ensure a record is inserted into this log table each time a change is made and the updated_at date is updated via BigQuery not the insert query.

## Technology

1. `Retool:` Front-end app. [Tutorial](https://docs.retool.com/apps/web/tutorial/3)
2. `Git/Github:` Repo and version management specifically for the backend database code.
3. `MySQL`: Local database in MySQL Workbench.
4. `Nodejs & Javascript`: For building/seeding the local MySQL DB and deploying to Google Cloud/Bigquery.
10. `NPM Packages`: `moment` in Retool, `dayjs`, `mysql2`, `plotly`, `dotenv`, `google-cloud/bigquery`, `google-cloud/storage`.

## Website Preview

### Static Screenshots

* My Student - Desktop View
<img src="./src/assets/desktop_my_key_stats.png" width="700" height="400">
<img src="./src/assets/desktop_my_students.png" width="700" height="400">
<img src="./src/assets/desktop_my_data.png" width="700" height="400">
<img src="./src/assets/mobile_my_key_stats.png" width="700" height="400">
<img src="./src/assets/mobile_my_students.png" width="700" height="400">

* My Key Stats - Mobile View

### Video & Gif Walkthrough

* Desktop Walkthrough Video (with sound, 8 minutes long) [Link to WalkThrough Video](https://youtu.be/pLojbkOPM50)
* Mobile Walkthrough Video (no sound, 1 minutes long) [Link to WalkThrough Video](https://youtu.be/6Mep5hBHs6g)

* Desktop - Gif Demo
<img src="./src/assets/desktop_walkthrough.gif" width="700" height="400">

* Mobile - Gif Demo
<img src="./src/assets/mobile_walkthrough.gif" width="700" height="400">

## Installation

Setup: 
- (1) Fork the repo, (2) Clone the forked repo locally, (3) Run "npm install" (to install the dependencies).

Setup the Database Schema: 
- (1) Add a .env file. Include the fields below in the .env file. Place the .env at the root level.

  LOCAL MYSQL CONNECTION
  * MYSQL_HOST=<localhost>
  * MYSQL_PORT=<port>

  LOCAL_HOST=localhost
  * LOCAL_HOST=<address>
  * LOCAL_MYSQL_USER=<name>
  * LOCAL_MYSQL_PASSWORD=<password>

  LOCAL BOOKING DB
  * LOCAL_ATTENDANCE_DB=<db_name>

  GOOGLE CLOUD
  * GOOGLE_CLOUD_ACCOUNT_CALLA=<email_address>
  * GOOGLE_CLOUD_PROJECT_ID_CALLA=<project_id>

  GOOGLE SERVICE ACCOUNT KEY
  * GOOGLE_SERVICE_ACCOUNT=<service_account_key = in the format of an object {}>

Process to Create DB and Upload to Google Cloud/BigQuery: 
- Run step #1 in the SRC file `node step_1_create_database_tables.js`
- Run step #2 in the SRC file `node step_2_retrieve_data_process.js `
- Run step #3 in the SRC file `node step_3_upload_csv_to_cloud.js ` 
- Run step #4 in the SRC file `node step_4_create_bigquery_dataset.js`
- Run step #5 in the SRC file `node step_5_load_biq_query_database.js`

## Tests

No tests at this time.

## Contributing

Contributor Covenant Code of Conduct

[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md)


## Collaborators

1.  [Steve Calla - GitHub Profile](https://github.com/stevecalla)

## Resources

1. GitHub Repo: <https://github.com/stevecalla/attendance_project>
2. Retool App: <https://callacodes.retool.com/apps/fc9786ea-08e7-11ef-af17-2f26a7f21a45/Attendance_App/Key%20Metrics>
3. Walk-Through Video: TBD

## License

[![License:  MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
This project is licensed under the terms of the <span style="color:red">The MIT License</span>. Please click on the license badge for more information.

---

# API Proxy & Ops (server_proxy_8000.js)

A single reverse proxy (`server_proxy_8000.js`, port **8000**) fronts all the
`server_*.js` services. One public host — `usat-api.kidderwise.org` — plus path
prefixes replaces the per-app Cloudflare subdomains. Each backend keeps its own
port and pm2 process; the proxy only forwards. Full design notes:
`plans_and_notes/PROXY_PLAN.md`.

## Files

- `server_proxy_8000.js` — the proxy (create_app/start_server, dual-stack listen,
  health endpoints, optional rate-limit, 404). Mirrors the other `server_*.js`.
- `proxy_routes.js` — the route map: `'/prefix': { target, health }`. Routes are
  commented out and enabled **one at a time**. No secrets → committed to git.
- `menu.js` — interactive ops console (tests, health checks, pm2 controls, log
  tailing, reminders). `node menu.js` or `npm run menu`.
- `test/server_proxy_8000.test.js` — `node --test` suite for the proxy endpoints.

## Health / status endpoints

- `GET /api/test` — no-backend smoke check that the proxy is up.
- `GET /api/status` (alias `/healthz`) — proxy uptime, memory, node, enabled routes.
- `GET /api/health` — pings every enabled backend's health route; one up/down report.
- `GET /admin` — login-gated browser console (status + backend health + pm2 log tail). Auth via `PROXY_ADMIN_USER`/`PROXY_ADMIN_PASS` in `.env` (cookie session, mirrors the email_queue admin).
- `GET /api/logs` — login-gated pm2 log tail (used by /admin).

## Common commands

```
npm run menu                # interactive ops console
npm run test_proxy          # run the proxy test suite
npm run pm2_start_proxy     # start under pm2 (cluster, 2 workers)
npm run pm2_reload_proxy    # zero-downtime reload (after editing proxy_routes.js)
npm run restart_proxy       # hard restart (brief blip)
npm run logs_proxy          # tail proxy logs
node server_proxy_8000.js   # run in the foreground (dev)
```

## Add or change a backend route

1. Edit `proxy_routes.js` — uncomment or add a `{ target, health }` line.
2. `npm run pm2_reload_proxy` (re-reads the route map, no downtime).
3. Test `https://usat-api.kidderwise.org/<prefix>/<endpoint>`.

You never restart a backend to add a route, and you never restart the proxy to
deploy a backend (host:port is unchanged). Cron jobs are unaffected — they call
`http://localhost:<port>` directly, bypassing the proxy.

## Notes

- Optional: `npm i express-rate-limit` to enable proxy-level rate limiting (the
  proxy runs fine without it; you can rate-limit at Cloudflare instead).
- UI apps (8016/8018/8019) and the Streamlit org_chart (8011) stay on their own
  subdomains until the React co
## Admin console v2 (proxy /admin)

The `/admin` dashboard (login-gated, `PROXY_ADMIN_*` in `.env`) has five panes:
- **Status** — proxy uptime/memory/routes.
- **Backends** — `/api/health` table: numbered, sortable, with a "Last checked (MTN)" stamp and an auto-refresh control (default 15 min, with a pause toggle; persisted).
- **Processes** — `/api/pm2` table (name, status, CPU, mem, restarts, uptime, pid): numbered, sortable, auto-refresh default 10 min.
- **Fleet** — tmux-style status wall, one card per pm2 process; click a card to tail its logs. Auto-refresh default 10 min.
- **Logs** — pm2 log tail per process (no SSH).

Header links open `/api/status` and `/api/health` as pretty-printed JSON (the proxy sets `json spaces`). A `/favicon.svg` (USAT red hub) is served for the console + login page. The `/api/health` 503 log line now names the down backend(s). Rate limiting (300 req/min/IP) is active when `express-rate-limit` is installed.

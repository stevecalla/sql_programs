# SFMC SFTP Utility

## Purpose

This utility supports moving files between Salesforce Marketing Cloud (SFMC) and the local USAT Linux server.

It currently supports two workflows:

```text
1. Download exports from SFMC
   SFMC /Export → local server → processed folder

2. Upload imports to SFMC
   local import folder → SFMC /Import
```

---

## Main Folders

Local data folders are stored outside the repo:

```text
/home/usat-server/development/usat/data/sfmc_exports/
```

Folder structure:

```text
sfmc_exports/
├── import/
├── processed/
├── archive/
│   └── import_uploaded/
├── logs/
└── manifest/
```

SFTP landing folder used by the watcher:

```text
/sftp/sfmc_export/upload
```

---

## Environment Variables

Required values live in the root repo `.env`:

```text
/home/usat-server/development/usat/sql_programs/.env
```

Required SFMC values:

```env
SFMC_SFTP_HOST=your_host_here
SFMC_SFTP_PORT=your_port_here
SFMC_SFTP_USERNAME=your_user_name_here
SFMC_SFTP_PASSWORD=your_password_here
SFMC_REMOTE_DIR=/Export
SFMC_REMOTE_IMPORT_DIR=/Import
DELETE_REMOTE_AFTER_DOWNLOAD=false
```

Slack webhook values are also loaded from the root `.env`.

---

## NPM Scripts

Run commands from the repo root:

```bash
cd /home/usat-server/development/usat/sql_programs
```

### Watch Incoming Local Uploads

```bash
npm run watch
```

This watches:

```text
/sftp/sfmc_export/upload
```

When a file appears, it moves it to:

```text
/home/usat-server/development/usat/data/sfmc_exports/processed
```

and sends a Slack success or failure message.

---

### Download SFMC Exports

```bash
npm run download_sfmc_exports
```

This connects to SFMC SFTP and downloads files from:

```text
/Export
```

into the local upload folder:

```text
/sftp/sfmc_export/upload
```

The watcher then processes the file.

Recommended flow:

```bash
npm run watch
npm run download_sfmc_exports
```

Run `watch` in one terminal and `download_sfmc_exports` in another.

---

### Upload SFMC Imports

Put files to upload here:

```text
/home/usat-server/development/usat/data/sfmc_exports/import
```

Then run:

```bash
npm run upload_sfmc_imports
```

This uploads local files to SFMC:

```text
/Import
```

After successful upload, local files are moved to:

```text
/home/usat-server/development/usat/data/sfmc_exports/archive/import_uploaded
```

---

## Manual SFMC SFTP Test

To manually connect to SFMC SFTP:

```bash
sftp \
  -oHostKeyAlgorithms=+ssh-rsa \
  -oPubkeyAcceptedAlgorithms=+ssh-rsa \
  -P 22 \
  546014187@mcdx19-05gmcrj9lpj92gl2nzl5m.ftp.marketingcloudops.com
```

Useful commands inside SFTP:

```sftp
pwd
ls
cd Export
ls
cd ../Import
ls
bye
```

---

## Test Import Upload

Create a test file:

```bash
echo "email,first_name,last_name" > /home/usat-server/development/usat/data/sfmc_exports/import/test_import.csv
echo "test@example.com,Test,User" >> /home/usat-server/development/usat/data/sfmc_exports/import/test_import.csv
```

Upload it:

```bash
cd /home/usat-server/development/usat/sql_programs
npm run upload_sfmc_imports
```

Verify locally:

```bash
ls -lah /home/usat-server/development/usat/data/sfmc_exports/archive/import_uploaded
```

Verify in SFMC SFTP:

```bash
sftp \
  -oHostKeyAlgorithms=+ssh-rsa \
  -oPubkeyAcceptedAlgorithms=+ssh-rsa \
  -P 22 \
  546014187@mcdx19-05gmcrj9lpj92gl2nzl5m.ftp.marketingcloudops.com
```

Then:

```sftp
cd Import
ls
bye
```

---

## Retention Policy

The watcher currently deletes files older than 10 days from:

```text
upload/
processed/
archive/
logs/
```

Retention is based on file modified time.

The manifest file is used to remember previously downloaded SFMC export files so they are not downloaded repeatedly.

---

## Slack Notifications

Slack messages are sent for:

```text
✅ SUCCESS
❌ FAILURE
ℹ️ INFO
```

Messages include details such as:

```text
file name
file size
processed time
destination path
error message, if applicable
```

---

## Current Recommended Workflow

### For SFMC Exports

```bash
cd /home/usat-server/development/usat/sql_programs

npm run watch
```

Then in another terminal:

```bash
cd /home/usat-server/development/usat/sql_programs

npm run download_sfmc_exports
```

### For SFMC Imports

Put the file in:

```text
/home/usat-server/development/usat/data/sfmc_exports/import
```

Then run:

```bash
cd /home/usat-server/development/usat/sql_programs

npm run upload_sfmc_imports
```

---

## Notes

- Do not commit `.env` files.
- Do not commit export/import CSV files.
- The SFMC password should be rotated if exposed.
- The local SFTP server setup exists as a fallback but is not currently required for SFMC exports because SFMC already provides its own hosted SFTP.
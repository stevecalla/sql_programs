# SFMC SFTP Utility

## Overview

This utility provides a lightweight SFTP-based ingestion pipeline for receiving large export files from Salesforce Marketing Cloud (SFMC).

The primary goal is to support export workflows that exceed standard email attachment limitations by allowing SFMC to securely transfer files directly to a Linux server over SFTP.

This project is being designed with future automation in mind, including:
- automated file ingestion
- archive management
- Slack notifications
- Box / Google Drive uploads
- ETL integration
- CSV validation and processing

---

# Goals

## Initial Goals
- Create secure SFTP destination for SFMC exports
- Store export files outside the git repository
- Build reusable automation utilities in Node.js
- Support Linux, macOS, and Windows development paths where practical
- Move toward automated export handling workflows

## Future Goals
- Automated cloud uploads
- PM2 service management
- Automated cleanup / retention policies
- ETL pipeline integration
- Export monitoring and alerting
- File validation / duplicate detection

---

# Architecture

## High-Level Flow

```text
SFMC
  ↓
SFTP Upload
  ↓
Linux Server Upload Directory
  ↓
Node.js Watcher Utility
  ↓
Processed / Archived Files
  ↓
Future Automation Targets
(Box / Google Drive / ETL / Slack)
```

---

# Repository Structure

```text
utilities/setup_sfmc_sftp/
├── README.md
├── package.json
├── scripts/
├── src/
└── .env
```

---

# Runtime Data Storage

Runtime/export data is intentionally stored OUTSIDE the git repository.

Example Linux data path:

```text
/home/usat-server/development/usat/data/sfmc_exports/
```

Directory structure:

```text
sfmc_exports/
├── upload/
├── processed/
├── archive/
└── logs/
```

Folder purposes:
- upload/ → incoming SFTP files
- processed/ → files handled by automation
- archive/ → long-term retained exports
- logs/ → runtime and watcher logs

---

# Cross-Platform Design

This utility leverages shared helper utilities already used throughout the codebase:

- determineOSPath.js
- createDirectory.js

This allows Node.js automation logic to remain cross-platform while Linux-specific SFTP infrastructure is handled separately.

---

# Current Status

## Completed
- Project structure initialized
- Node.js project initialized
- Runtime data path strategy established
- Shared path utilities integrated
- Runtime directories auto-created

## In Progress
- Upload watcher utility
- Linux SFTP bootstrap script

## Planned
- PM2 integration
- SFTP user provisioning
- File automation workflows
- Notifications
- Cloud uploads

---

# Notes

## Important
- Runtime/export data should never be committed to git
- Secrets should always remain in `.env`
- SFTP infrastructure itself is Linux-specific
- Automation utilities should remain reusable/cross-platform where possible

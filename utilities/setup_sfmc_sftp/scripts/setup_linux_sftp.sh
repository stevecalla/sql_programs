#!/usr/bin/env bash

set -euo pipefail

# ===============================================================
# SFMC SFTP Linux Setup
# ===============================================================
#
# Purpose:
# Creates a dedicated Linux SFTP user and points that user at the
# SFMC upload directory used by the Node watcher.
#
# Notes:
# - This script is Linux-specific.
# - This version does NOT run apt update/install because SSH is
#   already available on this server through ssh.socket.
#
# ===============================================================

SFTP_USER="sfmc_export"
SFTP_GROUP="sfmc_sftp"
SFTP_HOME="/home/usat-server/development/usat/data/sfmc_exports"
UPLOAD_DIR="${SFTP_HOME}/upload"

echo ""
echo "================================================"
echo "SFMC SFTP Linux Setup"
echo "================================================"
echo "SFTP user:  ${SFTP_USER}"
echo "SFTP group: ${SFTP_GROUP}"
echo "SFTP home:  ${SFTP_HOME}"
echo "Upload dir: ${UPLOAD_DIR}"
echo "================================================"
echo ""

# Ensure SSH socket is enabled and listening.
# This server already has OpenSSH available, so we skip apt update/install.
sudo systemctl enable ssh.socket
sudo systemctl restart ssh.socket

# Create group if missing.
if ! getent group "${SFTP_GROUP}" > /dev/null; then
    sudo groupadd "${SFTP_GROUP}"
    echo "Created group: ${SFTP_GROUP}"
else
    echo "Group already exists: ${SFTP_GROUP}"
fi

# Create user if missing.
if ! id "${SFTP_USER}" > /dev/null 2>&1; then
    sudo useradd \
        --home-dir "${SFTP_HOME}" \
        --shell /usr/sbin/nologin \
        --gid "${SFTP_GROUP}" \
        "${SFTP_USER}"

    echo "Created user: ${SFTP_USER}"
else
    echo "User already exists: ${SFTP_USER}"
fi

# Ensure folders exist.
sudo mkdir -p "${UPLOAD_DIR}"
sudo mkdir -p "${SFTP_HOME}/processed"
sudo mkdir -p "${SFTP_HOME}/archive"
sudo mkdir -p "${SFTP_HOME}/logs"

# Important SFTP/chroot note:
# ChrootDirectory must be owned by root and must not be writable by the SFTP user.
sudo chown root:root "${SFTP_HOME}"
sudo chmod 755 "${SFTP_HOME}"

# Upload folder should be writable by the SFTP user.
sudo chown "${SFTP_USER}:${SFTP_GROUP}" "${UPLOAD_DIR}"
sudo chmod 775 "${UPLOAD_DIR}"

# Other folders are used by the Node watcher / server user.
sudo chown usat-server:usat-server "${SFTP_HOME}/processed"
sudo chown usat-server:usat-server "${SFTP_HOME}/archive"
sudo chown usat-server:usat-server "${SFTP_HOME}/logs"

sudo chmod 775 "${SFTP_HOME}/processed"
sudo chmod 775 "${SFTP_HOME}/archive"
sudo chmod 775 "${SFTP_HOME}/logs"

echo ""
echo "================================================"
echo "Setup step complete."
echo "================================================"
echo ""
echo "Next: set password for ${SFTP_USER}"
echo ""
echo "Run:"
echo "sudo passwd ${SFTP_USER}"
echo ""
echo "Then we will add the SSHD Match User config."
echo ""
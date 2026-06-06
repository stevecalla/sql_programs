/**
 * fmt.js — Pure duration + timestamp formatting helpers (no I/O).
 */

'use strict';

function format_duration(ms) {
    const total_seconds = Math.floor(ms / 1000);
    const hours = Math.floor(total_seconds / 3600);
    const minutes = Math.floor((total_seconds % 3600) / 60);
    const seconds = total_seconds % 60;
    const parts = [];

    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    return parts.join(" ");
}

function format_timestamp_utc(date = new Date()) {
    return date.toISOString();
}

function format_timestamp_mtn(date = new Date()) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Denver",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
    }).format(date).replace(",", "");
}

module.exports = {
    format_duration,
    format_timestamp_utc,
    format_timestamp_mtn,
};

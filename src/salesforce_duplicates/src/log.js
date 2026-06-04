/**
 * log.js — Console logging + ANSI color helpers.
 *
 * Depends on fmt.js for timestamps and elapsed-duration formatting.
 */

'use strict';

const { format_duration, format_timestamp_utc } = require('./fmt');

const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
};

function colorize(color, value) {
    return `${COLORS[color] || ""}${value}${COLORS.reset}`;
}

function log_info(message, start_ms = null) {
    const elapsed = start_ms
        ? colorize("gray", ` | elapsed: ${format_duration(Date.now() - start_ms)}`)
        : "";

    console.log(
        `${colorize("cyan", "[INFO]")} ${colorize("gray", format_timestamp_utc())} ${message}${elapsed}`
    );
}

function log_success(message, start_ms = null) {
    const elapsed = start_ms
        ? colorize("gray", ` | elapsed: ${format_duration(Date.now() - start_ms)}`)
        : "";

    console.log(
        `${colorize("green", "[OK]")} ${colorize("gray", format_timestamp_utc())} ${message}${elapsed}`
    );
}

function log_warn(message) {
    console.warn(
        `${colorize("yellow", "[WARN]")} ${colorize("gray", format_timestamp_utc())} ${message}`
    );
}

function log_error(message) {
    console.error(
        `${colorize("red", "[ERROR]")} ${colorize("gray", format_timestamp_utc())} ${message}`
    );
}

module.exports = {
    COLORS,
    colorize,
    log_info,
    log_success,
    log_warn,
    log_error,
};

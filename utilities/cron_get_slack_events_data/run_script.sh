#!/bin/bash

# Start timer
start_time=$(date +%s)
start_time_readable=$(date +"%I:%M:%S %p")

# Determine the current OS user
current_user=$(whoami)
echo "Current user: $current_user"
echo "Running slack events data cron job."

# PATH TO JS FILE
if [ "$current_user" == "steve-calla" ]; then
    # mac
    utilities/cron_get_slack_events_data
    JS_FILE="/home/steve-calla/development/usat/sql_programs/utilities/cron_get_slack_events_data/script.js"
    NODE_PATH="/home/$current_user/.nvm/versions/node/v18.20.4/bin/node"
elif [ "$current_user" == "usat-server" ]; then
    # linux
    JS_FILE="/home/usat-server/development/usat/sql_programs/utilities/cron_get_slack_events_data/script.js"
    NODE_PATH="/usr/bin/node"
elif [ "$current_user" == "calla" ]; then
    # windows
           # C:\Users\calla\development\usat\sql_programs\utilities\cron_get_slack_events_data\script.js
    JS_FILE="C:/Users/calla/development/usat/sql_programs/utilities/cron_get_slack_events_data/script.js"
    NODE_PATH="C:\Program Files\nodejs\node.exe"
else
    echo "Unknown user: $current_user"
    exit 1
fi

# EXECUTE THE JS FILE USING NODE
# # /usr/bin/node "$JS_FILE"
# NODE_PATH="/home/$current_user/.nvm/versions/node/v18.20.4/bin/node"

if [ -f "$JS_FILE" ]; then
    if [ -x "$NODE_PATH" ]; then
        "$NODE_PATH" "$JS_FILE"
    else
        echo "Node.js not found at $NODE_PATH"
        exit 1
    fi
else
    echo "JavaScript file not found at $JS_FILE"
    exit 1
fi

# End timer
end_time=$(date +%s)
end_time_readable=$(date +"%I:%M:%S %p")

# Calculate elapsed time
elapsed_time=$((end_time - start_time))
hours=$((elapsed_time / 3600))
minutes=$(( (elapsed_time % 3600) / 60 ))
seconds=$((elapsed_time % 60))

# Output times and execution duration
echo "Script started at: $start_time_readable"
echo "Script ended at: $end_time_readable"
echo "Total execution time: $hours hours, $minutes minutes, $seconds seconds"

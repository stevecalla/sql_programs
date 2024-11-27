#!/bin/bash

# Start timer
start_time=$(date +%s)
start_time_readable=$(date +"%I:%M:%S %p")

# PATH TO JS FILE
# LINUX
JS_FILE="/home/steve-calla/development/usat/sql_programs/utilities/cron_scheduled_member_sales/script.js"

# WINDOWS
#JS_FILE="C:/Users/calla/development/usat/sql_programs/utilities/cron_scheduled_member_sales/script.js"

# EXECUTE THE JS FILE USING NODE
# LINUX
# /usr/bin/node "$JS_FILE"
/home/steve-calla/.nvm/versions/node/v18.20.4/bin/node "$JS_FILE"

# WINDOWS
#/c/Program\ Files/nodejs/node "$JS_FILE"

# End timer
end_time=$(date +%s)
end_time_readable=$(date +"%I:%M:%S %p")

# Calculate elapsed time
elapsed_time=$((end_time - start_time))

# Convert elapsed time to hours, minutes, and seconds
hours=$((elapsed_time / 3600))
minutes=$(( (elapsed_time % 3600) / 60 ))
seconds=$((elapsed_time % 60))

# Output times and execution duration
echo "Script started at: $start_time_readable"
echo "Script ended at: $end_time_readable"
echo "Total execution time: $hours hours, $minutes minutes, $seconds seconds"
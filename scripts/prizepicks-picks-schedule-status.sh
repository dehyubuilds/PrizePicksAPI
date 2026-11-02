#!/bin/bash
set -euo pipefail
LABEL="com.dropflow.prizepicks-picks"
UID_NUM="$(id -u)"
if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
  echo "PrizePicks bot: ON — 8:30 AM, 12:30 PM, 4:30 PM CT (board ready ~9 / 1 / 5)"
  launchctl print "gui/${UID_NUM}/${LABEL}" | grep -E "state =|runs =|last exit code|program ="
else
  echo "PrizePicks bot: OFF"
  exit 1
fi

#!/bin/bash
set -euo pipefail
LABEL="com.dropflow.prizepicks-picks"
DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
rm -f "$DEST"
echo "PrizePicks bot schedule off."

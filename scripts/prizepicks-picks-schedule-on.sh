#!/bin/bash
set -euo pipefail
LABEL="com.dropflow.prizepicks-picks"
ROOT="/Users/dehyusinyan/Desktop/PrizePicksAPI"
SUPPORT="$HOME/Library/PrizePicksAPI"
SRC_PLIST="$ROOT/scripts/launchd/${LABEL}.plist"
DEST_PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
RUNNER="$SUPPORT/prizepicks-picks-scheduled.sh"
UID_NUM="$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents" "$SUPPORT/logs"
cp "$ROOT/scripts/prizepicks-picks-scheduled.sh" "$RUNNER"
chmod +x "$RUNNER"
# Keep HOME in the installed copy; script cds into the repo.
cp "$SRC_PLIST" "$DEST_PLIST"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$DEST_PLIST"
launchctl enable "gui/${UID_NUM}/${LABEL}"
echo "PrizePicks bot scheduled: 8:30 AM, 12:30 PM, 4:30 PM CT (board ready ~9 / 1 / 5)"
echo "Runner: $RUNNER"
launchctl print "gui/${UID_NUM}/${LABEL}" | grep -E "state =|runs =|last exit code" || true

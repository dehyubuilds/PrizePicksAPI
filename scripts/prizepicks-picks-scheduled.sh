#!/bin/zsh
# LaunchAgent entry. Lives in ~/Library so macOS does not block Desktop.
set -euo pipefail

ROOT="/Users/dehyusinyan/Desktop/PrizePicksAPI"
SUPPORT="$HOME/Library/PrizePicksAPI"
LOG_DIR="$SUPPORT/logs"
LOCK="$SUPPORT/prizepicks-picks.lock"
LOG="$LOG_DIR/prizepicks-picks.log"
NODE_BIN="$(dirname "$(command -v node)")"
if [ -z "$NODE_BIN" ] || [ "$NODE_BIN" = "." ]; then
  NODE_BIN="/usr/local/bin"
fi

# HOME provided by launchd / shell
export PATH="$NODE_BIN:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$HOME"

mkdir -p "$LOG_DIR"
exec >>"$LOG" 2>&1

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") skip: already running"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") prizepicks-picks scheduled start"
cd "$ROOT"
npm run prizepicks:picks
echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") prizepicks-picks scheduled done"

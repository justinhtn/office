#!/bin/sh
# Brings this checkout up to date with main, builds the interface and restarts the server.
set -eu

# Pulling can change this file, so the shell reads everything before anything runs.
update() {
  ROOT=$(cd "$(dirname "$0")/.." && pwd)
  LABEL=com.agentoffice.server
  BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" != main ]; then
    echo "This checkout is on $BRANCH. Run this from the checkout on main." >&2
    exit 1
  fi
  command -v npm >/dev/null 2>&1 || { echo "Agent Office needs npm. Install Node.js to build the interface." >&2; exit 1; }

  git -C "$ROOT" pull --ff-only origin main
  "$ROOT/scripts/build.sh"
  if [ "$(uname)" = Darwin ]; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "Agent Office is updated and restarted."
  else
    echo "Agent Office is updated. Restart the server to use it."
  fi
}

update "$@"
exit

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

  # Restarting only helps if the server runs from this checkout. The plist says so too, when an earlier run left the job unloaded.
  if [ "$(uname)" = Darwin ] && ! launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -qF "$ROOT/server/server.py" &&
    ! plutil -extract ProgramArguments.1 raw "$HOME/Library/LaunchAgents/$LABEL.plist" 2>/dev/null | grep -qxF "$ROOT/server/server.py"; then
    echo "The office server doesn't run from $ROOT. Run this from the checkout it uses, or run scripts/install.sh here." >&2
    exit 1
  fi

  git -C "$ROOT" pull --ff-only origin main
  "$ROOT/scripts/build.sh" || {
    echo "The build failed, so the server wasn't restarted. This checkout now has the new code with the old interface, so fix the build and run this again." >&2
    exit 1
  }
  . "$ROOT/scripts/python-env.sh"
  office_python_env
  if [ "$(uname)" = Darwin ]; then
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    if [ "$(plutil -extract ProgramArguments.0 raw "$PLIST")" != "$OFFICE_PYTHON" ]; then
      # A new Python only takes effect once launchd reloads the job.
      plutil -replace ProgramArguments.0 -string "$OFFICE_PYTHON" "$PLIST"
      launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    fi
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      launchctl kickstart -k "gui/$(id -u)/$LABEL"
    else
      # launchd can still be removing the old job, and then refuses the new one for a moment.
      tries=0
      until launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; do
        tries=$((tries + 1))
        if [ "$tries" -ge 5 ]; then
          echo "launchd wouldn't load the office server. Run this again, or: launchctl bootstrap gui/$(id -u) $PLIST" >&2
          exit 1
        fi
        sleep 1
      done
    fi
    echo "Agent Office is updated and restarted."
  else
    echo "Agent Office is updated. Restart the server to use it."
  fi
}

update "$@"
exit

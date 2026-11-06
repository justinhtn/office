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
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  if [ "$(uname)" = Darwin ] && ! launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -qF "$ROOT/server/server.py" &&
    ! python3 "$ROOT/scripts/server-plist.py" runs-from "$PLIST" "$ROOT/server/server.py" 2>/dev/null; then
    echo "The office server doesn't run from $ROOT. Run this from the checkout it uses, or run scripts/install.sh here." >&2
    exit 1
  fi

  BEFORE=$(git -C "$ROOT" hash-object "$ROOT/scripts/update.sh")
  git -C "$ROOT" pull --ff-only origin main
  # This run is still the old script, so the new one runs in its place. Only once, so it can never loop.
  if [ "$(git -C "$ROOT" hash-object "$ROOT/scripts/update.sh")" != "$BEFORE" ] && [ -z "${AGENT_OFFICE_UPDATE_AGAIN:-}" ]; then
    echo "update.sh itself changed, so running the new one."
    AGENT_OFFICE_UPDATE_AGAIN=1 exec "$ROOT/scripts/update.sh" "$@"
  fi
  "$ROOT/scripts/build.sh" || {
    echo "The build failed, so the server wasn't restarted. This checkout now has the new code with the old interface, so fix the build and run this again." >&2
    exit 1
  }
  . "$ROOT/scripts/python-env.sh"
  office_python_env
  if [ "$(uname)" = Darwin ]; then
    # On its own line so set -e stops here, before any restart, if the job can't be read or changed.
    CHANGED=$("$OFFICE_PYTHON" "$ROOT/scripts/server-plist.py" use-python "$PLIST" "$OFFICE_PYTHON" "$ROOT/server/server.py")
    if [ "$CHANGED" = changed ]; then
      # A new Python only takes effect once launchd reloads the job.
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

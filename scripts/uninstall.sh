#!/bin/sh
# Removes the plugin, background server and app. Pass --purge to also delete names and status.
set -u

LABEL=com.agentoffice.server
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null

# The away copy of Mia runs in its own process group, so it outlives the server.
FRONT_DESK=$(cd "$HOME/.agent-office/front-desk" 2>/dev/null && pwd -P)
mia_copies() {
  [ -n "$FRONT_DESK" ] || return 0
  ps -axww -o pid=,command= | grep -e '--channels plugin:telegram@claude-plugins-official' | grep -e '--resume' | while read -r pid _; do
    if lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -qxF "n$FRONT_DESK"; then
      echo "$pid"
    fi
  done
}
for sig in TERM KILL; do
  for pid in $(mia_copies); do
    kill -s "$sig" "-$pid" 2>/dev/null || kill -s "$sig" "$pid" 2>/dev/null
  done
  [ -z "$(mia_copies)" ] && break
  sleep 3
done
[ -z "$(mia_copies)" ] || echo "Couldn't stop Telegram Mia. Check Activity Monitor for: claude --channels" >&2

rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
claude plugin uninstall agent-office@agent-office --scope user
claude plugin marketplace remove agent-office

# Only the app make-app.sh makes, and only if its script is still the one that opens the office.
trash_app() {
  [ -d "$1" ] || return 0
  if ! osadecompile "$1/Contents/Resources/Scripts/main.scpt" 2>/dev/null | grep -q -e '--app=http://localhost:[0-9]*'; then
    echo "Left $1 alone, because it doesn't look like the one Agent Office made." >&2
  elif [ -x /usr/bin/trash ]; then
    /usr/bin/trash "$1" || echo "Couldn't move $1 to the Trash. Drag it there to remove it." >&2
  else
    osascript -e 'on run argv' -e 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)' -e 'end run' "$1" >/dev/null ||
      echo "Couldn't move $1 to the Trash. Drag it there to remove it." >&2
  fi
}
trash_app "/Applications/Agent Office.app"
trash_app "$HOME/Applications/Agent Office.app"
if [ "${1:-}" = --purge ]; then
  rm -rf "$HOME/.agent-office"
fi
echo "Agent Office removed."

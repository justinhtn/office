#!/bin/sh
# Installs Agent Office for this user: the Claude Code plugin and a background server.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${AGENT_OFFICE_PORT:-8794}
DATA="$HOME/.agent-office"
LABEL=com.agentoffice.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Agent Office needs $1. $2" >&2; exit 1; }
}
need claude "Install Claude Code first: https://claude.com/claude-code"
need python3 "Install Python 3.9 or newer."
need npm "Install Node.js to build the interface."
python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' || { echo "Agent Office needs Python 3.9 or newer." >&2; exit 1; }

"$ROOT/scripts/build.sh"

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Stop whatever is using it, or set AGENT_OFFICE_PORT." >&2
  exit 1
fi

mkdir -p "$DATA/requests" "$DATA/context" "$DATA/compaction"
chmod 700 "$DATA" "$DATA/requests"

claude plugin marketplace add "$ROOT"
claude plugin install agent-office@agent-office --scope user

PYTHON=$(python3 -c 'import sys; print(sys.executable)')
if [ "$(uname)" = Darwin ]; then
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$PYTHON</string><string>$ROOT/server/server.py</string><string>$PORT</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$DATA/server.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Agent Office is running at http://localhost:$PORT"
else
  echo "Plugin installed. Start the server with: python3 \"$ROOT/server/server.py\" $PORT"
fi
echo "Open a new Claude Code session so it starts feeding the office."

"$(dirname "$0")/make-app.sh" || echo "Could not make the app icon. You can still open http://localhost:8794."

# Her session starts once you confirm the folder and press Enter in the app.
LINK="$(python3 -c 'import os,urllib.parse as u;print("claude://code/new?"+u.urlencode({"folder":os.path.expanduser("~/.agent-office/front-desk"),"q":"Say hello in one short sentence and tell me who you are."}))')"
open "$LINK" 2>/dev/null || echo "To add your assistant, click Your office in Agent Office."

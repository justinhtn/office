#!/bin/sh
# Removes the plugin and background server. Pass --purge to also delete names and status.
set -u

LABEL=com.agentoffice.server
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
claude plugin uninstall agent-office@agent-office --scope user
claude plugin marketplace remove agent-office
if [ "${1:-}" = --purge ]; then
  rm -rf "$HOME/.agent-office"
fi
echo "Agent Office removed."

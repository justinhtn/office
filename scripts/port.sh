# Sourced by the install scripts. Without AGENT_OFFICE_PORT, a server that's already installed keeps its port.
# The server and the plugin repeat the default, and a test keeps them the same.
INSTALLED_PORT=$(plutil -extract ProgramArguments.2 raw "$HOME/Library/LaunchAgents/com.agentoffice.server.plist" 2>/dev/null || true)
PORT=${AGENT_OFFICE_PORT:-${INSTALLED_PORT:-8794}}
case $PORT in
  '' | *[!0-9]*) echo "AGENT_OFFICE_PORT must be a number, not $PORT." >&2; exit 1 ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "AGENT_OFFICE_PORT must be between 1 and 65535, not $PORT." >&2
  exit 1
fi

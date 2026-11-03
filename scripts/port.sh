# Sourced by the install scripts. The server and the plugin repeat this default, and a test keeps them the same.
PORT=${AGENT_OFFICE_PORT:-8794}
case $PORT in
  '' | *[!0-9]*) echo "AGENT_OFFICE_PORT must be a number, not $PORT." >&2; exit 1 ;;
esac

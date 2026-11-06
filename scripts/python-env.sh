# Sourced by install.sh and update.sh. Keeps the server's own Python environment, which only adds what
# server/requirements.txt pins, and sets OFFICE_PYTHON to the Python the server should run with.
# Without it the office still runs on the system Python, just without Face ID sign-in.

office_python_env() {
  venv="$HOME/.agent-office/python"
  OFFICE_PYTHON=$(python3 -c 'import sys; print(sys.executable)')
  if [ ! -x "$venv/bin/python3" ] && ! python3 -m venv "$venv"; then
    echo "Couldn't make the Python environment at $venv, so Face ID sign-in is off." >&2
    return 0
  fi
  if ! "$venv/bin/python3" -m pip install --quiet --disable-pip-version-check --require-hashes -r "$ROOT/server/requirements.txt"; then
    echo "Couldn't install what server/requirements.txt lists, so Face ID sign-in is off. Run this again when you're online." >&2
    return 0
  fi
  OFFICE_PYTHON="$venv/bin/python3"
}

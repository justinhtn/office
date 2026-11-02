#!/bin/sh
# Everything a change must pass before it is pushed. Run from anywhere in the repo.
set -e
cd "$(git rev-parse --show-toplevel)"

echo "Checking the server compiles"
PYTHONPYCACHEPREFIX="$(mktemp -d)" python3 -m py_compile server/server.py

if [ -d server/tests ]; then
  echo "Running server tests"
  python3 -m unittest discover -s server/tests
else
  echo "No server tests yet"
fi

# An older claude would take "plugin test" as a prompt and send it to the API, and its help exits 0 too, so look for this command's own usage line.
if claude plugin test --help 2>/dev/null | grep -q 'Usage: claude plugin test'; then
  echo "Running plugin tests"
  claude plugin test plugin
elif [ -n "${CI:-}" ]; then
  echo "Plugin tests can't run: no claude command with plugin tests in CI" >&2
  exit 1
else
  echo "Skipping plugin tests: no claude command with plugin tests here. CI still runs them."
fi

echo "Building the interface"
[ -d web/node_modules ] || (cd web && npm ci --silent)
out="$(mktemp -d)"
(cd web && npx vite build --outDir "$out" --emptyOutDir --logLevel error)
rm -rf "$out"

echo "All checks passed"

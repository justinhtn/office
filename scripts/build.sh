#!/bin/sh
# Builds the interface beside the live one, then swaps it in, so a failed build leaves the office as it was.
set -eu
cd "$(dirname "$0")/../web"

npm ci --silent
rm -rf dist.new
npx vite build --outDir dist.new --emptyOutDir --logLevel error
rm -rf dist
mv dist.new dist

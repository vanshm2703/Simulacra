#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Checking Playwright..."
cd "$ROOT/frontend"
if ! node -e "require('playwright')" 2>/dev/null; then
  echo "Installing Playwright..."
  bun add -d playwright
  npx playwright install chromium
fi

echo "Starting recording... (make sure ./run-start.sh is already running)"
node "$ROOT/scripts/record-demo.js" "$@"

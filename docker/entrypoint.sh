#!/usr/bin/env bash
set -euo pipefail

cd /app

mkdir -p \
  /app/data \
  /app/data-watchdog \
  /app/src/data \
  /app/src/quiz/data \
  /app/src/watchdog/data-watchdog

if [ ! -d /app/node_modules ] || [ -z "$(ls -A /app/node_modules 2>/dev/null || true)" ]; then
  echo "[docker] node_modules is empty; installing dependencies with npm..."
  npm install
fi

exec "$@"

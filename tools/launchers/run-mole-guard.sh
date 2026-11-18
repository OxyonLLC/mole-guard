#!/usr/bin/env bash
set -u

MODE="${1:-start}"
REPO="/home/winlew/Mole-Guard"

case "$MODE" in
  start)
    TITLE="Mole Guard"
    SCRIPT="start:all"
    ;;
  dev)
    TITLE="Mole Guard dev mode"
    SCRIPT="dev:all"
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo
    exec bash -i
    ;;
esac

cd "$REPO" || {
  echo "Repo not found: $REPO"
  echo
  exec bash -i
}

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

nvm use --silent default >/dev/null 2>&1 || nvm use --silent 22 >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node/npm not found in WSL. Check your nvm install."
  echo
  exec bash -i
fi

clear
echo "Starting $TITLE from $REPO"
npm run "$SCRIPT"
code=$?
echo
echo "Process exited with code $code"
exec bash -i

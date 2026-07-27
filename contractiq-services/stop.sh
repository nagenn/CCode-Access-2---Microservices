#!/bin/bash
set -e
cd "$(dirname "$0")"

PARENT_NAME=$(printf '%s' "$(basename "$(dirname "$(pwd)")")" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-')
export COMPOSE_PROJECT_NAME="contractiq-${PARENT_NAME}"

docker compose down

FRONTEND_PIDS=$(lsof -ti tcp:4200 2>/dev/null || true)
if [ -n "$FRONTEND_PIDS" ]; then
    echo "Stopping frontend dev server on port 4200 (pid(s): $FRONTEND_PIDS)..."
    kill $FRONTEND_PIDS
fi


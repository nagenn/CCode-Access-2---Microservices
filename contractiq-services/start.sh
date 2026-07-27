#!/bin/bash
set -e
cd "$(dirname "$0")"

PARENT_NAME=$(printf '%s' "$(basename "$(dirname "$(pwd)")")" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-')
export COMPOSE_PROJECT_NAME="contractiq-${PARENT_NAME}"

docker compose up -d --build
sleep 5
docker compose ps

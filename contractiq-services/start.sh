#!/bin/bash
set -e
cd "$(dirname "$0")"

docker compose up -d --build
sleep 5
docker compose ps

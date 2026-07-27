#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "=== Starting microservices (Ingestion, Rules, Agent) ==="
./contractiq-services/start.sh

echo ""
echo "=== Starting Angular frontend on port 4200 ==="
cd contractiq-services/frontend
npx ng serve --port 4200

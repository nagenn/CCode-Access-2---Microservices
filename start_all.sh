#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "=== Starting microservices (Ingestion, Rules, Agent) ==="
./contractiq-services/start.sh

echo ""
echo "=== Starting Angular frontend on port 4200 ==="
cd contractiq-services/frontend

if [ ! -d node_modules ] || [ ! -x node_modules/.bin/ng ]; then
  echo "=== node_modules missing or incomplete, running npm install ==="
  npm install
fi

npx ng serve --port 4200


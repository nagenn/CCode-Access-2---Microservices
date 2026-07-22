#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "=== Starting microservices (Ingestion, Rules, Agent) ==="
./contractiq-services/start.sh

echo ""
echo "=== Starting ContractIQ monolith (app.py) on port 8282 ==="
python3.9 -m uvicorn app:app --reload --port 8282

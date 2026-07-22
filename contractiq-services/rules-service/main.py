import json
import os
import time

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RULES_PATH = os.path.join(os.path.dirname(__file__), "compliance_rules.json")
INGESTION_SERVICE_URL = os.getenv("INGESTION_SERVICE_URL", "http://localhost:8001")

with open(RULES_PATH, "r") as f:
    COMPLIANCE_RULES = json.load(f)


def build_rules(rules: dict) -> list:
    """Flattens compliance_rules.json into the {id, description, severity_code} shape the API returns."""
    entries = []

    for i, clause in enumerate(rules.get("required_clauses", []), start=1):
        entries.append({
            "id": f"required_clause_{i}",
            "description": f"Contract must include a '{clause}' clause.",
            "severity_code": 1,
        })

    for i, term in enumerate(rules.get("prohibited_terms", []), start=1):
        entries.append({
            "id": f"prohibited_term_{i}",
            "description": f"Contract must not contain '{term}'.",
            "severity_code": 1,
        })

    for key, value in rules.get("risk_thresholds", {}).items():
        entries.append({
            "id": f"risk_threshold_{key}",
            "description": f"{key.replace('_', ' ').title()}: {value}",
            "severity_code": 2,
        })

    for key, value in rules.get("escalation_rules", {}).items():
        entries.append({
            "id": f"escalation_{key}",
            "description": f"{key.replace('_', ' ').title()}: {value}",
            "severity_code": 3,
        })

    return entries


RULE_ENTRIES = build_rules(COMPLIANCE_RULES)


def trace_entry(action: str, start: float, calls: list) -> dict:
    return {
        "service": "rules-service",
        "action": action,
        "duration_ms": round((time.perf_counter() - start) * 1000, 2),
        "calls": calls,
    }


@app.get("/rules")
def get_rules(filename: str):
    start = time.perf_counter()

    try:
        response = requests.get(
            f"{INGESTION_SERVICE_URL}/contracts/{filename}/exists",
            timeout=5,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach Ingestion Service to verify {filename}: {exc}",
        )

    exists_payload = response.json()

    if not exists_payload.get("exists"):
        raise HTTPException(
            status_code=404,
            detail=f"{filename} is not a known contract in Ingestion Service.",
        )

    trace = list(exists_payload.get("trace", []))
    trace.append(trace_entry(f"GET /rules?filename={filename}", start, ["ingestion-service"]))

    return {
        "rules": RULE_ENTRIES,
        "trace": trace,
    }

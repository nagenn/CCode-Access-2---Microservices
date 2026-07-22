import json
import os
import sqlite3
import time
from datetime import datetime
from typing import Literal, Optional

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
OPENAI_MODEL = "gpt-4o-mini"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

INGESTION_SERVICE_URL = os.getenv("INGESTION_SERVICE_URL", "http://localhost:8001")
RULES_SERVICE_URL = os.getenv("RULES_SERVICE_URL", "http://localhost:8002")

SEVERITY_LABELS = {1: "high", 2: "medium", 3: "low"}

# Stale/incomplete on purpose — a smaller subset of the real rule set,
# shaped identically to what Rules Service returns (severity_code, not
# severity) so it flows through map_severity() the same way. Only used
# when Rules Service is actually unreachable or times out.
DEFAULT_RULES = [
    {
        "id": "required_clause_1",
        "description": "Contract must include a 'Limitation of Liability' clause.",
        "severity_code": 1,
    },
    {
        "id": "required_clause_2",
        "description": "Contract must include a 'Indemnification' clause.",
        "severity_code": 1,
    },
    {
        "id": "prohibited_term_1",
        "description": "Contract must not contain 'unlimited liability'.",
        "severity_code": 1,
    },
]


class AnalyzeRequest(BaseModel):
    filename: str


# ----------------------------
# REVIEW-OUTCOME PERSISTENCE
# ----------------------------
# Independent of /analyze — a separate, deliberate call the frontend makes
# after a manual submit or after an agent run completes. Does not affect
# /analyze's behavior or response shape.

REVIEWS_DB_PATH = os.path.join(os.path.dirname(__file__), "reviews.db")


def get_reviews_db():
    conn = sqlite3.connect(REVIEWS_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_reviews_db():
    conn = get_reviews_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            review_type TEXT NOT NULL,
            status TEXT NOT NULL,
            reviewer TEXT,
            risk_level TEXT,
            notes TEXT,
            timestamp TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


init_reviews_db()


class ReviewCreate(BaseModel):
    filename: str
    review_type: Literal["manual", "agent"]
    status: Literal["cleared", "escalated"]
    reviewer: Optional[str] = None
    risk_level: Optional[str] = None
    notes: Optional[str] = None


@app.post("/reviews", status_code=201)
def create_review(payload: ReviewCreate):
    timestamp = datetime.now().isoformat()

    conn = get_reviews_db()
    cursor = conn.execute("""
        INSERT INTO reviews (filename, review_type, status, reviewer, risk_level, notes, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        payload.filename, payload.review_type, payload.status,
        payload.reviewer, payload.risk_level, payload.notes, timestamp,
    ))
    conn.commit()
    review_id = cursor.lastrowid
    conn.close()

    return {
        "id": review_id,
        "filename": payload.filename,
        "review_type": payload.review_type,
        "status": payload.status,
        "reviewer": payload.reviewer,
        "risk_level": payload.risk_level,
        "notes": payload.notes,
        "timestamp": timestamp,
    }


@app.get("/reviews")
def list_reviews():
    conn = get_reviews_db()
    rows = conn.execute("SELECT * FROM reviews ORDER BY id ASC").fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.delete("/reviews")
def reset_reviews():
    conn = get_reviews_db()
    deleted = conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
    conn.execute("DELETE FROM reviews")
    conn.commit()
    conn.close()
    return {"deleted": deleted}


def trace_entry(action: str, start: float, calls: list, **extra) -> dict:
    entry = {
        "service": "agent-service",
        "action": action,
        "duration_ms": round((time.perf_counter() - start) * 1000, 2),
        "calls": calls,
    }
    entry.update(extra)
    return entry


def map_severity(rules: list) -> list:
    return [
        {**rule, "severity": SEVERITY_LABELS.get(rule.get("severity_code"), "unknown")}
        for rule in rules
    ]


def build_prompt(contract_text: str, rules: list) -> str:
    return f"""
You are a legal contract review assistant.

Your task is to review the contract strictly against the provided compliance rules.
Do NOT invent rules. Do NOT provide legal advice.

CONTRACT TEXT:
{contract_text}

COMPLIANCE RULES:
{json.dumps(rules, indent=2)}

Follow these steps:
1. Identify missing required clauses.
2. Identify prohibited or risky terms.
3. Assess overall risk (Low, Medium, High).
4. Extract key obligations or deadlines.
5. Provide recommendations if risk is Medium or High.
6. Estimate your confidence (0.0-1.0).

Return ONLY valid JSON in this format:
{{
  "risk_score": "Low | Medium | High",
  "missing_clauses": [],
  "problematic_terms": [],
  "key_obligations": [],
  "recommendations": "",
  "confidence": 0.0
}}
"""


def run_llm_judgment(contract_text: str, rules: list) -> dict:
    if not contract_text.strip():
        return {
            "risk_score": "Unknown",
            "missing_clauses": [],
            "problematic_terms": [],
            "key_obligations": [],
            "recommendations": "Could not extract text from PDF.",
            "confidence": 0.0
        }

    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        temperature=0,
        messages=[{"role": "user", "content": build_prompt(contract_text, rules)}]
    )

    raw = response.choices[0].message.content

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        clean = raw.replace("```json", "").replace("```", "").strip()
        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            return {
                "risk_score": "Unknown",
                "missing_clauses": [],
                "problematic_terms": [],
                "key_obligations": [],
                "recommendations": "AI response could not be parsed.",
                "confidence": 0.0
            }


@app.post("/analyze")
def analyze(payload: AnalyzeRequest):
    filename = payload.filename
    overall_start = time.perf_counter()
    trace = []

    # 1. Contract text from Ingestion Service
    try:
        text_resp = requests.get(
            f"{INGESTION_SERVICE_URL}/contracts/{filename}/text", timeout=5
        )
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach Ingestion Service for {filename}: {exc}",
        )

    if text_resp.status_code == 404:
        raise HTTPException(status_code=404, detail=text_resp.json().get("detail", f"{filename} not found"))
    text_resp.raise_for_status()

    text_payload = text_resp.json()
    trace.extend(text_payload.get("trace", []))
    contract_text = text_payload.get("text", "")

    # 2. Rules from Rules Service, with a hardcoded fallback if it's down
    rules_call_start = time.perf_counter()
    try:
        rules_resp = requests.get(
            f"{RULES_SERVICE_URL}/rules", params={"filename": filename}, timeout=5
        )
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
        trace.append(trace_entry(
            f"GET /rules?filename={filename} (FAILED)",
            rules_call_start, ["rules-service"], error=str(exc),
        ))
        trace.append(trace_entry(
            "fallback: rules-service unreachable, using DEFAULT_RULES",
            time.perf_counter(), [],
        ))
        raw_rules = DEFAULT_RULES
    else:
        if rules_resp.status_code == 404:
            raise HTTPException(status_code=404, detail=rules_resp.json().get("detail", f"{filename} not found"))
        rules_resp.raise_for_status()
        rules_payload = rules_resp.json()
        trace.extend(rules_payload.get("trace", []))
        raw_rules = rules_payload.get("rules", [])

    mapped_rules = map_severity(raw_rules)

    # 3. LLM judgment, reusing analyze_contract.py's prompt/parsing logic unchanged
    result = run_llm_judgment(contract_text, mapped_rules)

    # 4. Translate the monolith's result shape into this endpoint's response
    issues = (
        [{"type": "missing_clause", "description": c} for c in result.get("missing_clauses", [])]
        + [{"type": "problematic_term", "description": t} for t in result.get("problematic_terms", [])]
    )

    trace.append(trace_entry(
        f"POST /analyze filename={filename}", overall_start,
        ["ingestion-service", "rules-service"],
    ))

    return {
        "filename": filename,
        "risk_level": result.get("risk_score", "Unknown"),
        "issues": issues,
        "recommendations": result.get("recommendations", ""),
        "confidence": result.get("confidence", 0.0),
        "key_obligations": result.get("key_obligations", []),
        "trace": trace,
    }

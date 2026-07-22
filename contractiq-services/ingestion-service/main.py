import os
import time

import pdfplumber
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CONTRACTS_FOLDER = os.path.join(os.path.dirname(__file__), "contracts")


def extract_contract_text(pdf_path: str) -> str:
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    return text


def scan_contracts_folder() -> list:
    if not os.path.exists(CONTRACTS_FOLDER):
        return []
    return sorted(f for f in os.listdir(CONTRACTS_FOLDER) if f.lower().endswith(".pdf"))


def trace_entry(action: str, start: float) -> dict:
    return {
        "service": "ingestion-service",
        "action": action,
        "duration_ms": round((time.perf_counter() - start) * 1000, 2),
        "calls": [],
    }


@app.get("/contracts")
def list_contracts():
    return [{"filename": filename} for filename in scan_contracts_folder()]


@app.get("/contracts/{filename}/text")
def get_contract_text(filename: str):
    start = time.perf_counter()
    pdf_path = os.path.join(CONTRACTS_FOLDER, filename)

    if not os.path.isfile(pdf_path):
        raise HTTPException(
            status_code=404,
            detail=f"PDF not found at {pdf_path}. Make sure the file is in the contracts/ folder."
        )

    text = extract_contract_text(pdf_path)

    return {
        "filename": filename,
        "text": text,
        "trace": [trace_entry(f"GET /contracts/{filename}/text", start)],
    }


@app.get("/contracts/{filename}/exists")
def contract_exists(filename: str):
    start = time.perf_counter()
    exists = os.path.isfile(os.path.join(CONTRACTS_FOLDER, filename))

    return {
        "filename": filename,
        "exists": exists,
        "trace": [trace_entry(f"GET /contracts/{filename}/exists", start)],
    }

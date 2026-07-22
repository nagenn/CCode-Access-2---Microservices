# ContractIQ — Microservices Split (Week 1, Act 4)

**Purpose:** Give trainees one guided investigation into the specific reasoning
that only exists across a network boundary — service ownership, stale
contracts, hidden dependencies, and network-failure reasoning — using a
domain they already know from the monolith, before they hit it for real
(and unguided) in their Week 2–3 epics.

**Design principle:** Reuse ContractIQ's logic and content wherever it saves
time. Rewrite only what the split structurally forces. The two gotchas
(hidden dependency + contract mismatch) are hand-designed, not left to
Claude Code's judgment.

Runs via `docker-compose up`. No orchestration, no k8s. Reliability of the
live demo matters more than fidelity to the client's real stack.

---

## Services

### 1. Ingestion Service (Python/FastAPI, port 8001)
Owns the PDFs and text extraction. This is the "who owns this data" service.

**Reused:** `extract_contract_text()` from `analyze_contract.py`, moved in
almost unchanged. Any PDFs dropped into `contracts/`. No hardcoded per-file
list of any kind — every contract is treated on its own merit, scanned
dynamically, exactly like the monolith's "Check for New" behavior.

**No contract-type classification of any kind.** No keyword matching, no
GPT-based classification, no type field anywhere. This was scope the
monolith never had, and the redesigned hidden dependency below doesn't
need it.

**Endpoints:**
- `GET /contracts` → `[{ "filename": str }]` — a plain scan of the
  `contracts/` folder, same semantics as "Check for New" in the monolith
- `GET /contracts/{filename}/text` → `{ "filename": str, "text": str, "trace": [...] }`
- `GET /contracts/{filename}/exists` → `{ "filename": str, "exists": bool, "trace": [...] }`
  — a thin existence check, used only by Rules Service (see below)

---

### 2. Rules Service (Python/FastAPI, port 8002)
Owns `compliance_rules.json`. **This is where the contract mismatch lives.**

**Reused:** `compliance_rules.json` content, verbatim.

**New:** a `README.md` inside this service documenting the endpoint as if it
were the real, trusted contract — this is the artifact trainees will read
*before* they trace the actual code:

> `GET /rules?contract_type={type}`
> Returns applicable compliance rules for the given contract type.
> Response: `{ "contract_type": str, "rules": [{ "id": str, "description": str, "severity": "high" | "medium" | "low" }] }`

**Actual behavior (the mismatch):** the real response uses
`"severity_code": 1 | 2 | 3` (1=high, 2=medium, 3=low) instead of the
documented string enum. The docs were never updated after a refactor —
exactly the "stale contract" failure mode. The Agent Service has to map
codes → labels itself, and if a trainee trusts the README instead of
tracing the real response, their expectation breaks immediately.

**Hidden dependency (the surprise):** Rules Service is a defensive
citizen — it doesn't trust that a `filename` it's been asked for rules on
is actually a real, ingested contract. Before responding, it silently
calls **Ingestion Service** (`GET /contracts/{filename}/exists`) to verify
the reference. This is an ordinary, realistic microservices pattern (don't
trust the caller, verify the reference) rather than a manufactured one —
it requires no classification of anything, and every contract still
receives the exact same universal rule set, just like the monolith. It's
invisible from reading Agent's code (which only appears to call Rules
Service) — a trainee only discovers the Rules → Ingestion hop by tracing
into Rules Service itself, or by watching the live trace panel. If the
existence check fails, Rules Service returns a 404 rather than the rule
set — which is itself a small extra teaching moment about a validation
failure one layer removed from where the caller expects it.

**Endpoints:**
- `GET /rules?filename={filename}` →
  `{ "rules": [{ "id": str, "description": str, "severity_code": int }], "trace": [...] }`
  — the **same universal rule set for every contract**, no branching by
  type, exactly matching the monolith's `compliance_rules.json` behavior

---

### 3. Risk Agent Service (Python/FastAPI, port 8003)
Owns the OpenAI call and judgment logic — the "brain," same as in the
monolith.

**Reused:** the OpenAI prompt and judgment logic from `analyze_contract.py`,
almost unchanged. The output JSON shape (risk level, issues found) stays
stable so the frontend's result rendering barely changes.

**New (forced by the split):** every function call that used to be local is
now an HTTP call with real failure modes:
- Calls Ingestion Service for contract text
- Calls Rules Service for applicable rules (passing `filename`, not knowing
  Rules will turn around and call Ingestion itself)
- Maps `severity_code` → label before building the final judgment
- **Failure/timeout lever for the demo:** if Rules Service is unreachable or
  times out (you can literally stop that container mid-demo), Agent falls
  back to a small hardcoded `DEFAULT_RULES` dict baked into its own code —
  stale and incomplete — and still returns a result, just a wrong one. This
  is the "what happens when a network call times out vs. a function
  throwing" moment, on demand, without scripting a fake failure.

**Endpoints:**
- `POST /analyze` `{ "filename": str }` →
  `{ "filename": str, "risk_level": str, "issues": [...], "trace": [...] }`

---

### Trace mechanism (shared across all three services)

Every request carries a `trace` array in its JSON body/response. Each
service appends one entry before returning:

```json
{ "service": "rules-service", "action": "GET /rules", "duration_ms": 42, "calls": ["ingestion-service"] }
```

The Agent aggregates the full trace across all hops and returns it to the
frontend. This is what replaces `index_after.html`'s single-process trace
panel — instead of function-level steps, trainees watch service-level hops,
including the one hop (Rules → Ingestion) that never shows up if you only
read Agent's code.

---

### Review-outcome persistence (added post-build, for the frontend's queue stats)

The queue's status badges/stats (Cleared vs. Escalated counts, per-contract
status) need something to persist across page refreshes — none of the
three original services store review outcomes anywhere. Rather than add a
fourth service, this is a small extension to **Agent Service**, since it
already owns judgment; recording outcomes (including manual ones) is a
natural extension of that, not a new concern.

SQLite-backed, same pattern as the monolith's `seed_contracts.py` /
`contracts.db`, just relocated into Agent Service.

**Endpoints:**
- `POST /reviews` — `{ "filename": str, "review_type": "manual"|"agent", "status": "cleared"|"escalated", "reviewer": str (optional, manual only), "risk_level": str (optional), "notes": str (optional) }` → records one outcome, called after a manual submit or after an agent run completes
- `GET /reviews` → `[{ filename, review_type, status, reviewer, risk_level, notes, timestamp }]` — the frontend's queue calls this on load to render badges/stats from real persisted state, not client-only memory

---

## Frontend (Angular)
Thin client, reusing the visual language of `index_after.html`:
- Contract list (from Ingestion Service)
- "Run Agent Review" button → calls Agent Service `/analyze`
- Trace panel rendering the hop-by-hop array, including nested hops
- Result panel — same shape as the monolith's, so it feels familiar

---

## Folder structure

```
contractiq-services/
├── docker-compose.yml
├── ingestion-service/
│   ├── main.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── contracts/                  ← reused PDFs
├── rules-service/
│   ├── main.py
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── compliance_rules.json       ← reused, verbatim
│   └── README.md                   ← the deliberately stale contract doc
├── agent-service/
│   ├── main.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env                        ← OPENAI_API_KEY
└── frontend/
    └── (Angular app)
```

---

## What trainees should walk away discovering

1. **Ownership:** Ingestion owns raw contracts + text; Rules owns
   compliance logic; Agent owns judgment. None of this is written down
   anywhere — they find it by tracing calls.
2. **Stale contract:** Rules Service's README says `severity` (string);
   real response says `severity_code` (int). Docs lied.
3. **Surprise dependency:** Agent's code looks like it only talks to Rules
   Service. Tracing reveals Rules Service quietly calls back into
   Ingestion Service to verify the filename actually exists before
   returning rules — a defensive check invisible from either endpoint's
   own code in isolation.
4. **Network failure reasoning:** stopping Rules Service mid-demo shows
   Agent silently degrading to a stale hardcoded fallback — a materially
   different failure mode than an in-process exception.

# Context Map — ContractIQ Microservices

Scope: `contractiq-services/` (Ingestion, Rules, Agent services + Angular
frontend), the active system per `start_all.sh` / `DESIGN.md`. The repo also
contains a separate legacy monolith (`app.py`, `analyze_contract.py`,
`seed_contracts.py`, `static/`) that this map does not cover in depth — it
is not wired to `start_all.sh` and appears to be the pre-split version the
services were extracted from. unknown — would need to verify whether the
monolith is still run/maintained independently.

All facts below were traced directly in this repo's source
(`contractiq-services/*/main.py`, frontend `.ts` files, `docker-compose.yml`,
`start.sh`/`start_all.sh`). Anything not directly read is marked as such.

---

## 1. Entry point(s)

- **User-facing entry point:** the Angular frontend at `localhost:4200`,
  started via `start_all.sh` → `contractiq-services/start.sh` (brings up the
  three backend containers via `docker compose up -d --build`) → `npx ng
  serve --port 4200` (unconatinerized, run in foreground).
- **App bootstrap:** `frontend/src/main.ts` → `bootstrapApplication(App,
  appConfig)` → `app.ts` (`AppComponent`), which renders
  `ContractQueueComponent` and `ContractDetailComponent`.
- From there, every real "request into the system" is one of three HTTP
  calls the frontend's `ApiService` (`frontend/src/app/services/api.service.ts`)
  makes directly from the browser to a backend container — there is no
  frontend backend-for-frontend/proxy layer:
  - `GET http://localhost:8001/contracts` (Ingestion Service)
  - `POST http://localhost:8003/analyze` (Agent Service)
  - `GET/POST/DELETE http://localhost:8003/reviews` (Agent Service)
- Each of those three backend services is also independently reachable
  (e.g. directly via curl) since CORS is scoped only to
  `http://localhost:4200`, not auth-gated — verified in each service's
  `main.py` (`CORSMiddleware(allow_origins=["http://localhost:4200"])`).
  So in practice there are four possible entry points into the system as a
  whole: the frontend, and each of the three backend services' own HTTP
  surface, all unauthenticated.

## 2. Data flow

**Loading the queue** (`ContractQueueComponent.ngOnInit` →
`loadContracts()`, `contract-queue.ts:64`):
1. `GET /contracts` → Ingestion Service (`ingestion-service/main.py:45`),
   which does a live `os.listdir()` scan of `ingestion-service/contracts/`
   for `*.pdf` files — no DB, no cache, no per-file metadata.
2. In parallel, `ReviewsStoreService.refresh()` → `GET /reviews` → Agent
   Service (`agent-service/main.py:135`), reading all rows from
   `agent-service/reviews.db` (SQLite).
3. The queue's `rows` computed signal (`contract-queue.ts:32`) joins these
   two independently-fetched lists client-side: each contract's badge is
   the *latest* review row for that filename, or `'pending'` if none exists.

**Running an agent review** (`AgentReview.runAgentReview()`,
`agent-review.ts:34`):
1. `POST /analyze {filename}` → Agent Service (`agent-service/main.py:240`).
2. Agent calls `GET /contracts/{filename}/text` on Ingestion Service
   (`main.py:248`) to get extracted PDF text (`pdfplumber`-based,
   `extract_contract_text()`).
3. Agent calls `GET /rules?filename={filename}` on Rules Service
   (`main.py:268`). Rules Service itself, before responding, calls back into
   Ingestion Service — `GET /contracts/{filename}/exists`
   (`rules-service/main.py:77`) — to verify the filename is real; 404s if
   not. This hop is invisible from Agent's own code.
4. If the Rules Service call fails/times out (connection error or timeout,
   5s), Agent catches it and falls back to a small hardcoded
   `DEFAULT_RULES` list (3 entries vs. Rules Service's real ~11) — still
   returns 200, just on stale/incomplete rules (`main.py:38-54,266-280`).
5. Agent maps `severity_code` (1/2/3) → `"high"/"medium"/"low"` label
   locally (`map_severity()`, `main.py:164`) — required because Rules
   Service's actual response uses codes, not the labels its own README
   documents (see §3).
6. Agent builds a prompt (`build_prompt()`, `main.py:171`) embedding the
   contract text + mapped rules, calls OpenAI (`gpt-4o-mini`, temperature
   0) via `run_llm_judgment()` (`main.py:204`), and parses the returned
   JSON (with a couple of fallback un-fencing attempts if the model wraps
   it in ```json```).
7. Response `{filename, risk_level, issues, recommendations, confidence,
   key_obligations, trace}` returns to the frontend. `issues` is built
   client-independent — Agent flattens `missing_clauses` +
   `problematic_terms` into one `issues[]` array itself (`main.py:295-298`).
8. Frontend renders the trace as a graph (`buildTraceTree()` /
   `flattenForReveal()` in `util/trace-tree.ts`, inferring parent/child
   nesting from array adjacency, not IDs — verified by reading the
   function) and the result via `ResultPanelComponent`.
9. Once the trace reveal finishes (`onTraceRevealed()`, `agent-review.ts:54`),
   the frontend makes a **separate, second** call: `POST /reviews` with
   `status = deriveReviewStatus(res.risk_level, res.confidence)` — this is
   the step that persists the queue badge, and the confidence argument is
   what lets low-confidence results force `'escalated'` regardless of risk
   (see §4's Confidence-Based Escalation entry). It is not part of
   `/analyze` itself; if this second call fails, the analysis result is
   still shown, but a `recordError` is surfaced and the queue badge does
   not update.

**Manual review** (`ManualReviewComponent.submit()`, `manual-review.ts:63`)
bypasses Agent/OpenAI/Ingestion/Rules entirely — it's a client-side
checklist + reviewer-selected risk level, and calls `POST /reviews`
directly with `status = deriveReviewStatus(risk)`, same function as the
agent path.

## 3. Dependencies & contracts (promised vs. actually true)

| Service | Documented/claimed | Actually verified in code | Match? |
|---|---|---|---|
| Ingestion Service | No formal README found in `ingestion-service/`. `ContractIQ_Microservices_Spec.md` and `DESIGN.md` describe `GET /contracts` as a live folder scan, no classification. | Confirmed: `scan_contracts_folder()` does `os.listdir()` + `.pdf` filter, no DB, no per-file hardcoding (`ingestion-service/main.py:30-33`). | Matches. |
| Rules Service | `rules-service/README.md` documents `GET /rules?filename=` returning `severity: "high"\|"medium"\|"low"` (string enum). | Actual response uses `severity_code: 1\|2\|3` (int) — `rules-service/main.py:26-57` (`build_rules()`), confirmed by reading the live response shape. No `severity` string field exists anywhere in Rules Service's output. | **Does not match — stale doc.** Confirmed first-hand, not just per `DESIGN.md`'s claim. |
| Rules Service | Neither README nor Agent's code (`agent-service/main.py`) mentions Rules Service calling anything else. | Rules Service calls `GET /contracts/{filename}/exists` on Ingestion Service before returning rules (`rules-service/main.py:77-97`), 404ing if the file doesn't exist. This is a real hidden dependency, invisible from Agent Service's code (which only appears to call Rules directly) and undocumented in Rules Service's own README. | **Undocumented dependency — confirmed by reading `rules-service/main.py` directly**, not inferred. |
| Agent Service | No README in `agent-service/`. `ContractIQ_Microservices_Spec.md` describes response shape `{risk_level, issues}`; `DESIGN.md` says the real shape is a superset also carrying `recommendations`, `confidence`, `key_obligations`. | Confirmed in code: `main.py:305-313` returns exactly `{filename, risk_level, issues, recommendations, confidence, key_obligations, trace}`. | Matches `DESIGN.md`; the original spec doc is itself stale relative to the built system (acknowledged in `DESIGN.md`'s "Deviations" section). |
| Agent Service — `compliance_rules.json`'s `escalation_rules.confidence_below` | Present in both `compliance_rules.json` (root) and `rules-service/compliance_rules.json` at `0.75`. Rules Service flattens it into a `severity_code: 3` rule entry (`escalation_confidence_below`, `rules-service/main.py:50-55`), so it is visible to the LLM as prompt text (via the rules list embedded in `build_prompt()`). | `confidence` comes back from the LLM in `/analyze`'s response and is displayed in `result-panel.ts:26` as a rounded percentage. As of §4's Confidence-Based Escalation component, it is now also **read** by `deriveReviewStatus(riskLevel, confidence?)` (`reviews-store.service.ts`), which forces `'escalated'` whenever `confidence` is below the exported `CONFIDENCE_ESCALATION_THRESHOLD = 0.75`, regardless of `riskLevel` — called with both arguments from `agent-review.ts`'s `onTraceRevealed()`. | **Now enforced** for the agent-review path (see §4). `compliance_rules.json`'s `0.75` is still not read directly at runtime by the frontend — the frontend threshold is a separately-hardcoded constant that mirrors it (see §5 for the duplication risk this creates). |
| `agent-service/reviews.db` persistence | `DESIGN.md` says it's independent of `/analyze`, always a separate explicit call, not volume-mounted (resets on `docker compose down`/rebuild). | Confirmed: `/analyze` (`main.py:240-313`) never touches `reviews.db`; only `/reviews` endpoints do (`main.py:107-150`). Did not independently verify the volume-mount/persistence claim against `Dockerfile`/compose — unknown, would need to verify by inspecting `agent-service/Dockerfile` and confirming no `volumes:` entry in `docker-compose.yml` for reviews.db (a quick check of `docker-compose.yml` §2 above shows no `volumes:` key under `agent-service` at all, which is consistent with the claim). |
| Frontend routing to backends | `DESIGN.md` says frontend never calls Rules Service directly. | Confirmed: `api.service.ts` only defines calls to `INGESTION_URL` (8001) and `AGENT_URL` (8003); no reference to port 8002 anywhere in `frontend/src/app/`. | Matches. |
| `.env` (`agent-service/.env`, holds `OPENAI_API_KEY`) | Implied to configure the real OpenAI call. | Did not read the file's actual contents (may contain a live secret) or verify the key is valid/has quota. unknown — would need to verify. |

## 4. Where a change would live

- **Contract text extraction changes** → `ingestion-service/main.py`,
  `extract_contract_text()` and the two `/contracts...` route handlers.
- **Compliance rule content/shape changes** → `compliance_rules.json` (root,
  and its duplicate copy at `contractiq-services/rules-service/
  compliance_rules.json` — currently two separate files kept in sync
  manually; a rule change requires editing both, or deduplicating them) and
  `rules-service/main.py`'s `build_rules()` if the flattening shape itself
  changes.
- **Rules Service API doc/contract fixes** (e.g. reconciling the
  `severity`/`severity_code` mismatch) → `rules-service/README.md` (doc)
  and/or `rules-service/main.py:build_rules()` (behavior).
- **LLM prompt/judgment logic, OpenAI model/params, response parsing** →
  `agent-service/main.py`: `build_prompt()`, `run_llm_judgment()`.
- **Fallback-on-Rules-Service-failure behavior** →
  `agent-service/main.py`'s `DEFAULT_RULES` constant and the `try/except`
  block in `analyze()` (`main.py:266-280`).
- **Review-outcome persistence / schema** → `agent-service/main.py`
  (`init_reviews_db()`, `ReviewCreate` model, `/reviews` routes) — SQLite,
  single file, not a separate service.
- **Escalation/status decision logic (Low/Medium/High → cleared/escalated)**
  → `deriveReviewStatus()` in
  `contractiq-services/frontend/src/app/services/reviews-store.service.ts:7-9`,
  called from both `agent-review.ts:63` (agent path) and
  `manual-review.ts:79` (manual path).
- **Trace panel / hop graph rendering** →
  `frontend/src/app/util/trace-tree.ts` (`buildTraceTree`,
  `flattenForReveal`) and `components/trace-diagram/trace-diagram.ts`.
- **Result display (risk/issues/recommendations/confidence/obligations)** →
  `frontend/src/app/components/result-panel/result-panel.ts`.

### Component: Confidence-Based Escalation

**STATUS: Implemented and validated — `deriveReviewStatus()` in
`reviews-store.service.ts`, confirmed 2026-08-11.**

**Requirement:** if the LLM's self-reported confidence falls below
`escalation_rules.confidence_below` (0.75), the contract must be flagged
for mandatory human review — regardless of `risk_score` — and this
decision must actually be enforced in `deriveReviewStatus()`
(`reviews-store.service.ts`), and visible in the response, not merely
present as prompt text.

**Note on current state:** this is now implemented. `deriveReviewStatus(riskLevel: string, confidence?: number)`
(`reviews-store.service.ts:15-20`) exports `CONFIDENCE_ESCALATION_THRESHOLD
= 0.75` (mirroring `escalation_rules.confidence_below`) and forces
`'escalated'` whenever `confidence` is provided and falls below that
threshold, regardless of `riskLevel`. It's called with both arguments from
`agent-review.ts`'s `onTraceRevealed()` (`agent-review.ts:63`) — the only
call site with a real LLM-reported confidence value. `manual-review.ts`'s
call site (`manual-review.ts:79-80`) is deliberately left risk-only
(`deriveReviewStatus(risk)`, no confidence argument), with an inline
comment noting this is intentional, since a human-entered manual review has
no LLM confidence signal to evaluate. `result-panel.ts`/`.html`'s
escalation notice was fixed in the same change to reflect the real derived
status via new `isEscalated`/`isLowConfidenceEscalation` computed signals —
previously it only checked `risk_level === 'High'`, silently missing the
`Medium`-risk case that `deriveReviewStatus` also escalates, and had no
notion of confidence at all. The notice now shows a distinct second
sentence when escalation was confidence-forced, naming the actual
confidence percentage and the 75% threshold.

## 5. Risk areas / open unknowns

- **`escalation_rules.confidence_below` enforcement now lives in a
  hardcoded frontend constant, not the config file.** §4's implementation
  added `CONFIDENCE_ESCALATION_THRESHOLD = 0.75` directly in
  `reviews-store.service.ts` rather than reading it from
  `compliance_rules.json` at runtime — the frontend has no live fetch path
  to either copy of that file (it only calls Ingestion/Agent Service, never
  Rules Service directly; see §1). So the value is now duplicated a third
  time (root `compliance_rules.json`, `rules-service/compliance_rules.json`,
  and this new frontend constant), and nothing enforces the three stay in
  sync — if someone changes the threshold in `compliance_rules.json`
  expecting enforcement to follow, it silently won't. Only the agent-review
  path enforces it; the manual-review path has no confidence signal at all
  and is unaffected by design.
- **Two copies of `compliance_rules.json`** (repo root and
  `rules-service/`) are not the same file and nothing enforces they stay in
  sync — unknown whether the root copy is even read by anything at
  runtime in the microservices system (it doesn't appear to be; Rules
  Service reads its own local copy via `RULES_PATH =
  os.path.join(os.path.dirname(__file__), ...)`). Root copy may be a
  leftover from the monolith. unknown — would need to verify whether
  anything in the microservices path still depends on the root file.
- **No auth on any of the three services or the frontend.** All four HTTP
  surfaces (frontend origin + 3 backend ports) are open on localhost with
  permissive CORS scoped only by origin header, which a non-browser client
  can spoof trivially. Fine for a local demo; would be a real gap in any
  non-local deployment. unknown — would need to verify if this system is
  ever deployed beyond localhost.
- **`reviews.db` persistence guarantees** — did not verify against
  `agent-service/Dockerfile` whether the SQLite file could be lost on
  container rebuild beyond what `DESIGN.md` claims (no explicit
  `volumes:` mount was found in `docker-compose.yml`, which is consistent
  with "resets on down/rebuild," but I did not test this by actually
  rebuilding).
- **OpenAI call has no retry/circuit-breaker and no timeout set explicitly**
  in `run_llm_judgment()` (`agent-service/main.py:215-219`) — unlike the
  Ingestion/Rules HTTP calls, which use explicit `timeout=5`. Behavior
  under OpenAI slowness/outage is unknown — would need to verify (not
  something the "stop the container" demo lever covers, since OpenAI isn't
  a container in this stack).
- **JSON-parsing fallback in `run_llm_judgment()`** silently returns a
  `confidence: 0.0` / `"Unknown"` risk stub if the model's output can't be
  parsed as JSON even after de-fencing (`main.py:223-237`). Combined with
  the current dead `confidence_below` enforcement (above), a malformed LLM
  response and a genuinely low-confidence LLM response are currently
  indistinguishable to the rest of the system — both just produce
  `confidence: 0.0` and neither forces escalation today. Worth confirming
  the new escalation logic in §4 correctly forces review in **both** cases,
  not just the genuine low-confidence case.
- **`.env` contents (`agent-service/.env`) not inspected** — did not open
  this file (may contain a live API key); unknown whether the key is valid
  or rate-limited, which would affect testing the new escalation logic
  end-to-end against a real OpenAI response.
- **Legacy monolith (`app.py` et al.) relationship to this system** —
  confirmed via `DESIGN.md` that `start_all.sh` "does not touch" it, but I
  did not check whether it's still deployed/used anywhere else, or whether
  it has its own independent copy of escalation logic that would also need
  the same fix. unknown — would need to verify.
- **`.claude/agents/requirements-validator.md`** — worth flagging as a
  repo-hygiene issue, not a system risk: this agent-definition file's
  frontmatter `name:` is `escalation-builder` (mismatched with its own
  filename), and its body already references this exact requirement but
  names the enforcement function as `reviewStatusFromRisk()`
  (`reviews-store.service.ts`) — a name that does not exist in the
  codebase; the real function is `deriveReviewStatus()`, in the file it
  correctly names. Anyone using that agent definition literally should
  target the real function name, not the one written in the agent file.

# ECE444 practical applications

## PRA3 — Docker
Run `docker compose up --build` from the repository root. The API is available at http://localhost:5000/api/health. The container runs as a non-root user. Configure backend/.env locally (never commit secrets). Production deployment remains configured separately on Render.

## PRA6 — Test-driven development
For new scoring and detection-filtering behavior, first write a failing pytest test for the input/output contract (red), implement the minimal fix (green), and refactor with the full suite passing. Existing CI checks backend, data-processing and frontend tests.

## PRA8 — Dependency supply chain
Security CI audits Python requirements, npm production packages and repository secrets. Audit failures must be triaged: identify affected direct/transitive dependency, assess reachability and upgrade path, then document any justified exception. Lockfiles alone do not guarantee availability of upstream packages. Do not put credentials in test fixtures.

## Ask Ash memory
The existing frontend already passes up to twelve prior conversation turns to the Flask endpoint and clears the conversation using New chat. The server treats browser-supplied history as untrusted and limits lengths. This is conversation-local memory, not persistent cross-device memory. Do not add Flask cookie sessions just to duplicate this behavior.

## Observability
The existing /api/health and /api/health/db routes cover application and database reachability. Add production monitoring using the hosting platform; avoid claiming data is fresh based only on HTTP health. Use observation timestamps from detections and monitored areas when displaying freshness.

## PRA4
Use [the usability study template](usability-study-template.md) with two real participants. No test results have been collected by this change.

## API diagnostics (implemented)
Set a strong random `METRICS_TOKEN` in the Render service environment, then request `GET /api/internal/metrics` with `Authorization: Bearer <token>`. Without the token, the endpoint returns 404. It reports process-local request counts by status class and bounded p95 latency samples by Flask endpoint; it intentionally does not log user prompts, raw URLs, IP addresses, or request bodies. Each Gunicorn worker maintains independent counters, so this is diagnostic information rather than a globally aggregated SLO dashboard. Do not put the token in frontend code or Vercel environment variables exposed to the browser.

## Regression coverage
`backend/tests/test_tdd_edge_cases.py` checks malformed detection rows, limit bounds, invalid weather inputs, minimum scoring coverage and bounded risk scores. `backend/tests/test_metrics_api.py` checks access control. Run `cd backend && python -m pytest -q` before deploying. The GitHub Actions workflow must be checked separately; commits alone do not prove tests passed.

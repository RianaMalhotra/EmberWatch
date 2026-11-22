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

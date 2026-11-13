# Sprint 4 — React/Flask integration contracts (#50, #63)

This document describes endpoints and client behavior verified in the current code. It is not a production-readiness claim.

## Architecture

React/Vite dashboard → `frontend/src/services/riskApi.js` and `detectionApi.js` → Flask `backend/app.py` → database-backed services (where configured). Risk scores describe environmental conditions; detection confidence describes a satellite observation. Do not interchange them.

## Verified client contracts

| Endpoint | Client | Required response field | Empty behavior | Invalid response |
| --- | --- | --- | --- | --- |
| `GET /api/risk-areas` | `fetchRiskAreas()` | `data` array | `data: []` is valid | Reject with `Invalid risk data received` |
| `GET /api/detections?limit=200` | `fetchDetections(limit)` | `detections` array | `detections: []` is valid | Reject with `Invalid detection data received` |
| `GET /api/health` | Backend health route | Health JSON | Not applicable | Check HTTP status |

Representative **test fixture**, not a live reading:

```json
{
  "status": "success",
  "source": "database",
  "detections": [{
    "id": 1,
    "latitude": 50.1,
    "longitude": -120.3,
    "timestamp": "2025-07-01T18:30:00Z",
    "confidence": 80,
    "classification": "potential_wildfire",
    "meets_threshold": true
  }],
  "gaps": [],
  "counts": {
    "total": 1,
    "shown": 1,
    "potential_wildfire": 1,
    "low_confidence": 0,
    "unavailable": 0
  }
}
```

The detection client sanitizes invalid coordinates and confidence before rendering map markers. Both clients reject non-JSON or malformed envelopes; failed requests should produce unavailable/error UI, not invented observations.

## Local setup and test commands

From a clean checkout:

```bash
cd backend
python -m venv .venv
# Activate the virtual environment for your shell
python -m pip install -r requirements.txt
python -m pytest tests
python app.py
```

In another terminal:

```bash
cd frontend
npm ci
npm test -- --run
npm run build
npm run dev
```

Set `VITE_API_BASE_URL` to the deployed Flask origin when the frontend is hosted separately. If unset, clients use same-origin `/api` paths, which require a working reverse proxy. Flask CORS must permit the actual frontend origin. The backend database connection is configured through `DATABASE_URL` using the Supabase connection details; keep credentials in local ignored environment files or deployment secrets, never in commits.

## Scope and limitations

- This PR adds client contract regression tests for empty, malformed, and invalid-geography responses. It does not prove a live Supabase connection or the deployed frontend/backend integration.
- Backend routes and database configuration should be verified against the deployed environment before claiming end-to-end success.
- Sprint 4 UI redesign remains under separate review in PR #92. Do not treat a passing contract test as confirmation that all mobile interactions work.
- Existing README project links and setup instructions are preserved; this document supplements them.

## Evidence

- `frontend/src/services/detectionApi.test.js`: detection response and sanitization contracts
- `frontend/src/services/riskApi.test.js`: risk response contracts
- GitHub Actions checks on the accompanying PR provide reproducible CI evidence once completed.

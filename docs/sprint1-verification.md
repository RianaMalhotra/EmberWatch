# Sprint 1 integration verification

The React risk map calls `GET /api/risk-areas` through `frontend/src/services/riskApi.js`. Since Sprint 3 (#44) that endpoint scores each monitored area with the same model as `POST /api/risk-score`, using the latest stored environmental observation. The values are provisional model output, not live or validated wildfire risk, so do not label the map as such.

## Local smoke test

In a terminal at the repository root:

```bash
cd backend
python -m pip install -r requirements.txt
python -m pytest -q
python app.py
```

In a second terminal at the repository root:

```bash
cd frontend
npm ci
npm run build
npm run dev
```

Open http://localhost:5173 and verify that the map renders a colored circle and a translucent 50 km zone for each monitored area (this needs a working `DATABASE_URL` and loaded data, see below). In the browser's Network tab, confirm that `GET http://127.0.0.1:5000/api/risk-areas` returns HTTP 200. Stop Flask and reload to verify the frontend displays an error instead of inventing values.

## Database check

Copy `backend/.env.example` to `backend/.env`, then set `DATABASE_URL` using the **Session pooler** connection string from Supabase (see `docs/database.md`). Do not commit credentials.

With Flask running, request `http://127.0.0.1:5000/api/health/db`:

- HTTP 200 / `status: ok`: database reachable.
- HTTP 503 / `status: unavailable`: check the Supabase project status, pooler host, username, password and connection string. The automated tests mock this dependency; passing them **does not** prove that the live database is reachable.

## Risk scoring

`POST /api/risk-score` accepts environmental factors and calculates an area score. `GET /api/risk-areas` now uses the same `score_area` model (Sprint 3, #44) and preserves the incomplete/missing-data indicators: an area with too little data has a `null` score and level, and the map draws it grey with no zone shading. The map does not read the stored `risk_assessments` rows; it scores from the latest observation on each request.

## Review before closing Sprint 1

- [ ] Backend pytest suite passes locally or in CI
- [ ] Frontend production build succeeds
- [ ] Browser map successfully fetches `/api/risk-areas`
- [ ] API failure displays an error, not fabricated risk data
- [ ] Supabase health check passes with the team's actual credentials
- [ ] Sprint board and merged PRs reflect the agreed Sprint 1 scope

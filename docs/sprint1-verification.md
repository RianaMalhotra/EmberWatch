# Sprint 1 integration verification

The React risk map already calls `GET /api/risk-areas` through `frontend/src/services/riskApi.js`. That endpoint **currently returns mock data**, not the results of the separate `POST /api/risk-score` model. Do not label the map as live wildfire risk.

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

Open http://localhost:5173 and verify that the map renders three colored risk circles and clearly identifies the values as demo data. In the browser's Network tab, confirm that `GET http://127.0.0.1:5000/api/risk-areas` returns HTTP 200. Stop Flask and reload to verify the frontend displays an error instead of inventing values.

## Database check

Copy `backend/.env.example` to `backend/.env`, then set `DATABASE_URL` using the **Session pooler** connection string from Supabase (see `docs/database.md`). Do not commit credentials.

With Flask running, request `http://127.0.0.1:5000/api/health/db`:

- HTTP 200 / `status: ok`: database reachable.
- HTTP 503 / `status: unavailable`: check the Supabase project status, pooler host, username, password and connection string. The automated tests mock this dependency; passing them **does not** prove that the live database is reachable.

## Risk scoring

`POST /api/risk-score` accepts environmental factors and calculates an area score. The map does **not** yet use that endpoint or the database-backed assessments. Integrating calculated scores into `GET /api/risk-areas` is separate follow-up work, and should preserve explicit incomplete/missing-data indicators.

## Review before closing Sprint 1

- [ ] Backend pytest suite passes locally or in CI
- [ ] Frontend production build succeeds
- [ ] Browser map successfully fetches `/api/risk-areas`
- [ ] API failure displays an error, not fabricated risk data
- [ ] Supabase health check passes with the team's actual credentials
- [ ] Sprint board and merged PRs reflect the agreed Sprint 1 scope

## Later implementation update: risk zones (#44)

This document records the original Sprint 1 workflow. The current dashboard consumes database-backed risk areas and uses the same weighted risk-scoring service as the backend route. The overlay added in #44 displays an optional 50 km zone for each area, with score-based shading and a dashed outline for incomplete input data. Unscored areas receive no shading; these circles are not interpolated, validated forecasts, or operational wildfire alerts. Refer to `docs/component-interfaces.md` and `docs/environmental-data.md` for current behavior and database setup.

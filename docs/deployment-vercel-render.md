# Deployment, verification and rollback (issues #95 and #61)

EmberWatch runs as three separately hosted pieces:

| Piece | Host | What it does |
|---|---|---|
| Frontend (React/Vite) | Vercel | The website. Calls the backend from the browser. |
| Backend (Flask API) | Render | Reads the database and answers `/api/*`. |
| Database (PostgreSQL + PostGIS) | Supabase | Detections, areas, environmental data, risk results, fire reports. |

GitHub Actions also runs scheduled jobs that load new satellite detections (every 3 hours) and weather data (daily) into the database, plus a watchdog that alerts if the detection refresh has not succeeded recently.

The Vite development proxy exists **only** while running `npm run dev`. Vercel has no Flask process: without `VITE_API_BASE_URL`, browser requests to `/api/risk-areas` and `/api/detections` hit Vercel and return HTTP 404.

## 1. Environment variables

Never put a secret in a `VITE_*` variable: Vite embeds those into the browser bundle for everyone to read.

### Backend (Render, or `backend/.env` locally)

| Variable | Needed? | Notes |
|---|---|---|
| `DATABASE_URL` | **Required** | Supabase **session pooler** connection string (keep secret). Without it the database routes answer 503. |
| `CORS_ORIGINS` | **Required** | Exact frontend origin(s), comma-separated, **no trailing slash**, e.g. `https://ember-watch-xi.vercel.app`. Include any preview origin you are testing. Never use `*`. Default is `http://localhost:5173` only. |
| `REPORT_HASH_SALT` | **Required on Render** | At least 32 random characters. Without it, `POST /api/reports` is refused with 503. Generate: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Keep it secret and don't change it, or the rate limit resets. |
| `TRUSTED_PROXY_COUNT` | **Required on Render** | Set to `1` (one proxy in front of the app). With the default `0`, every visitor shares the proxy's address and one rate limit. |
| `RENDER` | Set by Render | Render sets `RENDER=true` itself. It switches on the `REPORT_HASH_SALT` check. Do not set it by hand. |
| `REPORTS_REQUIRE_SALT` | Optional | `true` applies the same salt check on a host that is not Render (Docker, a VM). |
| `REPORT_RATE_LIMIT`, `REPORT_RATE_WINDOW_MINUTES` | Optional | Reports per sender per window. Defaults: 5 per 10 minutes. |
| `OPENAI_API_KEY` | Optional | Enables Ask Ash model answers. Without it `POST /api/ash-detective` answers 503 and the page uses its local guidance. Keep it secret. |
| `ASH_DETECTIVE_MODEL` | Optional | Model name for Ask Ash. Default `gpt-4o-mini`. |
| `METRICS_TOKEN` | Optional | Bearer token for `GET /api/internal/metrics`. Unset means that route answers 404. Metrics are kept in memory per worker process, so with 2 gunicorn workers each request may see a different worker's numbers. |
| `MIN_DETECTION_CONFIDENCE` | Optional | 0 to 100. Default `20`. The value is provisional; change it only after a team decision (see [threshold backtest](threshold-backtest.md)). A bad value makes `/api/detections` answer 500. |
| `DB_STATEMENT_TIMEOUT_MS` | Optional | Cancels a database query that runs longer than this. Opt-in because some Supabase poolers reject startup options; check `/api/health/db` after setting it. |

The full list with comments is in `backend/.env.example`. A test (`tests/test_env_documented.py`) fails if backend code reads a variable that is missing from that file or from this page.

### Frontend (Vercel build environment)

| Variable | Needed? | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | **Required** | The Render origin only: no `/api`, no trailing slash. Read at **build time**, so redeploy after changing it. |
| `VITE_ENABLE_REPORTS` | Optional | `true` makes the Report a Fire form send reports. Unset, the form runs as a preview and sends nothing. `POST /api/reports` (#52) is merged, so turn it on once `REPORT_HASH_SALT` and the `fire_reports` migration are in place. Also read at build time. |

### GitHub Actions secrets (repository settings)

| Secret | Used by |
|---|---|
| `DATABASE_URL` | Detection refresh and weather refresh workflows |
| `FIRMS_MAP_KEY` | Detection refresh workflow |

The scheduled jobs do not run on forks, which have no secrets.

## 2. Database (Supabase)

Apply every file in `supabase/migrations/` **in filename order**, once, to the Supabase project (SQL editor, or `supabase db push`):

| Order | File | Adds |
|---|---|---|
| 1 | `20261014000000_init_schema.sql` | PostGIS, `detections`, `areas`, `environmental_observations`, `risk_assessments`, row level security |
| 2 | `20261018000000_area_terrain.sql` | Terrain columns on `areas` |
| 3 | `20261031000000_detections_unique_nulls.sql` | Duplicate check that treats a missing satellite as one value. **Needs PostgreSQL 15 or newer** (`NULLS NOT DISTINCT`) |
| 4 | `20261112000000_fire_reports.sql` | `fire_reports` table and row level security |

The SQL editor does not remember what you ran, so write each applied file and the date in the blockers log below. Migrations only go forward: there are no "down" scripts (see rollback below).

### Automated check

From the repository root, with `DATABASE_URL` in `backend/.env` (or the environment):

```bash
python scripts/check_migrations.py
```

It is read-only (the transaction is opened read-only, so a write is refused by the database), never prints the connection string, and prints a Markdown table to paste into #61: PostgreSQL version, PostGIS, the five tables, row level security, the terrain columns, the `detections_unique` constraint (including that it is the new `NULLS NOT DISTINCT` version) and row counts. Exit code 0 means nothing failed, 1 means a check failed or the database could not be reached. It confirms the schema matches the migration files; it does not replay them.

### Manual check in the SQL editor

The same checks by hand:

```sql
select version();                                   -- must be PostgreSQL 15 or newer
select extname from pg_extension where extname = 'postgis';
select to_regclass('public.detections'), to_regclass('public.areas'),
       to_regclass('public.environmental_observations'),
       to_regclass('public.risk_assessments'), to_regclass('public.fire_reports');
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'areas'
   and column_name in ('province', 'elevation_m', 'slope_deg', 'terrain_source', 'terrain_retrieved_at');
select conname from pg_constraint
 where conrelid = 'public.detections'::regclass and conname = 'detections_unique';
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('detections', 'areas', 'environmental_observations', 'risk_assessments', 'fire_reports');
```

Expected: PostGIS listed, five table names (none empty), five terrain columns, one `detections_unique` row, and `relrowsecurity = true` on all five tables. More in [database.md](database.md).

## 3. Render backend

In Render, configure the Flask web service with:

- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn --bind 0.0.0.0:$PORT app:app`
- The environment variables in section 1.

Redeploy Render after changing environment variables.

To run the same backend in Docker instead: `docker compose up --build` from the repository root (needs `backend/.env`; the API is at `http://localhost:5000`, and the port in the image is fixed at 5000). The container runs as a non-root user.

## 4. Vercel frontend

In the Vercel project with **Root Directory = frontend**, go to **Settings → Environment Variables** and add `VITE_API_BASE_URL` (and `VITE_ENABLE_REPORTS` if reports are on), for **Production** and **Preview**. **Redeploy** production and an affected branch preview after saving, because Vite reads the value at build time.

## 5. Verify the deployment

### Automated smoke check

From the repository root (needs only Python; read-only, no secrets):

```bash
python scripts/smoke_check.py https://<your-render-host> --frontend-origin https://<your-vercel-site>
```

It checks `/api/health`, `/api/health/db`, `/api/detections`, `/api/risk-areas` and `/api/health/freshness`, times each request, and confirms CORS allows your frontend origin but not an unknown one. It waits and retries while a sleeping Render instance wakes up. It prints a Markdown table: paste it into #61 as evidence. Exit code 0 means nothing failed (warnings are allowed), 1 means a check failed. Use `--min-areas 13` to require all 13 monitored areas.

### Manual browser check

Open the deployed frontend with Developer Tools → Network and reload:

- `risk-areas` and `detections` requests go to the **Render** origin, not the Vercel origin, and return 200 JSON.
- A CORS error means the exact Vercel origin is missing from `CORS_ORIGINS`. Add it and redeploy Render.
- The map loads and the dashboard shows the monitored areas and detections, with no false empty or error state.
- Render's free instance may sleep after inactivity. Allow for a cold start and use **Try again**; a sleeping instance is different from Vercel returning 404.

### Clean-install check (do this on a fresh clone or a clean machine)

```bash
cd backend && python -m venv .venv && . .venv/bin/activate   # Windows: .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt && python -m pytest -q
cd ../ && python -m pytest tests -q
cd frontend && npm ci && npm test -- --run && npm run lint && npm run build
```

All of these must pass without any `.env` file. CI runs the same steps on every pull request. Python 3.11 is what CI and the Docker image use.

## 6. What happens when something is down

These behaviours are in the code and covered by the backend tests. Confirm them against the deployed site once (for example on a preview with a deliberately wrong `DATABASE_URL`):

| Failure | Result |
|---|---|
| Database unreachable | `/api/health/db`, `/api/detections` and `/api/risk-areas` answer 503 with a short message and no invented data; the page shows an error and a **Try again** button |
| One area can't be scored, or fire history is unavailable | `/api/risk-areas` still answers 200 with the areas that work and a `warnings` list |
| `REPORT_HASH_SALT` missing on Render | `POST /api/reports` answers 503 and stores nothing |
| `OPENAI_API_KEY` missing | `POST /api/ash-detective` answers 503; the page uses local guidance |
| Detection refresh stops | The watchdog workflow alerts when no refresh has succeeded for about 7 hours; `/api/health/freshness` shows how old the newest detection is |

## 7. Rollback and recovery

Do the smoke check (section 5) after every step below.

- **Bad frontend release:** in Vercel → Deployments, promote or roll back to the last good deployment. If the problem was a changed `VITE_*` value, put the old value back and redeploy, since the value is built in.
- **Bad backend release:** in Render, roll back to (or redeploy) the last successful deploy of the service. Check that the dashboard offers this on your plan; if not, redeploy the previous Git commit. If the problem was an environment variable, restore the old value and redeploy.
- **Bad migration:** migrations are forward-only. Fix it with a **new** migration file reviewed in a pull request; do not edit an applied file. Before applying anything risky, export the affected tables (Table Editor → export, or `pg_dump` over the session pooler). Free-plan projects should not be assumed to have restorable backups.
- **Lost detections:** safe to rebuild. Reload from FIRMS with the loader (`data-processing/load_firms_to_db.py`); already-stored rows are skipped. Or re-run the **Refresh detections** workflow from the Actions tab (it has a manual trigger).
- **Lost fire reports:** cannot be rebuilt from anywhere. Export `public.fire_reports` before any change that touches it.
- **Paused database:** Supabase pauses free projects after about a week of no activity. Restore it from the dashboard.
- **Leaked or exposed secret:** rotate it at the source (for the database, Supabase → Project Settings → Database → reset password), update Render and the GitHub secret, redeploy, then run the smoke check. A secret that was ever pushed to GitHub must be treated as leaked even after the commit is removed.

## 8. Known environment limitations

- Render's free instance sleeps after inactivity, so the first request can take a long time.
- Supabase's free plan pauses idle projects and has no restore guarantee.
- Preview deployments get their own URLs; each one you test must be in `CORS_ORIGINS`.
- `VITE_*` values are fixed at build time.
- The performance targets in [requirements.md](requirements.md) (#9) have not been measured on the deployed site yet. Record the measured numbers in the blockers log when they exist.
- Metrics are per worker process and reset when the service restarts.
- Staff moderation settings (the Supabase auth and staff allowlist variables) will be added here when that work is merged.

## 9. Release readiness log (evidence and blockers for #62)

Fill this in as you verify. "Not yet verified" means nobody has checked it on the live deployment.

| Item | Status | Evidence / blocker | Date |
|---|---|---|---|
| Render environment variables match section 1 | Not yet verified | | |
| Vercel `VITE_API_BASE_URL` set for Production and Preview | Not yet verified | | |
| Migrations 1 to 4 applied; `scripts/check_migrations.py` passes | Not yet verified | paste the output table | |
| `scripts/smoke_check.py` passes against production | Passed 2026-11-22 (6 of 7; 1 warning) | `https://emberwatch-ccub.onrender.com`: health, database, detections, 13 areas all HTTP 200. `/api/health/freshness` returned 404 (deployed build older than main?) | 2026-11-22 | 
| CORS allows the production frontend and blocks others | Passed | `https://ember-watch-xi.vercel.app` allowed; unknown origin gets no header | 2026-11-22 |
| Render deploys the latest `main` | **Blocker / to check** | Freshness endpoint (added 2026-11-22) returns 404 in production. Confirm the deployed commit and whether auto-deploy is on. | 2026-11-22 |
| Clean-install check on a fresh clone | Not yet verified | | |
| Failure behaviour (section 6) confirmed on the deployed site | Not yet verified | | |
| Map performance against the #9 targets | Not yet verified | | |
| Rollback tried once (Vercel and Render) | Not yet verified | | |

## Acceptance checklist (from #95)

- [ ] Render `/api/health` returns HTTP 200.
- [ ] Render `/api/health/db` returns HTTP 200.
- [ ] Production and Preview Vercel builds have `VITE_API_BASE_URL` pointing to Render.
- [ ] Browser requests reach Render and return 200 without CORS errors.
- [ ] Production dashboard shows 13 monitored areas and detections, with no false empty-state/error.
- [ ] Preview deployment also loads data.

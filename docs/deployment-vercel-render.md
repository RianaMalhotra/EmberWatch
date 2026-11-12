# Deployment checklist — Issue #95

The Vite development proxy exists **only** while running `npm run dev`. Vercel has no Flask process: without `VITE_API_BASE_URL`, browser requests to `/api/risk-areas` and `/api/detections` hit Vercel and return HTTP 404.

## 1. Verify Render backend

In Render, configure the Flask web service with:
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn --bind 0.0.0.0:$PORT app:app`
- `DATABASE_URL`: Supabase **session pooler** PostgreSQL connection string (keep secret).
- `CORS_ORIGINS`: `https://ember-watch-xi.vercel.app` plus any specific preview origins, comma-separated with **no trailing slash**.

Redeploy Render after changing environment variables. Open `https://<your-render-host>/api/health`. It must return HTTP 200 with `"status":"ok"`. Then check `/api/health/db`, `/api/risk-areas`, and `/api/detections`. If database calls fail with 503, fix Render's database configuration before troubleshooting Vercel.

## 2. Configure Vercel frontend

In the Vercel project with **Root Directory = frontend**, navigate to **Settings → Environment Variables**.
- Name: `VITE_API_BASE_URL`
- Value: `https://<your-render-host>` (origin only: no `/api` and no trailing slash)
- Environments: **Production** and **Preview** (add Development if appropriate).

**Redeploy** both production and an affected branch preview after saving. Vite resolves `import.meta.env.VITE_API_BASE_URL` at **build time**, so an old deployment will not pick up the new value. Leave `VITE_ENABLE_REPORTS` unset until `POST /api/reports` is implemented and tested (#52).

## 3. Check browser and CORS

Open the deployed frontend with Developer Tools → Network. Reload and verify that `risk-areas` and `detections` requests target your **Render origin** rather than the Vercel origin. They should return 200 JSON. If you see a CORS error, add the exact Vercel origin to `CORS_ORIGINS` on Render and redeploy it. Preview URLs can differ per branch/deployment, so include origins being tested.

Render's free instance may sleep after inactivity. On initial access allow for cold-start latency and use **Try again** if necessary; a sleeping instance is different from Vercel returning 404.

## Acceptance checklist

- [ ] Render `/api/health` returns HTTP 200.
- [ ] Render `/api/health/db` returns HTTP 200.
- [ ] Production and Preview Vercel builds have `VITE_API_BASE_URL` pointing to Render.
- [ ] Browser requests reach Render and return 200 without CORS errors.
- [ ] Production dashboard shows 13 monitored areas and detections, with no false empty-state/error.
- [ ] Preview deployment also loads data.

Do not put database secrets or Supabase credentials in `VITE_*` variables: these are embedded into the browser bundle.

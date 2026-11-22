# Historical NASA FIRMS detection queries (Sprint 3, #46)

The backend reads previously ingested observations from `public.detections`.
First run `data-processing/firms_cleaning.py` on a NASA FIRMS CSV and
`data-processing/load_firms_to_db.py` with `DATABASE_URL` configured
(see the repository setup documentation). Overlapping imports are deduplicated
by the database's `detections_unique` constraint.

## Query example

```bash
curl -G http://localhost:5000/api/detections/history \
  --data-urlencode 'south=45' \
  --data-urlencode 'north=55' \
  --data-urlencode 'west=-125' \
  --data-urlencode 'east=-110' \
  --data-urlencode 'start=2025-07-01T00:00:00Z' \
  --data-urlencode 'end=2025-08-01T00:00:00Z' \
  --data-urlencode 'limit=200'
```

All six spatial/time filters are required. Coordinates are WGS84 decimal
degrees. Bounds are inclusive; the start timestamp is inclusive and end is
exclusive. ISO-8601 timestamps must include a timezone and are normalized to
UTC. The region cannot cross the antimeridian. Results are newest first and
capped at 1000 per request. The endpoint returns the same `detections`,
`gaps`, `counts`, and `threshold` contract as `GET /api/detections`,
plus an echo of validated `filters` and a `truncated` boolean. The query fetches one extra row to detect whether more matches exist beyond `limit`; `truncated: true` means the response is incomplete. HTTP 400 means invalid filters;
HTTP 503 means the database is unavailable. No data is invented.

The Sprint 6 stakeholder analytics workspace includes a **Satellite detection history** form for selecting an approximate geographic region and inclusive UTC calendar date range. It converts the last selected day to the following midnight, which is the exclusive API end instant, and caps queries at 200 observations. It displays a warning when `truncated` is true, uses no invented fallback observations, and reports network/schema errors. See [Sprint 6 integration verification](sprint6-integration-verification.md). A live database audit is still needed to verify coverage for real regions and dates.

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

## Unified historical fire records (Sprint 5, #54)

`GET /api/fires/history` combines two historical event sources into one area- and date-filtered result:

- **NASA FIRMS satellite detections** from `public.detections`.
- **Eligible community reports** from `public.fire_reports`.

### Query example

```bash
curl -G http://localhost:5000/api/fires/history \
  --data-urlencode 'south=45' \
  --data-urlencode 'north=55' \
  --data-urlencode 'west=-125' \
  --data-urlencode 'east=-110' \
  --data-urlencode 'start=2025-07-01T00:00:00Z' \
  --data-urlencode 'end=2025-08-01T00:00:00Z' \
  --data-urlencode 'limit=200'
```

The six spatial and time filters are required. Coordinates use WGS84 decimal degrees. Bounds are inclusive; `start` is inclusive and `end` is exclusive. Timestamps must be ISO-8601 values with a timezone and are normalized to UTC. Bounds crossing the antimeridian are not supported.

`limit` is optional, defaults to 200, and is clamped to the range 1–1000. Results are ordered newest first. The query fetches one extra row to determine whether more results exist; `truncated: true` means additional matching records were not included.

### Response

A successful response contains:

- `status`: `success`.
- `filters`: validated bounds, UTC start/end timestamps and effective limit.
- `truncated`: whether additional matching records exist beyond the limit.
- `data`: unified historical event records.

Each record includes the following fields where applicable:

| Field | Meaning |
|---|---|
| `id` | Source record identifier |
| `event_type` | `satellite_detection` or `community_report` |
| `latitude`, `longitude` | Event coordinates |
| `event_at` | Detection or reported observation time |
| `submitted_at` | Community report submission time, when applicable |
| `source` | Original source, such as NASA FIRMS or public report |
| `confidence`, `confidence_class` | Satellite observation confidence, when available |
| `satellite`, `instrument`, `frp` | Satellite observation metadata, when available |
| `review_status` | Community report review/lifecycle status |
| `ended_at` | Time the report was marked `out`, when available |
| `status_history` | Timestamped status transitions for community reports |
| `linked_report_id`, `linked_detection_id` | Existing duplicate/link relationships |
| `location_source` | Origin of the recorded location, when available |

Fields that do not apply to an event type may be null. Missing metadata is not inferred or fabricated. Satellite confidence describes the observation; it is not a fire-risk score or confirmation that a wildfire exists.

Only community reports with statuses `confirmed`, `out_of_control`, `being_held`, `under_control`, or `out` are included. Unverified, verified, and rejected reports are excluded from this public historical query.

Community report coordinates are rounded to two decimal places in the returned response for location privacy. Filtering is performed against the stored coordinates.

### Errors

- HTTP 200: query succeeded.
- HTTP 400: invalid or incomplete filters.
- HTTP 503: historical query/database failure.

### Relationship to the Investigation Lab

The Historical Fire Records explorer lets users select an eligible event and open it in the Investigation Lab as a case study. The case study presents available source metadata and, for community reports, the recorded lifecycle history.

This is an educational historical-event view. It does not simulate wildfire spread or predict how an individual fire would develop.
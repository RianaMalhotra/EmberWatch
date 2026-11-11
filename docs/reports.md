# Public fire reports (#52)

Backend for the Report a Fire form (#51). User stories: #13 (public reporting), #4 (reliability), #12 (maintainable modules).

## What happens when a report is sent

`POST /api/reports` (contract in [component-interfaces.md](component-interfaces.md)):

1. **Validation** (`backend/services/report_validation.py`): the same rules as the form, checked again on the server. Coordinates must be finite and in range, `location_source` is `gps` or `map`, `observed_type` is `flames`, `smoke` or `both`, `observed_at` needs a timezone and must be between 7 days ago and 5 minutes from now, and `description` is at most 500 characters. Invalid input gets `400` with a list of problems and never reaches the database.
2. **One transaction** (`backend/services/report_store.py`):
   1. `pg_advisory_xact_lock` on the sender's key, so simultaneous requests from one sender run one at a time.
   2. Count that sender's reports in the rate-limit window. Over the limit → `429` with `Retry-After`.
   3. Find the closest earlier report and satellite detection within **2 km and 24 h** of the sighting (`ST_DWithin` on the geography columns). A report that matches an earlier linked report points to the first report of that group.
   4. Insert the report with `review_status = 'unverified'` and `source = 'public_report'`.
3. If anything fails during the transaction (database down, connection lost, constraint error), the transaction rolls back and the API answers `503`. **A partial report is never stored**, and error details (host, user, password) are only written to the server log.

## Data stored (`public.fire_reports`)

| Column | Meaning |
|---|---|
| `latitude`, `longitude`, `location` | Where the fire is. `location` is a PostGIS geography generated from the coordinates |
| `location_source` | `gps` (device location) or `map` (pin dropped by the user) |
| `observed_type` | `flames`, `smoke` or `both` |
| `observed_at` | When the person saw it (UTC) |
| `created_at` | When the server stored it (UTC) |
| `description` | Optional, up to 500 characters |
| `source` | Always `public_report` for this endpoint |
| `review_status` | `unverified` until staff review (#53); later `verified` or `rejected` |
| `client_key` | Salted SHA-256 of the sender IP, used only for rate limiting. **The raw IP is never stored** |
| `linked_report_id`, `linked_detection_id` | Provisional duplicate links (2 km / 24 h) |

## Configuration (backend/.env)

| Variable | Default | Purpose |
|---|---|---|
| `REPORT_RATE_LIMIT` | `5` | Reports allowed per sender per window |
| `REPORT_RATE_WINDOW_MINUTES` | `10` | Window length; also the `Retry-After` value |
| `REPORT_HASH_SALT` | empty | Secret mixed into the IP hash. Set a long random value in production |

## Setup

1. Apply `supabase/migrations/20261112000000_fire_reports.sql` in the Supabase SQL editor (or `supabase db push`).
2. Restart the Flask backend.
3. Build the frontend with `VITE_ENABLE_REPORTS=true` so the form sends reports instead of running as a preview.

## Automated tests

```
cd backend
python -m pytest -q tests/test_reports_52.py
```

`tests/test_reports_52.py` needs no database. It uses an in-memory fake that behaves like Postgres for this feature: the advisory lock is a real per-sender lock, and an insert is only kept if the transaction finishes. It covers:

- validation of every field, including bools, NaN, missing timezones, future and old times
- the 201 contract the form expects (`id`, `review_status: "unverified"`)
- rate limits: 429 with `Retry-After`, per-sender limits, and a bad config not counted as success
- concurrency: 20 simultaneous requests from one sender store exactly the limit (5)
- duplicate linking: nearby reports and detections are linked, not dropped; the 2 km / 24 h parameters
- outages at each step of the transaction: 503, no details leaked, nothing stored

The SQL was also run against PostgreSQL 16 + PostGIS 3 with all migrations applied: linking found the detection 0.5 km away and ignored one from 3 days earlier, a report 1.1 km away linked to the first report, one 17 km away had no links, 15 simultaneous requests from one sender stored exactly 5, and a failed insert left no row.

## Manual verification

With the backend running locally (`python app.py`) and the migration applied:

```powershell
$body = @{ latitude = 49.25; longitude = -123.1; location_source = "map"; observed_type = "smoke"; observed_at = (Get-Date).ToUniversalTime().ToString("o"); description = "Test report, please ignore" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/reports -ContentType "application/json" -Body $body
```

Expected: `status: success` and `data` with an `id` and `review_status: unverified`.

1. Send the same command again: the new report has `linked_report_id` set to the first report's id.
2. Send it 5 more times within 10 minutes: the request after the limit fails with `429`.
3. Change `latitude` to `200`: `400` with `latitude must be a number between -90 and 90.`
4. Set a wrong password in `DATABASE_URL` and restart: `503`, and in Supabase (`select count(*) from fire_reports`) the count has not changed.

Delete test rows afterwards: `delete from public.fire_reports where description = 'Test report, please ignore';`

## Known limitations

- **Duplicate linking is provisional.** 2 km / 24 h is a starting value, not a tested one. It links to the single closest match; it does not merge reports or decide that two sightings are the same fire. Staff review (#53) makes the final call.
- **Rate limiting is per IP address.** People sharing a network (a campus, an office, mobile carrier NAT) share one limit. A determined attacker can change IPs. `X-Forwarded-For` is trusted because the app runs behind Render's proxy; if it is ever exposed directly, that header could be spoofed.
- **Reports are not verified and are never sent to emergency services.** The form tells users to call 911 for emergencies.
- **Reports are not shown on the map yet.** Displaying and reviewing them is #53.
